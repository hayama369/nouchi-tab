/* =========================================================
   thermal.js ― 57mmの猫型プリンター用の「白黒の紙」を描く道具箱
   ---------------------------------------------------------
   ・シール画面（js/ui-sticker.js）の3種類（日記・ひとりごと・あとで見る）で共通に使います。
   ・紙の幅は384ドット。描いたあと灰色をなくして、真っ白／真っ黒にします。
   ・保存：iPhoneなら共有シート（→「画像を保存」→ Fun Print の「画像印刷」）、
     パソコンならダウンロード。
   ========================================================= */

const Thermal = (() => {
  const W = 384; // 57mmの紙で印刷できる幅
  const P = 18; // 余白
  const FONT = '"Zen Maru Gothic","Hiragino Maru Gothic ProN","Hiragino Sans",sans-serif';
  const WEEK = ['日', '月', '火', '水', '木', '金', '土'];

  function font(w, px) {
    return w + ' ' + px + 'px ' + FONT;
  }

  /** 1文字ずつ測って、幅 maxW で折り返した行の配列を返す（改行も守る） */
  function wrapText(c, text, maxW) {
    const lines = [];
    let cur = '';
    for (const ch of text) {
      if (ch === '\n') { lines.push(cur); cur = ''; continue; }
      const t = cur + ch;
      if (c.measureText(t).width > maxW && cur) { lines.push(cur); cur = ch; } else cur = t;
    }
    if (cur) lines.push(cur);
    return lines.length ? lines : [''];
  }

  function rrect(c, x, y, w, h, r) {
    c.beginPath();
    c.moveTo(x + r, y);
    c.arcTo(x + w, y, x + w, y + h, r);
    c.arcTo(x + w, y + h, x, y + h, r);
    c.arcTo(x, y + h, x, y, r);
    c.arcTo(x, y, x + w, y, r);
    c.closePath();
  }

  function dashed(c, y) {
    c.save(); c.setLineDash([6, 5]); c.lineWidth = 2; c.strokeStyle = '#000';
    c.beginPath(); c.moveTo(P, y); c.lineTo(W - P, y); c.stroke(); c.restore();
  }

  // ハル（黒猫のシルエット。胸に白いエンジェルマーク）
  function haru(c, x, y, s) {
    c.save(); c.fillStyle = '#000'; c.strokeStyle = '#000';
    c.lineWidth = s * 0.09; c.lineCap = 'round';
    c.beginPath(); c.moveTo(x + s * 0.66, y + s * 0.9); c.quadraticCurveTo(x + s * 0.98, y + s * 0.86, x + s * 0.9, y + s * 0.52); c.stroke();
    c.beginPath(); c.ellipse(x + s * 0.44, y + s * 0.73, s * 0.28, s * 0.25, 0, 0, Math.PI * 2); c.fill();
    const hx = x + s * 0.42, hy = y + s * 0.38, hr = s * 0.23;
    c.beginPath(); c.arc(hx, hy, hr, 0, Math.PI * 2); c.fill();
    c.beginPath(); c.moveTo(hx - hr * 0.95, hy - hr * 0.25); c.lineTo(hx - hr * 0.75, hy - hr * 1.35); c.lineTo(hx - hr * 0.15, hy - hr * 0.85); c.closePath(); c.fill();
    c.beginPath(); c.moveTo(hx + hr * 0.95, hy - hr * 0.25); c.lineTo(hx + hr * 0.75, hy - hr * 1.35); c.lineTo(hx + hr * 0.15, hy - hr * 0.85); c.closePath(); c.fill();
    c.fillStyle = '#fff';
    c.beginPath(); c.ellipse(hx - hr * 0.4, hy - hr * 0.02, hr * 0.24, hr * 0.28, 0, 0, Math.PI * 2); c.ellipse(hx + hr * 0.4, hy - hr * 0.02, hr * 0.24, hr * 0.28, 0, 0, Math.PI * 2); c.fill();
    c.fillStyle = '#000';
    c.beginPath(); c.ellipse(hx - hr * 0.4, hy - hr * 0.02, hr * 0.06, hr * 0.22, 0, 0, Math.PI * 2); c.ellipse(hx + hr * 0.4, hy - hr * 0.02, hr * 0.06, hr * 0.22, 0, 0, Math.PI * 2); c.fill();
    c.fillStyle = '#fff'; c.beginPath(); c.ellipse(x + s * 0.47, y + s * 0.66, s * 0.045, s * 0.06, 0, 0, Math.PI * 2); c.fill();
    c.restore();
  }

  // 肉球のはんこ（ひとりごとでハルが押していったしるし）
  function paw(c, x, y, s) {
    const k = s / 32;
    c.save(); c.fillStyle = '#000';
    [[16, 21, 7.5, 6.5], [7, 13, 3, 3.8], [12.5, 7.5, 3, 3.8], [19.5, 7.5, 3, 3.8], [25, 13, 3, 3.8]].forEach(([cx, cy, rx, ry]) => {
      c.beginPath(); c.ellipse(x + cx * k, y + cy * k, rx * k, ry * k, 0, 0, Math.PI * 2); c.fill();
    });
    c.restore();
  }

  // サーマルプリンター用に、灰色をなくして真っ白／真っ黒にする
  function threshold(cv, c) {
    const img = c.getImageData(0, 0, cv.width, cv.height), a = img.data;
    for (let i = 0; i < a.length; i += 4) {
      const v = a[i] * 0.299 + a[i + 1] * 0.587 + a[i + 2] * 0.114 < 185 ? 0 : 255;
      a[i] = a[i + 1] = a[i + 2] = v; a[i + 3] = 255;
    }
    c.putImageData(img, 0, 0);
  }

  // 日本語フォントは使う文字だけ読み込まれるので、描く前に読み込ませる
  function ensureFonts(text) {
    if (!document.fonts) return Promise.resolve();
    const t = text + '0123456789:/()・「」' + WEEK.join('');
    return Promise.all([font(900, 46), font(700, 20)].map((f) => document.fonts.load(f, t).catch(() => {}))).catch(() => {});
  }

  /**
   * 紙を描く。layout(c, draw) は「描いて、使った高さを返す」関数
   * （draw=false のときは高さだけ測る）。できあがりを img に出し、PNG の Blob を返す。
   */
  function render(cv, img, layout, text) {
    const c = cv.getContext('2d', { willReadFrequently: true });
    return ensureFonts(text).then(() => new Promise((resolve) => {
      cv.width = W; cv.height = 600;
      const h = Math.max(60, Math.ceil(layout(c, false)));
      cv.width = W; cv.height = h;
      c.fillStyle = '#fff'; c.fillRect(0, 0, W, h);
      c.textBaseline = 'alphabetic'; c.textAlign = 'left';
      layout(c, true);
      threshold(cv, c);
      img.src = cv.toDataURL('image/png');
      cv.toBlob((b) => resolve(b), 'image/png');
    }));
  }

  /** 保存：iPhoneは共有シート、だめならダウンロード。結果のひとことを msgEl に出す */
  async function save(blob, name, msgEl) {
    msgEl.textContent = '';
    if (!blob) { msgEl.textContent = 'もう一回押して。'; return; }
    const file = new File([blob], name, { type: 'image/png' });
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      try {
        await navigator.share({ files: [file] });
        msgEl.textContent = 'Fun Print の「画像印刷」で選んで。';
      } catch (e) {
        if (e && e.name !== 'AbortError') msgEl.textContent = '保存できなかった。画像を長押しして保存して。';
      }
      return;
    }
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    msgEl.textContent = '保存した。';
  }

  return { W, P, FONT, WEEK, font, wrapText, rrect, dashed, haru, paw, threshold, ensureFonts, render, save };
})();
