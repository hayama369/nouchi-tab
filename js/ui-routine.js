/* =========================================================
   ui-routine.js ― ホームの「今日のルーティン」（朝・夜・しんどい日の最低ライン）
   ---------------------------------------------------------
   ・時計じゃなくて「順番」で動くためのチェック欄です。押すと ✓、もう一回押すと外れます。
   ・朝4時〜16時は「朝」、それ以外は「夜」を先に見せます（タブで切り替えられる）。
     夜中の0時〜4時に押したものは、前の日のぶんに数えます。
   ・「しんどい日」を押すと、最低ライン（3つだけ）になります。それができたら合格。
   ・体調を選ぶと、シールの「日記」の体調にも入ります。
   ・保存は localStorage の noutab.routine（日ごと）。同期の対象です（js/sync.js）。
   ・やることの中身は、下の ITEMS を書きかえれば変わります。
   ========================================================= */

const RoutineUI = (() => {
  const $ = (id) => document.getElementById(id);
  const KEY = 'noutab.routine';
  const KEEP_DAYS = 45; // これより古い日の記録は消す
  const DAY_START_HOUR = 4; // 一日の始まり（この時刻より前は前の日あつかい）
  const NIGHT_FROM_HOUR = 16; // この時刻から「夜」を先に見せる

  // ---------------------------------------------------------
  // やること（id が同じなら、朝・夜・最低ラインで ✓ を共有する）
  //   go … 横に出すボタン（押すと app.js に頼んでその画面へ）
  // ---------------------------------------------------------
  const ITEMS = {
    morning: [
      { id: 'water', text: '水をひと口' },
      { id: 'cond', text: '今日の体調を決める', cond: true },
      { id: 'tarot', text: 'タロットを1枚引いて手帳に書く' },
      { id: 'print', text: '昨日のひとりごとと「まだのぜんぶ」を印刷して貼る', go: 'print', goLabel: 'シールへ' },
      { id: 'pick', text: '今日やることを1つだけ決める', go: 'now', goLabel: '入れる' },
    ],
    night: [
      { id: 'diary', text: '日記シールを作って貼る', go: 'diary', goLabel: 'シールへ' },
      { id: 'money', text: 'うちのことで「残ってるお金」を見る' },
      { id: 'sleep', text: '眠剤を飲んで寝る' },
    ],
    easy: [
      { id: 'water', text: '水をひと口' },
      { id: 'tarot', text: 'タロットを1枚引いて手帳に書く' },
      { id: 'diary', text: '日記シール（ちいさめ）を貼る', go: 'diary', goLabel: 'シールへ' },
    ],
  };
  const SECTION_NAME = { morning: '朝', night: '夜', easy: '最低ライン' };
  const DONE_MSG = {
    morning: '朝のぶん、ぜんぶできた。',
    night: '夜のぶんもできた。おやすみ。',
    easy: '最低ライン、クリア。今日はそれで合格。',
  };
  const CONDS = [
    { v: 'good', label: 'いい' },
    { v: 'ok', label: 'ふつう' },
    { v: 'hard', label: 'しんどい' },
    { v: 'sick', label: '吐いた' },
  ];

  let onGo = () => {};
  let view = null; // 'morning' / 'night'（タブで選んだほう。null なら時刻で決める）
  let viewDay = null;

  // ---------------------------------------------------------
  // 保存
  // ---------------------------------------------------------
  function dayKey(ms) {
    const d = new Date((ms || Date.now()) - DAY_START_HOUR * 3600000);
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }
  function readAll() {
    try {
      const v = JSON.parse(localStorage.getItem(KEY));
      return v && typeof v === 'object' ? v : {};
    } catch (e) {
      return {};
    }
  }
  function writeAll(all) {
    // 古い日を片づける
    const keys = Object.keys(all).sort();
    while (keys.length > KEEP_DAYS) delete all[keys.shift()];
    try { localStorage.setItem(KEY, JSON.stringify(all)); } catch (e) { /* 保存できなくても画面は使える */ }
  }
  function today() {
    const all = readAll();
    const d = all[dayKey()] || {};
    return { done: d.done && typeof d.done === 'object' ? d.done : {}, easy: !!d.easy, cond: d.cond || null };
  }
  function update(fn) {
    const all = readAll();
    const k = dayKey();
    const d = Object.assign({ done: {}, easy: false, cond: null }, all[k] || {});
    d.done = Object.assign({}, d.done);
    fn(d);
    all[k] = d;
    writeAll(all);
  }

  // ---------------------------------------------------------
  // 表示
  // ---------------------------------------------------------
  function currentSection(t) {
    if (t.easy) return 'easy';
    if (viewDay !== dayKey()) { view = null; viewDay = dayKey(); }
    if (view) return view;
    const h = new Date().getHours();
    return h >= DAY_START_HOUR && h < NIGHT_FROM_HOUR ? 'morning' : 'night';
  }
  function count(section, t) {
    const items = ITEMS[section];
    return { done: items.filter((it) => t.done[it.id]).length, all: items.length };
  }

  function render() {
    const t = today();
    const sec = currentSection(t);

    const easyBtn = $('btn-routine-easy');
    easyBtn.setAttribute('aria-pressed', String(t.easy));
    easyBtn.textContent = t.easy ? 'しんどい日（もどす）' : 'しんどい日にする';

    // 朝／夜のタブ（しんどい日は出さない）
    const tabs = $('routine-tabs');
    tabs.hidden = t.easy;
    tabs.querySelectorAll('[data-sec]').forEach((b) => {
      const c = count(b.dataset.sec, t);
      b.setAttribute('aria-selected', String(b.dataset.sec === sec));
      b.querySelector('.routine-tab-count').textContent = c.done + '/' + c.all;
      b.classList.toggle('is-complete', c.done === c.all);
    });

    const list = $('routine-list');
    list.textContent = '';
    ITEMS[sec].forEach((it) => {
      const done = !!t.done[it.id];
      const li = UI.el('li', 'routine-item' + (done ? ' is-done' : ''));
      const check = UI.el('button', 'routine-check');
      check.type = 'button';
      check.dataset.check = it.id;
      check.setAttribute('aria-pressed', String(done));
      check.setAttribute('aria-label', it.text + (done ? '（できた）' : ''));
      check.innerHTML = '<span class="routine-box" aria-hidden="true"></span>';
      const text = UI.el('span', 'routine-text', it.text);
      check.appendChild(text);
      li.appendChild(check);

      if (it.go) {
        const b = UI.el('button', 'btn btn-quiet btn-small routine-go', it.goLabel);
        b.type = 'button';
        b.dataset.rgo = it.go;
        li.appendChild(b);
      }
      if (it.cond) {
        const row = UI.el('div', 'routine-conds');
        row.setAttribute('role', 'group');
        row.setAttribute('aria-label', '今日の体調');
        CONDS.forEach((c) => {
          const b = UI.el('button', 'chip' + (t.cond === c.v ? ' is-on' : ''), c.label);
          b.type = 'button';
          b.dataset.cond = c.v;
          b.setAttribute('aria-pressed', String(t.cond === c.v));
          row.appendChild(b);
        });
        li.appendChild(row);
      }
      list.appendChild(li);
    });

    const c = count(sec, t);
    const msg = $('routine-msg');
    if (c.done === c.all) msg.textContent = DONE_MSG[sec];
    else if (!t.easy && (t.cond === 'hard' || t.cond === 'sick')) msg.textContent = 'しんどいなら、上の「しんどい日にする」で3つだけにしていい。';
    else msg.textContent = '';
  }

  // ---------------------------------------------------------
  // 操作
  // ---------------------------------------------------------
  /** ✓ を付ける（すでに付いていれば何もしない）。ほかの画面からも呼ぶ（js/app.js・js/ui-sticker.js） */
  function mark(id) {
    if (today().done[id]) return;
    update((d) => { d.done[id] = Date.now(); });
    render();
  }

  function toggle(id) {
    const t = today();
    const sec = currentSection(t);
    const wasDone = !!t.done[id];
    update((d) => {
      if (wasDone) delete d.done[id];
      else d.done[id] = Date.now();
    });
    render();
    if (!wasDone) {
      const after = today();
      const c = count(sec, after);
      if (c.done === c.all) UI.haru.home.meow(after.easy ? 'えらい' : 'やるじゃん');
      else UI.haru.home.meow('にゃ');
    }
  }

  function setCond(v) {
    update((d) => {
      d.cond = v;
      d.done.cond = d.done.cond || Date.now();
    });
    StickerUI.setCond(v); // シールの日記にも入れる
    render();
  }

  function listClick(e) {
    const go = e.target.closest('[data-rgo]');
    if (go) return onGo(go.dataset.rgo);
    const cond = e.target.closest('[data-cond]');
    if (cond) return setCond(cond.dataset.cond);
    const check = e.target.closest('[data-check]');
    if (check) toggle(check.dataset.check);
  }

  function init(opts) {
    onGo = (opts && opts.go) || onGo;
    $('routine-list').addEventListener('click', listClick);
    $('routine-tabs').addEventListener('click', (e) => {
      const b = e.target.closest('[data-sec]');
      if (!b) return;
      view = b.dataset.sec;
      viewDay = dayKey();
      render();
    });
    $('btn-routine-easy').addEventListener('click', () => {
      update((d) => { d.easy = !d.easy; });
      render();
    });
  }

  /** 今日は「しんどい日」か */
  function isEasy() {
    return today().easy;
  }

  return { init, render, mark, isEasy, dayKey };
})();
