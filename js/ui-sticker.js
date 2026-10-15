/* =========================================================
   ui-sticker.js ― 「シール」画面（手帳に貼る、57mmの猫型プリンター用の紙）
   ---------------------------------------------------------
   上のボタンで作るものを切り替えます。
   ・日記　　　… 日付・妊娠週数・予定日まであと何日・体調・食べれたもの・ひとこと
   ・ひとりごと … その日のひとりごとを、時刻つきで全部（肉球のはんこも）
   ・あとで見る … その日に退避した思いつき（終わったものには ✓）

   ・「保存」で、iPhoneなら共有シートが開きます。
     そこから「画像を保存」→ Fun Print の「画像印刷」で印刷。
   ・紙を描く道具は js/thermal.js にまとめてあります。
   ・保存は localStorage の noutab.sticker（このスマホの中だけ。同期はしない）。
   ・画面の骨組みは index.html の screen-sticker、見た目は style.css の「6. シール」。
   ・ボタンと処理のひも付けは、この画面の中で完結させています（init で登録）。
   ========================================================= */

const StickerUI = (() => {
  const $ = (id) => document.getElementById(id);
  const KEY = 'noutab.sticker';
  const T = Thermal;
  const { W, P, WEEK } = T;
  const font = T.font;

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
  const DAY_CHIPS = 8; // 「書いた日」のボタンをいくつまで出すか
  const DAY_MS = 86400000;

  let state = null;
  let timer = null;
  let lastBlob = null; // 日記シールの画像
  let listBlob = null; // ひとりごと／あとで見る の画像
  let listDay = null; // ひとりごと／あとで見る で表示している日（その日の0時のミリ秒）

  // ---------------------------------------------------------
  // 保存と読み込み
  // ---------------------------------------------------------
  function ymd(d) {
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }
  function todayStr() {
    return ymd(new Date());
  }
  function parse(s) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s || '');
    return m ? new Date(+m[1], +m[2] - 1, +m[3]) : null;
  }
  function dayOf(ms) {
    const d = new Date(ms);
    return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  }
  function load() {
    let saved = null;
    try { saved = JSON.parse(localStorage.getItem(KEY)); } catch (e) { saved = null; }
    state = Object.assign(
      { due: DEFAULT_DUE, date: todayStr(), cond: 'ok', checkup: false, chips: DEFAULT_CHIPS.slice(), foods: [], memo: '', size: 'full', mode: 'diary' },
      saved || {}
    );
    // 日付が変わっていたら、その日の記録だけ空にする（予定日と候補は残す）
    if (saved && saved.date !== todayStr()) {
      Object.assign(state, { date: todayStr(), cond: 'ok', checkup: false, foods: [], memo: '' });
    }
    if (!['diary', 'hitori', 'later'].includes(state.mode)) state.mode = 'diary';
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
    const left = Math.round((due - d) / DAY_MS);
    const ga = 280 - left;
    if (ga < 0 || ga > 300) return { left, w: null, d: null };
    return { left, w: Math.floor(ga / 7), d: ga % 7 };
  }

  // =========================================================
  // 画面の表示
  // =========================================================
  function syncPressed(groupId, val) {
    $(groupId).querySelectorAll('button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.v === val)));
  }

  /** 画面を開くときに呼ぶ（js/app.js の go('sticker') から） */
  function render() {
    load();
    syncPressed('st-mode', state.mode);
    const diary = state.mode === 'diary';
    $('st-pane-diary').hidden = !diary;
    $('st-pane-list').hidden = diary;
    if (diary) renderDiary();
    else renderList();
  }

  /** ほかの端末から同期で届いたとき（日記の入力中は触らない） */
  function refresh() {
    if (state && state.mode !== 'diary') renderList();
  }

  function setMode(mode) {
    state.mode = mode;
    save();
    render();
  }

  // =========================================================
  // 1. 日記シール
  // =========================================================
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

  function renderDiary() {
    $('st-date').value = state.date;
    $('st-due').value = state.due;
    $('st-memo').value = state.memo;
    $('st-checkup').checked = state.checkup;
    syncPressed('st-cond', state.cond);
    syncPressed('st-size', state.size);
    renderChips();
    $('st-msg').textContent = '';
    drawDiary();
  }

  function changed() {
    save();
    clearTimeout(timer);
    timer = setTimeout(drawDiary, 80);
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

  // 日記の並べ方。draw=false なら高さだけ測る
  function diaryLayout(c, draw) {
    const g = gest();
    const d = parse(state.date) || new Date();
    const mini = state.size === 'mini';
    let y = P;

    // 日付
    const md = d.getMonth() + 1 + '/' + d.getDate();
    c.font = font(900, 46);
    const mdW = c.measureText(md).width;
    if (draw) {
      c.fillStyle = '#000'; c.fillText(md, P, y + 42);
      c.font = font(700, 20); c.fillText('(' + WEEK[d.getDay()] + ')', P + mdW + 4, y + 41);
    }

    // 週数（黒い札）と、あと何日
    const wk = g && g.w != null ? g.w + 'w' + g.d + 'd' : '--';
    c.font = font(900, 24);
    const bw = c.measureText(wk).width + 22, bh = 36, bx = W - P - bw, by = y + 2;
    if (draw) { c.fillStyle = '#000'; T.rrect(c, bx, by, bw, bh, 8); c.fill(); c.fillStyle = '#fff'; c.fillText(wk, bx + 11, by + 27); }
    const left = g ? (g.left >= 0 ? 'あと' + g.left + '日' : '予定日+' + -g.left + '日') : '';
    c.font = font(900, 17);
    if (draw && left) { c.fillStyle = '#000'; c.textAlign = 'right'; c.fillText(left, W - P, by + bh + 19); c.textAlign = 'left'; }
    y += 68;

    if (draw) T.dashed(c, y);
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
      if (draw) { c.lineWidth = 2; c.strokeStyle = '#000'; T.rrect(c, tx, y + 11, tw, 26, 13); c.stroke(); c.fillStyle = '#000'; c.fillText('健診', tx + 8, y + 29); }
    }
    if (mini) { // ちいさめ：ここまで＋小さいハル
      if (draw) T.haru(c, W - P - 54, y - 8, 54);
      return y + fs + P;
    }
    y += fs + 10;

    // 食べれたもの（「・」が行の頭に来ないように、食べものごとに折り返す）
    if (state.foods.length) {
      c.font = font(700, 13);
      const tw = c.measureText('たべれた').width + 12;
      if (draw) { c.fillStyle = '#000'; T.rrect(c, P, y + 2, tw, 20, 4); c.fill(); c.fillStyle = '#fff'; c.fillText('たべれた', P + 6, y + 17); }
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
      lines.forEach((ln) => (c.measureText(ln).width > maxW ? out.push(...T.wrapText(c, ln, maxW)) : out.push(ln)));
      if (draw) { c.fillStyle = '#000'; out.forEach((ln, i) => c.fillText(ln, P + tw + 8, y + 19 + i * 25)); }
      y += Math.max(1, out.length) * 25 + 8;
    }

    // ひとこと
    const memo = (state.memo || '').trim();
    if (memo) {
      c.font = font(700, 17);
      const lines = T.wrapText(c, memo, W - P * 2 - 14);
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
      T.haru(c, W - P - hs, y, hs);
      c.font = font(900, 18); c.fillStyle = '#000'; c.textAlign = 'right';
      c.fillText('ハル「' + cond.haru + '」', W - P - hs - 4, y + hs - 10);
      c.textAlign = 'left';
    }
    return y + hs + P - 4;
  }

  function drawDiary() {
    const text = Object.values(COND).map((x) => x.label + x.haru).join('') + state.foods.join('') + state.memo +
      'たべれた健診あと日予定ハルwd+-';
    lastBlob = null;
    T.render($('st-canvas'), $('st-out'), diaryLayout, text).then((b) => { lastBlob = b; });
  }

  function diaryFileName() {
    return 'haru-sticker-' + (state.date || todayStr()).replace(/-/g, '') + '.png';
  }

  // =========================================================
  // 2. ひとりごと／あとで見る（1日分ずつ）
  // =========================================================
  const LIST = {
    hitori: {
      label: 'ひとりごと',
      file: 'haru-hitori-',
      empty: 'この日はひとりごとがない。',
      items: (day) => Storage.getMumbles().filter((m) => dayOf(m.createdAt) === day), // 古い順
      days: () => Storage.getMumbles().map((m) => dayOf(m.createdAt)),
      haru: (items) => (!items.length ? 'しずかな日だな' : items.length < 4 ? 'きいてた' : items.length < 10 ? 'よくしゃべったな' : 'ぜんぶ聞いてた'),
    },
    later: {
      label: 'あとで見る',
      file: 'haru-later-',
      empty: 'この日は何も退避してない。',
      items: (day) => Storage.getBrainTabs().filter((t) => dayOf(t.createdAt) === day).sort((a, b) => a.createdAt - b.createdAt),
      days: () => Storage.getBrainTabs().map((t) => dayOf(t.createdAt)),
      haru: (items) => {
        const open = items.filter((t) => !t.completed).length;
        if (!items.length) return 'からっぽだな';
        return open ? 'あと' + open + 'こ、あとでな' : 'ぜんぶ片づいたな';
      },
    },
  };

  function renderList() {
    const kind = LIST[state.mode];
    const today = UI.startOfToday();
    if (listDay === null || listDay > today) listDay = today;

    $('pr-date').value = ymd(new Date(listDay));
    $('pr-date').max = todayStr();
    $('btn-pr-next').disabled = listDay >= today;
    $('btn-pr-save').textContent = kind.label + 'を保存';
    $('pr-msg').textContent = '';

    // 書いた日のボタン（新しい順。今日はいつも先頭）
    const days = [...new Set([today].concat(kind.days()))].filter((d) => d <= today).sort((a, b) => b - a).slice(0, DAY_CHIPS);
    const box = $('pr-days');
    box.textContent = '';
    days.forEach((d) => {
      const dt = new Date(d);
      const name = d === today ? '今日' : dt.getMonth() + 1 + '/' + dt.getDate();
      const b = UI.el('button', 'chip' + (d === listDay ? ' is-on' : ''), name);
      b.type = 'button';
      b.dataset.day = String(d);
      b.setAttribute('aria-pressed', String(d === listDay));
      box.appendChild(b);
    });

    const items = kind.items(listDay);
    $('pr-note').textContent = items.length ? '' : kind.empty;
    drawList(kind, items);
  }

  function setListDay(d) {
    listDay = Math.min(dayOf(d), UI.startOfToday());
    renderList();
  }

  // 見出し（日付・黒い札・件数）。高さを返す
  function listHead(c, draw, label, count) {
    const d = new Date(listDay);
    const y = P;
    const md = d.getMonth() + 1 + '/' + d.getDate();
    c.font = font(900, 40);
    const mdW = c.measureText(md).width;
    if (draw) {
      c.fillStyle = '#000'; c.fillText(md, P, y + 37);
      c.font = font(700, 19); c.fillText('(' + WEEK[d.getDay()] + ')', P + mdW + 4, y + 36);
    }
    c.font = font(900, 18);
    const bw = c.measureText(label).width + 20, bh = 30, bx = W - P - bw, by = y + 2;
    if (draw) {
      c.fillStyle = '#000'; T.rrect(c, bx, by, bw, bh, 8); c.fill();
      c.fillStyle = '#fff'; c.fillText(label, bx + 10, by + 22);
      c.font = font(900, 15); c.fillStyle = '#000'; c.textAlign = 'right';
      c.fillText(count, W - P, by + bh + 18); c.textAlign = 'left';
    }
    return y + 60;
  }

  // おしまい（点線とハル）。高さを返す
  function listFoot(c, draw, y, line) {
    y += 2;
    if (draw) T.dashed(c, y);
    y += 8;
    const hs = 50;
    if (draw) {
      T.haru(c, W - P - hs, y, hs);
      c.font = font(900, 16); c.fillStyle = '#000'; c.textAlign = 'right';
      c.fillText('ハル「' + line + '」', W - P - hs - 4, y + hs - 8);
      c.textAlign = 'left';
    }
    return y + hs + P - 6;
  }

  function hitoriLayout(items) {
    return (c, draw) => {
      let y = listHead(c, draw, 'ひとりごと', items.length + 'こ');
      if (draw) T.dashed(c, y);
      y += 14;
      if (!items.length) {
        c.font = font(700, 16);
        if (draw) { c.fillStyle = '#000'; c.fillText('（なし）', P, y + 18); }
        y += 30;
      }
      const tx = P + 58, maxW = W - P - tx;
      items.forEach((m, i) => {
        if (i > 0 && draw) { // 区切りの細い点線
          c.save(); c.setLineDash([2, 4]); c.lineWidth = 1; c.strokeStyle = '#000';
          c.beginPath(); c.moveTo(tx, y - 6); c.lineTo(W - P, y - 6); c.stroke(); c.restore();
        }
        c.font = font(900, 15);
        if (draw) { c.fillStyle = '#000'; c.fillText(UI.formatTime(m.createdAt), P, y + 17); }
        if (m.paw && draw) T.paw(c, P + 6, y + 25, 24);
        c.font = font(700, 18);
        const lines = T.wrapText(c, m.text, maxW);
        if (draw) { c.fillStyle = '#000'; lines.forEach((ln, k) => c.fillText(ln, tx, y + 18 + k * 25)); }
        y += Math.max(lines.length * 25, m.paw ? 52 : 25) + 12;
      });
      return listFoot(c, draw, y, LIST.hitori.haru(items));
    };
  }

  function laterLayout(items) {
    return (c, draw) => {
      const done = items.filter((t) => t.completed).length;
      let y = listHead(c, draw, 'あとで見る', items.length + 'こ' + (done ? '（済' + done + '）' : ''));
      if (draw) T.dashed(c, y);
      y += 14;
      if (!items.length) {
        c.font = font(700, 16);
        if (draw) { c.fillStyle = '#000'; c.fillText('（なし）', P, y + 18); }
        y += 30;
      }
      const tx = P + 30, maxW = W - P - tx;
      items.forEach((t) => {
        // チェック欄（終わったものには ✓）
        if (draw) {
          c.lineWidth = 2.5; c.strokeStyle = '#000';
          c.strokeRect(P + 1, y + 3, 18, 18);
          if (t.completed) {
            c.lineWidth = 3; c.beginPath();
            c.moveTo(P + 4, y + 12); c.lineTo(P + 9, y + 18); c.lineTo(P + 18, y + 5); c.stroke();
          }
        }
        c.font = font(700, 18);
        const lines = T.wrapText(c, t.text, maxW);
        if (draw) {
          c.fillStyle = '#000';
          lines.forEach((ln, k) => {
            c.fillText(ln, tx, y + 18 + k * 25);
            if (t.completed) c.fillRect(tx, y + 11 + k * 25, c.measureText(ln).width, 2); // 打ち消し線
          });
        }
        y += lines.length * 25;
        // カテゴリと画像のしるし
        const meta = [t.category ? '#' + t.category : '', t.imageId ? '［画像あり］' : ''].filter(Boolean).join('  ');
        if (meta) {
          c.font = font(700, 13);
          if (draw) { c.fillStyle = '#000'; c.fillText(meta, tx, y + 13); }
          y += 18;
        }
        y += 12;
      });
      return listFoot(c, draw, y, LIST.later.haru(items));
    };
  }

  function drawList(kind, items) {
    const layout = state.mode === 'hitori' ? hitoriLayout(items) : laterLayout(items);
    const text = items.map((x) => x.text + (x.category || '')).join('') + kind.label + kind.haru(items) +
      'こ済なし画像あり#［］ハルあとでな片づいたからっぽしずかな日きいてたよくしゃべったぜんぶ聞';
    listBlob = null;
    T.render($('pr-canvas'), $('pr-out'), layout, text).then((b) => { listBlob = b; });
  }

  function listFileName() {
    return LIST[state.mode].file + ymd(new Date(listDay)).replace(/-/g, '') + '.png';
  }

  // =========================================================
  // ボタンのひも付け（起動時に1回だけ）
  // =========================================================
  function init() {
    load();
    $('st-mode').addEventListener('click', (e) => {
      const b = e.target.closest('button'); if (!b || b.dataset.v === state.mode) return;
      setMode(b.dataset.v);
    });

    // 日記
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
    $('btn-st-save').addEventListener('click', () => T.save(lastBlob, diaryFileName(), $('st-msg')));

    // ひとりごと／あとで見る
    $('pr-form').addEventListener('submit', (e) => e.preventDefault());
    $('pr-date').addEventListener('input', (e) => {
      const d = parse(e.target.value);
      if (d) setListDay(d.getTime());
    });
    $('btn-pr-prev').addEventListener('click', () => setListDay(listDay - DAY_MS / 2)); // 前の日（夏時間でもずれないよう半日だけ戻して切り捨て）
    $('btn-pr-next').addEventListener('click', () => setListDay(listDay + DAY_MS * 1.5));
    $('pr-days').addEventListener('click', (e) => {
      const b = e.target.closest('[data-day]'); if (!b) return;
      setListDay(Number(b.dataset.day));
    });
    $('btn-pr-save').addEventListener('click', () => T.save(listBlob, listFileName(), $('pr-msg')));
  }

  return { init, render, refresh };
})();
