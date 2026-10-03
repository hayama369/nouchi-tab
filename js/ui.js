/* =========================================================
   ui.js ― 画面の「表示」と「切り替え」を担当するファイル
   ---------------------------------------------------------
   ・データを読んで、画面に書き出すだけ。
   ・ボタンを押した時に何をするか、は js/app.js 側に書いてあります。
   ・表示される文言を変えたい場合は、ここか index.html を探してください。
   ========================================================= */

const UI = (() => {
  // id で要素を探す短縮形
  const $ = (id) => document.getElementById(id);

  // いま「あとで見る」で開いている項目のid（タップで完了/削除が出る項目）
  let openId = null;
  // 削除ボタンを1回押して「本当に削除？」状態になっている項目のid
  let armedDeleteId = null;
  // お知らせ（トースト）を消すためのタイマー
  let toastTimer = null;

  // ---------------------------------------------------------
  // 画面の切り替え：name は 'home' / 'capture' / 'saved' / 'later'
  // ---------------------------------------------------------
  function showScreen(name) {
    document.querySelectorAll('.screen').forEach((el) => {
      el.hidden = el.id !== 'screen-' + name;
    });
    window.scrollTo(0, 0);
  }

  // ---------------------------------------------------------
  // 1. ホーム画面
  //    editing = true のときは「変更」中なので入力欄を出す
  // ---------------------------------------------------------
  function renderHome(editing = false) {
    const task = Storage.getCurrentTask();
    const showForm = !task || editing;

    $('now-form').hidden = !showForm;
    $('now-view').hidden = showForm;
    // 「やめる」は変更中だけ出す（未登録のときは戻る先がないので出さない）
    $('btn-now-cancel').hidden = !(task && editing);

    if (task) $('now-text').textContent = task.text;
    $('now-input').value = editing && task ? task.text : '';

    // 「あとで見る」の横に、未完了の件数を小さく出す
    const open = Storage.getBrainTabs().filter((t) => !t.completed).length;
    $('later-count').textContent = open ? String(open) : '';
  }

  // ---------------------------------------------------------
  // 2'. 退避完了画面：stashedText は今退避した内容
  // ---------------------------------------------------------
  function renderSaved(stashedText) {
    const task = Storage.getCurrentTask();
    $('saved-what').textContent = '「' + stashedText + '」';

    if (task) {
      $('saved-now-text').textContent = task.text;
      $('btn-back').textContent = '戻る';
    } else {
      $('saved-now-text').textContent = 'まだ決めてない。';
      $('btn-back').textContent = 'ホームへ';
    }
  }

  // ---------------------------------------------------------
  // 3. あとで見る
  // ---------------------------------------------------------
  function renderLater() {
    const tabs = Storage.getBrainTabs(); // すでに新しい順
    const active = tabs.filter((t) => !t.completed);
    const done = tabs.filter((t) => t.completed);

    $('later-empty').hidden = tabs.length > 0;
    fillList($('tab-list'), active);

    $('done-box').hidden = done.length === 0;
    $('done-count').textContent = String(done.length);
    fillList($('done-list'), done);
  }

  // 一覧（ul）の中身を作り直す
  function fillList(ul, tabs) {
    ul.textContent = '';
    tabs.forEach((tab) => ul.appendChild(buildItem(tab)));
  }

  // 1件分の見た目を作る
  function buildItem(tab) {
    const li = document.createElement('li');
    li.className = 'tab-item' + (tab.completed ? ' is-done' : '') + (tab.id === openId ? ' is-open' : '');

    // 本体（タップで開閉）
    const main = document.createElement('button');
    main.type = 'button';
    main.className = 'tab-main';
    main.dataset.action = 'open';
    main.dataset.id = tab.id;
    main.setAttribute('aria-expanded', tab.id === openId ? 'true' : 'false');

    const text = document.createElement('span');
    text.className = 'tab-text';
    text.textContent = tab.text;

    const time = document.createElement('time');
    time.className = 'tab-time';
    time.dateTime = new Date(tab.createdAt).toISOString();
    time.textContent = formatDate(tab.createdAt);

    main.append(text, time);
    li.appendChild(main);

    // 開いている項目だけ「完了」「削除」を出す
    if (tab.id === openId) {
      const actions = document.createElement('div');
      actions.className = 'tab-actions';

      const doneBtn = document.createElement('button');
      doneBtn.type = 'button';
      doneBtn.className = 'btn btn-solid btn-small';
      doneBtn.dataset.action = 'complete';
      doneBtn.dataset.id = tab.id;
      doneBtn.textContent = tab.completed ? '未完了に戻す' : '完了';

      const delBtn = document.createElement('button');
      delBtn.type = 'button';
      const armed = tab.id === armedDeleteId;
      delBtn.className = 'btn btn-small ' + (armed ? 'btn-danger' : 'btn-ghost');
      delBtn.dataset.action = 'delete';
      delBtn.dataset.id = tab.id;
      // 誤タップ防止：1回目で「本当に削除」に変わり、2回目で消える
      delBtn.textContent = armed ? '本当に削除' : '削除';

      actions.append(doneBtn, delBtn);
      li.appendChild(actions);
    }
    return li;
  }

  // 項目を開く／閉じる
  function toggleOpen(id) {
    openId = openId === id ? null : id;
    armedDeleteId = null;
    renderLater();
  }

  // 削除ボタンの「1回目押した」状態を管理
  function isDeleteArmed(id) {
    return armedDeleteId === id;
  }
  function armDelete(id) {
    armedDeleteId = id;
    renderLater();
  }
  function resetLaterState() {
    openId = null;
    armedDeleteId = null;
  }

  // ---------------------------------------------------------
  // 迷子救済「わたし、何してた？」
  // ---------------------------------------------------------
  function showLost() {
    const task = Storage.getCurrentTask();
    if (task) {
      // 末尾に「。」が無ければ付ける（「〜描く。」のように言い切る）
      const t = task.text;
      $('lost-text').textContent = /[。.!！?？]$/.test(t) ? t : t + '。';
      $('btn-return').textContent = '戻れ。';
    } else {
      $('lost-text').textContent = '何もしてなかった。';
      $('btn-return').textContent = 'いまから決める';
    }
    $('lost').hidden = false;
    $('btn-return').focus();
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
  // 日時を短く表示：「今日 12:14」「昨日 9:03」「10/1 9:03」
  // ---------------------------------------------------------
  function formatDate(ms) {
    const d = new Date(ms);
    const now = new Date();
    const hm = d.getHours() + ':' + String(d.getMinutes()).padStart(2, '0');
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    const DAY = 24 * 60 * 60 * 1000;

    if (ms >= startOfToday) return '今日 ' + hm;
    if (ms >= startOfToday - DAY) return '昨日 ' + hm;
    const md = d.getMonth() + 1 + '/' + d.getDate();
    if (d.getFullYear() === now.getFullYear()) return md + ' ' + hm;
    return d.getFullYear() + '/' + md + ' ' + hm;
  }

  return {
    showScreen,
    renderHome,
    renderSaved,
    renderLater,
    toggleOpen,
    isDeleteArmed,
    armDelete,
    resetLaterState,
    showLost,
    hideLost,
    isLostOpen,
    toast,
  };
})();
