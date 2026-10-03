/* =========================================================
   app.js ― 「ボタンを押したら何が起きるか」を担当するファイル
   ---------------------------------------------------------
   ・保存は Storage（js/storage.js）、表示は UI（js/ui.js）に任せ、
     ここでは「押された → 保存 → 表示し直す」の流れだけを書きます。
   ・新しいボタンを足すときは、index.html にボタンを置いて、
     このファイルの一番下の on(...) に1行足すのが基本形です。
   ========================================================= */

(() => {
  const $ = (id) => document.getElementById(id);
  const on = (id, event, fn) => $(id).addEventListener(event, fn);

  // いま表示中の画面（Escキーの戻り先判定に使う）
  let current = 'home';

  // 画面を切り替える共通処理
  function go(name) {
    current = name;
    if (name === 'home') UI.renderHome();
    if (name === 'later') {
      UI.resetLaterState();
      UI.renderLater();
    }
    UI.showScreen(name);
  }

  // =========================================================
  // 1. ホーム画面
  // =========================================================

  // いまの作業を登録（「これをやる」 or Enter）
  function saveNow(e) {
    e.preventDefault();
    const input = $('now-input');
    if (!Storage.setCurrentTask(input.value)) {
      input.focus(); // 空なら何もしないで入力欄へ
      return;
    }
    input.blur(); // スマホのキーボードを閉じる
    UI.renderHome();
  }

  // 「変更」：入力欄を出して、今の内容を入れておく
  function startChange() {
    UI.renderHome(true);
    const input = $('now-input');
    input.focus();
    input.select();
  }

  // 「終わった」：いまの作業を消す（5秒以内なら取り消せる）
  function finishNow() {
    const prev = Storage.getCurrentTask();
    Storage.clearCurrentTask();
    UI.renderHome();
    UI.toast('おつかれ。', () => {
      Storage.restoreCurrentTask(prev);
      UI.renderHome();
    });
  }

  // =========================================================
  // 2. 思いつき入力 → 退避
  // =========================================================

  // 「＋ 思いついた」：入力画面を開いて、すぐ打てる状態にする
  // ※ スマホでキーボードを出すため、focus() はボタンを押した処理の中で直接呼ぶ
  function openCapture() {
    UI.hideLost();
    $('capture-input').value = '';
    go('capture');
    $('capture-input').focus();
  }

  // 「退避」：保存して、退避完了画面へ
  function stash(e) {
    if (e) e.preventDefault();
    const input = $('capture-input');
    const tab = Storage.addBrainTab(input.value);
    if (!tab) {
      input.focus();
      return;
    }
    input.blur();
    UI.renderSaved(tab.text);
    go('saved');
  }

  // 入力欄で Enter を押したら即退避（Shift+Enter は改行）
  // 日本語変換中の Enter（変換確定）では退避しない
  function captureKeydown(e) {
    if (e.key !== 'Enter' || e.shiftKey) return;
    if (e.isComposing || e.keyCode === 229) return;
    stash(e);
  }

  // 「戻る」：いまの作業が未登録なら、入力欄にカーソルを置く
  function backHome() {
    go('home');
    if (!Storage.getCurrentTask()) $('now-input').focus();
  }

  // =========================================================
  // 3. あとで見る（一覧のボタンはまとめて1か所で受け取る）
  // =========================================================
  function laterClick(e) {
    const btn = e.target.closest('[data-action]');
    if (!btn) return;
    const id = btn.dataset.id;

    switch (btn.dataset.action) {
      case 'open':
        UI.toggleOpen(id);
        break;
      case 'complete':
        Storage.toggleBrainTab(id);
        UI.toggleOpen(id); // 閉じる
        break;
      case 'delete':
        if (UI.isDeleteArmed(id)) {
          Storage.deleteBrainTab(id);
          UI.toggleOpen(id); // 閉じる
          UI.toast('削除した。');
        } else {
          UI.armDelete(id); // 1回目は「本当に削除」に変えるだけ
        }
        break;
    }
  }

  // =========================================================
  // 迷子救済
  // =========================================================
  function returnFromLost() {
    UI.hideLost();
    backHome();
  }

  // =========================================================
  // キーボード：Esc で一つ戻る（PC向けのおまけ）
  // =========================================================
  function globalKeydown(e) {
    if (e.key !== 'Escape') return;
    if (UI.isLostOpen()) return returnFromLost();
    if (current !== 'home') go('home');
  }

  // =========================================================
  // ボタンと処理のひも付け（ここを見れば全ボタンが分かる）
  // =========================================================
  on('now-form', 'submit', saveNow);
  on('btn-now-cancel', 'click', () => UI.renderHome());
  on('btn-change', 'click', startChange);
  on('btn-finish', 'click', finishNow);
  on('btn-capture', 'click', openCapture);
  on('btn-lost', 'click', UI.showLost);
  on('btn-later', 'click', () => go('later'));

  on('capture-form', 'submit', stash);
  on('capture-input', 'keydown', captureKeydown);
  on('btn-capture-cancel', 'click', () => go('home'));

  on('btn-back', 'click', backHome);
  on('btn-capture-more', 'click', openCapture);

  on('btn-later-home', 'click', () => go('home'));
  on('tab-list', 'click', laterClick);
  on('done-list', 'click', laterClick);

  on('btn-return', 'click', returnFromLost);
  document.addEventListener('keydown', globalKeydown);

  // 別タブで更新されたときなどに、ホームの表示を最新にする
  window.addEventListener('storage', () => {
    if (current === 'home') UI.renderHome();
    if (current === 'later') UI.renderLater();
  });

  // 起動時：ホームを表示
  go('home');
})();
