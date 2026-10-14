/* =========================================================
   ui-sticker.js ― 「シール」画面（手帳に貼る、今日の日記シール）
   ---------------------------------------------------------
   ・日付・妊娠週数・予定日まであと何日・体調・食べれたもの・ひとことを
     白黒のシール画像（幅384ドット＝57mmの猫型プリンター用）にします。
   ・「シールを保存」で、iPhoneなら共有シートが開きます。
     そこから「画像を保存」→ Fun Print の「画像印刷」で印刷。
   ・保存は localStorage の noutab.sticker（このスマホの中だけ）。
   ・画面の骨組みは index.html の screen-sticker、見た目は style.css の「6. シール」。
   ・ボタンと処理のひも付けは、この画面の中で完結させています（init で登録）。
   ========================================================= */

const StickerUI = (() => {
  const $ = (id) => document.getElementById(id);
  const KEY = 'noutab.sticker';

  // ---------------------------------------------------------
  // 設定（ここを変えると中身が変わる）
  // ---------------------------------------------------------
  const DEFAULT_DUE = '2027-04-30'; // 予定日（画面からも変えられる）
  const DEFAULT_CHIPS = ['りんご', 'アイスの実', 'ラムネ', 'おにぎり', 'ゼリー', 'サクレ', '梅', 'ポカリ', '水'];
  // 体調の名前と、そのときのハルのひとこと
  const COND = {
    good: { label: 'いい', haru: 'やるじゃん' },
    ok: { label: 'ふつう', haru: 'まあまあだな' },
    hard: { label: 'しんどい', haru: '寝てろ' },
    sick: { label: '吐いた', haru: '見張ってる' },
  };
  const WEEK = ['日', '月', '火', '水', '木', '金', '土'];

  // シール画像の大きさ（57mmの紙で印刷できる幅は384ドット）
  const W = 384;
  const P = 18; // 余白
  const FONT = '"Zen Maru Gothic","Hiragino Maru Gothic ProN","Hiragino Sans",sans-serif';

  let state = null;
  let timer = null;
  let lastBlob = null;

  // ---------------------------------------------------------
  // 保存と読み込み
  // ---------------------------------------------------------
  function todayStr() {
    const d = new Date();
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }
  function parse(s) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s || '');
    return m ? new Date(+m[1], +m[2] - 1, +m[3]) : null;
  }
  function load() {
    let saved = null;
    try { saved = JSON.parse(localStorage.getItem(KEY)); } catch (e) { saved = null; }
    state = Object.assign(
      { due: DEFAULT_DUE, date: todayStr(), cond: 'ok', checkup: false, chips: DEFAULT_CHIPS.slice(), foods: [], memo: '', size: 'full' },
      saved || {}
    );
    // 日付が変わっていたら、その日の記録だけ空にする（予定日と候補は残す）
    if (saved && saved.date !== todayStr()) {
      Object.assign(state, { date: todayStr(), cond: 'ok', checkup: false, foods: [], memo: '' });
    }
  }
  function save() {
    try { localStorage.setItem(KEY, JSON.stringify(state)); } catch (e) { /* 保存できなくても画面は使える */ }
  }

  // ---------------------------------------------------------
  // 週数の計算（予定日＝40週0日から逆算）
  // ---------------------------------------------------------
  function gest() {
    const d = parse(state.date);
    const due = parse(state.due);
    if (!d || !due) return null;
    const left = Math.round((due - d) / 86400000);
    const ga = 280 - left;
    if (ga < 0 || ga > 300) return { left, w: null, d: null };
    return { left, w: Math.floor(ga / 7), d: ga % 7 };
  }

  // ---------------------------------------------------------
  // フォームの表示
  // ---------------------------------------------------------
  function syncPressed(groupId, val) {
    $(groupId).querySelectorAll('button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.v === val)));
  }

  function renderChips() {
    const box = $('st-chips');
    box.textContent = '';
    const all = state.chips.slice();
    state.foods.forEach((f) => { if (!all.includes(f)) all.push(f); });
    all.forEach((name) => {
      const b = UI.el('button', 'chip' + (state.foods.includes(name) ? ' is-on' : ''), name);
      b.type = 'button';
      b.dataset.food = name;
      b.setAttribute('aria-pressed', String(state.foods.includes(name)));
      box.appendChild(b);
    });
  }

  /** 画面を開くときに呼ぶ（js/app.js の go('sticker') から） */
  function render() {
    load();
    $('st-date').value = state.date;
    $('st-due').value = state.due;
    $('st-memo').value = state.memo;
    $('st-checkup').checked = state.checkup;
    syncPressed('st-cond', state.cond);
    syncPressed('st-size', state.size);
    renderChips();
    $('st-msg').textContent = '';
    draw();
  }

  function changed() {
    save();
    clearTimeout(timer);
    timer = setTimeout(draw, 80);
  }

  // ---------------------------------------------------------
  // シールを描く（白黒）
  // ---------------------------------------------------------
  function font(w, px) { return w + ' ' + px + 'px ' + FONT; }

  function wrapText(c, text, maxW) {
    const lines = [];
    let cur = '';
    for (const ch of text) {
      if (ch === '\n') { lines.push(cur); cur = ''; continue; }
      const t = cur + ch;
      if (c.measureText(t).width > maxW && cur) { lines.push(cur); cur = ch; } else cur = t;
    }
    if (cur) lines.push(cur);
    return lines;
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

  // 体調の顔マーク
  function face(c, x, y, s, kind) {
    const cx = x + s / 2, cy = y + s / 2, r = s / 2 - 2;
    c.lineWidth = 3; c.strokeStyle = '#000'; c.fillStyle = '#fff';
    c.beginPath(); c.arc(cx, cy, r, 0, Math.PI * 2); c.fill(); c.stroke();
    c.fillStyle = '#000';
    const ex = r * 0.36, ey = cy - r * 0.18;
    if (kind === 'sick') { // >< の目
      c.lineWidth = 2.6;
      c.beginPath(); c.moveTo(cx - ex - 4, ey - 4); c.lineTo(cx - ex + 4, ey); c.lineTo(cx - ex - 4, ey + 4); c.stroke();
      c.beginPath(); c.moveTo(cx + ex + 4, ey - 4); c.lineTo(cx + ex - 4, ey); c.lineTo(cx + ex + 4, ey + 4); c.stroke();
    } else {
      c.beginPath(); c.arc(cx - ex, ey, 2.8, 0, Math.PI * 2); c.arc(cx + ex, ey, 2.8, 0, Math.PI * 2); c.fill();
    }
    c.lineWidth = 3; c.beginPath();
    const my = cy + r * 0.32;
    if (kind === 'good') c.arc(cx, my - r * 0.18, r * 0.38, Math.PI * 0.15, Math.PI * 0.85);
    else if (kind === 'ok') { c.moveTo(cx - r * 0.3, my); c.lineTo(cx + r * 0.3, my); }
    else { // くねくねの口
      const w = r * 0.6;
      c.moveTo(cx - w / 2, my);
      for (let i = 1; i <= 4; i++) c.quadraticCurveTo(cx - w / 2 + (w * (i - 0.5)) / 4, my + (i % 2 ? -4 : 4), cx - w / 2 + (w * i) / 4, my);
    }
    c.stroke();
    if (kind === 'hard') { // 汗
      const sx = cx + r * 0.72, sy = cy - r * 0.55;
      c.beginPath(); c.moveTo(sx, sy - 7); c.quadraticCurveTo(sx + 6, sy + 2, sx, sy + 5); c.quadraticCurveTo(sx - 6, sy + 2, sx, sy - 7);
      c.fillStyle = '#fff'; c.fill(); c.lineWidth = 2; c.stroke();
    }
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

  // 並べ方。draw=false なら高さだけ測る
  function layout(c, draw) {
    const g = gest();
    const d = parse(state.date) || new Date();
    const mini = state.size === 'mini';
    let y = P;

    // 日付
    const md = d.getMonth() + 1 + '/' + d.getDate();
    c.font = font(900, 46);
    const mdW = c.measureText(md).width;
    if (draw) {
      c.fillStyle = '#000'; c.textBaseline = 'alphabetic'; c.fillText(md, P, y + 42);
      c.font = font(700, 20); c.fillText('(' + WEEK[d.getDay()] + ')', P + mdW + 4, y + 41);
    }

    // 週数（黒い札）と、あと何日
    const wk = g && g.w != null ? g.w + 'w' + g.d + 'd' : '--';
    c.font = font(900, 24);
    const bw = c.measureText(wk).width + 22, bh = 36, bx = W - P - bw, by = y + 2;
    if (draw) { c.fillStyle = '#000'; rrect(c, bx, by, bw, bh, 8); c.fill(); c.fillStyle = '#fff'; c.fillText(wk, bx + 11, by + 27); }
    const left = g ? (g.left >= 0 ? 'あと' + g.left + '日' : '予定日+' + -g.left + '日') : '';
    c.font = font(900, 17);
    if (draw && left) { c.fillStyle = '#000'; c.textAlign = 'right'; c.fillText(left, W - P, by + bh + 19); c.textAlign = 'left'; }
    y += 68;

    // 点線
    if (draw) { c.save(); c.setLineDash([6, 5]); c.lineWidth = 2; c.strokeStyle = '#000'; c.beginPath(); c.moveTo(P, y); c.lineTo(W - P, y); c.stroke(); c.restore(); }
    y += 12;

    // 体調
    const cond = COND[state.cond] || COND.ok;
    const fs = 44;
    if (draw) face(c, P, y, fs, state.cond);
    c.font = font(900, 26);
    const lw = c.measureText(cond.label).width;
    if (draw) { c.fillStyle = '#000'; c.fillText(cond.label, P + fs + 12, y + 32); }
    if (state.checkup) {
      c.font = font(700, 15);
      const tw = c.measureText('健診').width + 16, tx = P + fs + 12 + lw + 10;
      if (draw) { c.lineWidth = 2; c.strokeStyle = '#000'; rrect(c, tx, y + 11, tw, 26, 13); c.stroke(); c.fillStyle = '#000'; c.fillText('健診', tx + 8, y + 29); }
    }
    if (mini) { // ちいさめ：ここまで＋小さいハル
      if (draw) haru(c, W - P - 54, y - 8, 54);
      return y + fs + P;
    }
    y += fs + 10;

    // 食べれたもの（「・」が行の頭に来ないように、食べものごとに折り返す）
    if (state.foods.length) {
      c.font = font(700, 13);
      const tw = c.measureText('たべれた').width + 12;
      if (draw) { c.fillStyle = '#000'; rrect(c, P, y + 2, tw, 20, 4); c.fill(); c.fillStyle = '#fff'; c.fillText('たべれた', P + 6, y + 17); }
      c.font = font(700, 19);
      const maxW = W - P * 2 - tw - 8;
      const lines = [];
      let cur = '';
      state.foods.forEach((f) => {
        const t = cur ? cur + ' ・ ' + f : f;
        if (cur && c.measureText(t).width > maxW) { lines.push(cur); cur = f; } else cur = t;
      });
      if (cur) lines.push(cur);
      const out = [];
      lines.forEach((ln) => (c.measureText(ln).width > maxW ? out.push(...wrapText(c, ln, maxW)) : out.push(ln)));
      if (draw) { c.fillStyle = '#000'; out.forEach((ln, i) => c.fillText(ln, P + tw + 8, y + 19 + i * 25)); }
      y += Math.max(1, out.length) * 25 + 8;
    }

    // ひとこと
    const memo = (state.memo || '').trim();
    if (memo) {
      c.font = font(700, 17);
      const lines = wrapText(c, memo, W - P * 2 - 14);
      if (draw) {
        c.fillStyle = '#000'; c.fillRect(P, y + 2, 3, lines.length * 23);
        lines.forEach((ln, i) => c.fillText(ln, P + 12, y + 18 + i * 23));
      }
      y += lines.length * 23 + 10;
    }

    // ハルとひとこと
    const hs = 62;
    y += 2;
    if (draw) {
      haru(c, W - P - hs, y, hs);
      c.font = font(900, 18); c.fillStyle = '#000'; c.textAlign = 'right';
      c.fillText('ハル「' + cond.haru + '」', W - P - hs - 4, y + hs - 10);
      c.textAlign = 'left';
    }
    return y + hs + P - 4;
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
  function ensureFonts() {
    if (!document.fonts) return Promise.resolve();
    const text = Object.values(COND).map((x) => x.label + x.haru).join('') + state.foods.join('') + state.memo +
      'たべれた健診あと日予定ハル「」()0123456789/wd・+-' + WEEK.join('');
    return Promise.all([font(900, 46), font(700, 20)].map((f) => document.fonts.load(f, text).catch(() => {}))).catch(() => {});
  }

  function draw() {
    const cv = $('st-canvas');
    const c = cv.getContext('2d', { willReadFrequently: true });
    ensureFonts().then(() => {
      cv.width = W; cv.height = 600;
      const h = Math.ceil(layout(c, false));
      cv.width = W; cv.height = h;
      c.fillStyle = '#fff'; c.fillRect(0, 0, W, h);
      layout(c, true);
      threshold(cv, c);
      $('st-out').src = cv.toDataURL('image/png');
      lastBlob = null;
      cv.toBlob((b) => { lastBlob = b; }, 'image/png');
    });
  }

  // ---------------------------------------------------------
  // 保存：iPhoneは共有シート、だめならダウンロード
  // ---------------------------------------------------------
  function fileName() {
    return 'haru-sticker-' + (state.date || todayStr()).replace(/-/g, '') + '.png';
  }

  async function saveSticker() {
    const msg = $('st-msg');
    msg.textContent = '';
    if (!lastBlob) { msg.textContent = 'もう一回押して。'; return; }
    const file = new File([lastBlob], fileName(), { type: 'image/png' });
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      try {
        await navigator.share({ files: [file] });
        msg.textContent = 'Fun Print の「画像印刷」で選んで。';
      } catch (e) {
        if (e && e.name !== 'AbortError') msg.textContent = '保存できなかった。画像を長押しして保存して。';
      }
      return;
    }
    // 共有が使えないブラウザ（パソコンなど）はダウンロード
    const a = document.createElement('a');
    a.href = URL.createObjectURL(lastBlob);
    a.download = fileName();
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    msg.textContent = '保存した。';
  }

  // ---------------------------------------------------------
  // ボタンのひも付け（起動時に1回だけ）
  // ---------------------------------------------------------
  function init() {
    load();
    $('st-cond').addEventListener('click', (e) => {
      const b = e.target.closest('button'); if (!b) return;
      state.cond = b.dataset.v; syncPressed('st-cond', state.cond); changed();
    });
    $('st-size').addEventListener('click', (e) => {
      const b = e.target.closest('button'); if (!b) return;
      state.size = b.dataset.v; syncPressed('st-size', state.size); changed();
    });
    $('st-chips').addEventListener('click', (e) => {
      const b = e.target.closest('[data-food]'); if (!b) return;
      const name = b.dataset.food, i = state.foods.indexOf(name);
      if (i >= 0) state.foods.splice(i, 1); else state.foods.push(name);
      renderChips(); changed();
    });
    const addFood = () => {
      const v = $('st-new-food').value.trim(); if (!v) return;
      if (!state.chips.includes(v)) state.chips.push(v);
      if (!state.foods.includes(v)) state.foods.push(v);
      $('st-new-food').value = ''; renderChips(); changed();
    };
    $('st-add-food').addEventListener('click', addFood);
    $('st-new-food').addEventListener('keydown', (e) => {
      if (e.key !== 'Enter' || e.isComposing || e.keyCode === 229) return;
      e.preventDefault(); addFood();
    });
    $('st-date').addEventListener('input', (e) => { state.date = e.target.value || todayStr(); changed(); });
    $('st-due').addEventListener('input', (e) => { state.due = e.target.value || DEFAULT_DUE; changed(); });
    $('st-memo').addEventListener('input', (e) => { state.memo = e.target.value; changed(); });
    $('st-checkup').addEventListener('change', (e) => { state.checkup = e.target.checked; changed(); });
    $('st-form').addEventListener('submit', (e) => e.preventDefault());
    $('btn-st-save').addEventListener('click', saveSticker);
  }

  return { init, render };
})();
