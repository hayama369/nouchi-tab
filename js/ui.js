/* =========================================================
   ui.js ― 画面表示の「共通部分」を担当するファイル
   ---------------------------------------------------------
   ・画面の切り替え、ホーム、退避完了、迷子救済、お知らせ、日時の表示形式。
   ・「あとで見る」と詳細画面は js/ui-later.js、
     「ふりかえり」は js/ui-review.js、「ひとりごと」は js/ui-hitori.js に分けてあります。
   ・ボタンを押した時に何をするか、は js/app.js 側に書いてあります。
   ========================================================= */

const UI = (() => {
  const $ = (id) => document.getElementById(id);

  let toastTimer = null;

  // ハル（4か所にいる）。init() で用意する
  const haru = { home: null, saved: null, lost: null, hitori: null };

  function init() {
    haru.home = Haru.mount($('haru-home'));
    haru.saved = Haru.mount($('haru-saved'));
    haru.lost = Haru.mount($('haru-lost'));
    haru.hitori = Haru.mount($('haru-hitori'));
  }

  // ---------------------------------------------------------
  // 画面の切り替え：'home' / 'capture' / 'saved' / 'later' / 'detail' / 'review' / 'hitori'
  // ---------------------------------------------------------
  function showScreen(name) {
    document.querySelectorAll('.screen').forEach((el) => {
      el.hidden = el.id !== 'screen-' + name;
    });
    window.scrollTo(0, 0);
  }

  // ---------------------------------------------------------
  // 1. ホーム画面
  //   editing   … 「変更」中なら true（入力欄を出す）
  //   showCheck … 「まだやってる？」を出すなら true
  // ---------------------------------------------------------
  function renderHome({ editing = false, showCheck = false } = {}) {
    const task = Storage.getCurrentTask();
    const showForm = !task || editing;

    $('now-form').hidden = !showForm;
    $('now-view').hidden = showForm;
    $('btn-now-cancel').hidden = !(task && editing);

    if (task) $('now-text').textContent = task.text;
    $('now-input').value = editing && task ? task.text : '';

    // 「まだやってる？」
    $('check').hidden = !(task && showCheck && !editing);
    if (task) $('check-text').textContent = '「' + task.text + '」、まだやってる？';

    // 「あとで見る」の横に、未完了の件数を小さく出す
    const open = Storage.getBrainTabs().filter((t) => !t.completed).length;
    $('later-count').textContent = open ? String(open) : '';

    // 何もしてないとき、ハルは寝てる
    haru.home.setSleeping(!task);
  }

  // ---------------------------------------------------------
  // 2'. 退避完了画面
  // ---------------------------------------------------------
  function renderSaved(tab) {
    const task = Storage.getCurrentTask();
    $('saved-what').textContent = '「' + tab.text + '」' + (tab.imageId ? '（画像つき）' : '');

    if (task) {
      $('saved-now-text').textContent = task.text;
      $('btn-back').textContent = '戻る';
    } else {
      $('saved-now-text').textContent = 'まだ決めてない。';
      $('btn-back').textContent = 'ホームへ';
    }
    // ハルが受け取ってくれる
    setTimeout(() => {
      haru.saved.hop();
      haru.saved.meow('にゃっ');
    }, 150);
  }

  // ---------------------------------------------------------
  // 迷子救済「わたし、何してた？」
  // ---------------------------------------------------------
  function showLost() {
    const task = Storage.getCurrentTask();
    if (task) {
      const t = task.text;
      $('lost-text').textContent = /[。.!！?？]$/.test(t) ? t : t + '。';
      $('btn-return').textContent = '戻れ。';
    } else {
      $('lost-text').textContent = '何もしてなかった。';
      $('btn-return').textContent = 'いまから決める';
    }
    $('lost').hidden = false;
    $('btn-return').focus();
    setTimeout(() => haru.lost.meow('にゃ。'), 450);
  }

  function hideLost() {
    $('lost').hidden = true;
  }

  function isLostOpen() {
    return !$('lost').hidden;
  }

  // ---------------------------------------------------------
  // 小さなお知らせ（数秒で消える）。onUndo を渡すと「取り消し」が出る
  // ---------------------------------------------------------
  function toast(message, onUndo) {
    const box = $('toast');
    const undo = $('toast-undo');
    $('toast-msg').textContent = message;
    undo.hidden = !onUndo;
    undo.onclick = onUndo
      ? () => {
          onUndo();
          box.hidden = true;
        }
      : null;
    box.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => (box.hidden = true), 5000);
  }

  // ---------------------------------------------------------
  // 日時の表示形式
  // ---------------------------------------------------------
  const DAY = 24 * 60 * 60 * 1000;

  function startOfToday() {
    const n = new Date();
    return new Date(n.getFullYear(), n.getMonth(), n.getDate()).getTime();
  }

  /** 「12:14」 */
  function formatTime(ms) {
    const d = new Date(ms);
    return d.getHours() + ':' + String(d.getMinutes()).padStart(2, '0');
  }

  /** 「今日」「昨日」「10/1」「2025/10/1」 */
  function formatDay(ms) {
    const d = new Date(ms);
    const today = startOfToday();
    if (ms >= today) return '今日';
    if (ms >= today - DAY) return '昨日';
    const md = d.getMonth() + 1 + '/' + d.getDate();
    return d.getFullYear() === new Date().getFullYear() ? md : d.getFullYear() + '/' + md;
  }

  /** 「今日 12:14」 */
  function formatDate(ms) {
    return formatDay(ms) + ' ' + formatTime(ms);
  }

  /** 「1時間12分」「8分」 */
  function formatDuration(ms) {
    const min = Math.max(1, Math.round(ms / 60000));
    const h = Math.floor(min / 60);
    const m = min % 60;
    if (!h) return m + '分';
    return h + '時間' + (m ? m + '分' : '');
  }

  // ---------------------------------------------------------
  // 小道具：要素を作る（el('p', 'クラス名', '文字')）
  // ---------------------------------------------------------
  function el(tag, className, text) {
    const e = document.createElement(tag);
    if (className) e.className = className;
    if (text !== undefined) e.textContent = text;
    return e;
  }

  return {
    init,
    haru,
    showScreen,
    renderHome,
    renderSaved,
    showLost,
    hideLost,
    isLostOpen,
    toast,
    formatTime,
    formatDay,
    formatDate,
    formatDuration,
    startOfToday,
    el,
  };
})();
