/* =========================================================
   app.js ― 「ボタンを押したら何が起きるか」を担当するファイル
   ---------------------------------------------------------
   ・保存は Storage / Images、表示は UI / LaterUI / ReviewUI に任せ、
     ここでは「押された → 保存 → 表示し直す」の流れだけを書きます。
   ・新しいボタンを足すときは、index.html にボタンを置いて、
     このファイルの一番下の on(...) に1行足すのが基本形です。
   ========================================================= */

(() => {
  // ---------------------------------------------------------
  // 設定（ここの数字を変えると動きが変わる）
  // ---------------------------------------------------------
  // 「まだやってる？」を出すまでの時間（分）
  const CHECK_AFTER_MINUTES = 45;

  const $ = (id) => document.getElementById(id);
  const on = (id, event, fn) => $(id).addEventListener(event, fn);

  let current = 'home'; // いま表示中の画面
  let editing = false; // ホームで「変更」中か
  let pendingImageId = null; // 入力画面で付けた（まだ退避していない）画像
  let imageTarget = 'capture'; // 画像を選んだら、どこに付けるか：'capture' / 'detail'
  let detailReturn = 'later'; // 詳細画面の「←」で戻る先：'later' / 'review'

  // =========================================================
  // 画面を切り替える共通処理
  // =========================================================
  function go(name) {
    current = name;
    if (name === 'home') {
      editing = false;
      UI.renderHome({ showCheck: shouldCheck() });
    }
    if (name === 'later') LaterUI.renderList();
    if (name === 'review') ReviewUI.render();
    if (name === 'detail') LaterUI.renderDetail();
    if (name === 'hitori') HitoriUI.render();
    if (name === 'sticker') StickerUI.render();
    UI.showScreen(name);
    if (name === 'hitori') HitoriUI.scrollToEnd();
  }

  // 「まだやってる？」を出す頃か
  function shouldCheck() {
    const task = Storage.getCurrentTask();
    if (!task) return false;
    const since = task.checkedAt || task.createdAt;
    return Date.now() - since > CHECK_AFTER_MINUTES * 60 * 1000;
  }

  // =========================================================
  // 1. ホーム画面
  // =========================================================

  // いまの作業を登録／変更（「これをやる」 or Enter）
  function saveNow(e) {
    e.preventDefault();
    const input = $('now-input');
    const ok = editing ? Storage.renameCurrentTask(input.value) : Storage.setCurrentTask(input.value);
    if (!ok) {
      input.focus(); // 空なら何もしないで入力欄へ
      return;
    }
    input.blur(); // スマホのキーボードを閉じる
    const wasNew = !editing;
    editing = false;
    UI.renderHome();
    if (wasNew) UI.haru.home.meow('にゃ'); // ハルが起きる
  }

  // 「変更」：入力欄を出して、今の内容を入れておく
  function startChange() {
    editing = true;
    UI.renderHome({ editing: true });
    const input = $('now-input');
    input.focus();
    input.select();
  }

  function cancelChange() {
    editing = false;
    UI.renderHome();
  }

  // 「終わった」：作業の履歴に残して消す（5秒以内なら取り消せる）
  function finishNow() {
    const undoInfo = Storage.finishCurrentTask();
    UI.renderHome();
    UI.toast('おつかれ。', () => {
      Storage.undoFinish(undoInfo);
      UI.renderHome();
    });
  }

  // 「まだやってる？」→「やってる」
  function stillDoing() {
    Storage.markCurrentChecked();
    UI.renderHome();
    UI.haru.home.meow('にゃ');
  }

  // =========================================================
  // 2. 思いつき入力 → 退避
  // =========================================================

  // 「＋ 思いついた」：入力画面を開いて、すぐ打てる状態にする
  // ※ スマホでキーボードを出すため、focus() はボタンを押した処理の中で直接呼ぶ
  function openCapture() {
    UI.hideLost();
    discardPendingImage();
    $('capture-input').value = '';
    go('capture');
    $('capture-input').focus();
  }

  // 「退避」：保存して、退避完了画面へ
  function stash(e) {
    if (e) e.preventDefault();
    Voice.stop();
    const input = $('capture-input');
    const tab = Storage.addBrainTab(input.value, pendingImageId);
    if (!tab) {
      input.focus();
      return;
    }
    pendingImageId = null; // 思いつきに付いたので、もう「保留中」ではない
    $('capture-attach').hidden = true;
    input.blur();
    UI.renderSaved(tab);
    go('saved');
  }

  // 入力欄で Enter を押したら即退避（Shift+Enter は改行）
  // 日本語変換中の Enter（変換確定）では退避しない
  function captureKeydown(e) {
    if (e.key !== 'Enter' || e.shiftKey) return;
    if (e.isComposing || e.keyCode === 229) return;
    stash(e);
  }

  function cancelCapture() {
    Voice.stop();
    discardPendingImage();
    go('home');
  }

  // 「戻る」：いまの作業が未登録なら、入力欄にカーソルを置く
  function backHome() {
    go('home');
    if (!Storage.getCurrentTask()) $('now-input').focus();
  }

  // --- 声で入れる ---
  function toggleVoice() {
    if (Voice.isListening()) return Voice.stop();
    const input = $('capture-input');
    const base = input.value ? input.value.replace(/\s*$/, ' ') : '';
    setVoiceButton(true);
    Voice.start(
      (text) => (input.value = base + text),
      () => setVoiceButton(false),
      (reason) => {
        setVoiceButton(false);
        if (reason === 'no-speech') UI.toast('聞き取れなかった。もう一回。');
        else if (reason !== 'aborted') UI.toast('マイクが使えなかった。キーボードのマイクを使って。');
      }
    );
  }

  function setVoiceButton(listening) {
    $('btn-voice').classList.toggle('is-on', listening);
    $('voice-label').textContent = listening ? '聞いてる…（押すと止まる）' : '声で入れる';
  }

  // --- 画像 ---
  function pickImage(target) {
    imageTarget = target;
    $('image-input').click();
  }

  async function imageChosen() {
    const file = $('image-input').files[0];
    $('image-input').value = ''; // 同じ画像をもう一度選べるように
    if (!file) return;

    let id;
    try {
      id = await Images.save(file);
    } catch (e) {
      UI.toast('画像を保存できなかった。');
      return;
    }

    if (imageTarget === 'capture') {
      discardPendingImage();
      pendingImageId = id;
      $('capture-attach-img').src = await Images.getUrl(id);
      $('capture-attach').hidden = false;
    } else {
      const tab = Storage.getBrainTab(LaterUI.getDetailId());
      if (!tab) return;
      const old = tab.imageId;
      Storage.setImage(tab.id, id);
      if (old) Images.remove(old);
      LaterUI.renderDetail();
    }
  }

  // 入力画面で付けたけど退避しなかった画像を片づける
  function discardPendingImage() {
    if (pendingImageId) Images.remove(pendingImageId);
    pendingImageId = null;
    $('capture-attach').hidden = true;
  }

  // =========================================================
  // 3. あとで見る（一覧）
  // =========================================================
  function openLater() {
    LaterUI.reset();
    go('later');
  }

  function filterClick(e) {
    const b = e.target.closest('[data-filter]');
    if (b) LaterUI.setFilter(b.dataset.filter);
  }

  // 一覧やふりかえりの項目を押したら詳細へ
  function openClick(e) {
    const b = e.target.closest('[data-open]');
    if (!b) return;
    detailReturn = current === 'review' ? 'review' : current === 'detail' ? detailReturn : 'later';
    LaterUI.openDetail(b.dataset.open);
    go('detail');
  }

  // =========================================================
  // 3'. 詳細
  // =========================================================
  function detailTab() {
    return Storage.getBrainTab(LaterUI.getDetailId());
  }

  function catClick(e) {
    const tab = detailTab();
    if (!tab) return;
    const b = e.target.closest('button');
    if (!b) return;
    if (b.dataset.newcat) {
      $('new-cat-form').hidden = false;
      $('new-cat-input').value = '';
      $('new-cat-input').focus();
      return;
    }
    // 選んでいるものをもう一度押したら外す
    Storage.setCategory(tab.id, tab.category === b.dataset.cat ? null : b.dataset.cat);
    LaterUI.renderDetail();
  }

  function newCategory(e) {
    e.preventDefault();
    const tab = detailTab();
    const name = $('new-cat-input').value.trim();
    if (!tab || !name) return $('new-cat-input').focus();
    Storage.setCategory(tab.id, name);
    $('new-cat-form').hidden = true;
    LaterUI.renderDetail();
  }

  function linkListClick(e) {
    const tab = detailTab();
    const x = e.target.closest('[data-unlink]');
    if (tab && x) {
      Storage.unlinkTabs(tab.id, x.dataset.unlink);
      LaterUI.renderDetail();
      return;
    }
    openClick(e); // 関連先の名前を押したら、その詳細へ
  }

  function pickerClick(e) {
    const tab = detailTab();
    const b = e.target.closest('[data-link]');
    if (!tab || !b) return;
    Storage.linkTabs(tab.id, b.dataset.link);
    LaterUI.closePicker();
    LaterUI.renderDetail();
    UI.toast('つないだ。');
  }

  function completeDetail() {
    const tab = Storage.toggleBrainTab(LaterUI.getDetailId());
    if (!tab) return;
    UI.toast(tab.completed ? '完了にした。' : '未完了に戻した。');
    go(detailReturn);
  }

  function deleteDetail() {
    if (!LaterUI.pressDelete()) return; // 1回目は「本当に削除」に変わるだけ
    const removed = Storage.deleteBrainTab(LaterUI.getDetailId());
    if (removed && removed.imageId) Images.remove(removed.imageId);
    UI.toast('削除した。');
    go(detailReturn);
  }

  function removeDetailImage() {
    const tab = detailTab();
    if (!tab || !tab.imageId) return;
    Images.remove(tab.imageId);
    Storage.setImage(tab.id, null);
    LaterUI.renderDetail();
  }

  // =========================================================
  // 5. ひとりごと
  // =========================================================
  // 今日のページを開いて、すぐ書ける状態にする
  // ※ スマホでキーボードを出すため、focus() はボタンを押した処理の中で直接呼ぶ
  function openHitori() {
    HitoriUI.reset();
    go('hitori');
    $('hitori-input').focus();
  }

  function postHitori(e) {
    e.preventDefault();
    HitoriUI.post();
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
    if (current === 'capture') return cancelCapture();
    if (current === 'detail') return go(detailReturn);
    if (current === 'home' && editing) return cancelChange();
    if (current !== 'home') go('home');
  }

  // URLの最後が #capture なら、いきなり入力画面を開く
  // #hitori なら、いきなり「ひとりごと」を開く
  // #sticker なら、いきなり「シール」を開く
  // （iPhoneの「ショートカット」アプリのウィジェットから開く用）
  function handleHash() {
    const hash = location.hash;
    if (hash !== '#capture' && hash !== '#hitori' && hash !== '#sticker') return;
    history.replaceState(null, '', location.pathname + location.search);
    if (hash === '#capture') openCapture();
    else if (hash === '#sticker') go('sticker');
    else openHitori();
  }

  // =========================================================
  // ボタンと処理のひも付け（ここを見れば全ボタンが分かる）
  // =========================================================
  // ホーム
  on('now-form', 'submit', saveNow);
  on('btn-now-cancel', 'click', cancelChange);
  on('btn-change', 'click', startChange);
  on('btn-finish', 'click', finishNow);
  on('btn-check-yes', 'click', stillDoing);
  on('btn-check-done', 'click', finishNow);
  on('btn-capture', 'click', openCapture);
  on('btn-lost', 'click', UI.showLost);
  on('btn-later', 'click', openLater);
  on('btn-review', 'click', () => go('review'));
  on('btn-hitori', 'click', openHitori);
  on('btn-sticker', 'click', () => go('sticker'));

  // 思いつき入力
  on('capture-form', 'submit', stash);
  on('capture-input', 'keydown', captureKeydown);
  on('btn-capture-cancel', 'click', cancelCapture);
  on('btn-voice', 'click', toggleVoice);
  on('btn-image', 'click', () => pickImage('capture'));
  on('btn-attach-remove', 'click', discardPendingImage);
  on('image-input', 'change', imageChosen);

  // 退避完了
  on('btn-back', 'click', backHome);
  on('btn-capture-more', 'click', openCapture);

  // あとで見る
  on('search', 'input', (e) => LaterUI.setQuery(e.target.value));
  on('filter-chips', 'click', filterClick);
  on('tab-list', 'click', openClick);
  on('done-list', 'click', openClick);

  // 詳細
  on('btn-detail-back', 'click', () => go(detailReturn));
  on('btn-detail-image', 'click', () => pickImage('detail'));
  on('btn-detail-image-remove', 'click', removeDetailImage);
  on('cat-chips', 'click', catClick);
  on('new-cat-form', 'submit', newCategory);
  on('link-list', 'click', linkListClick);
  on('btn-link-add', 'click', LaterUI.openPicker);
  on('picker-search', 'input', (e) => LaterUI.setPickerQuery(e.target.value));
  on('picker-list', 'click', pickerClick);
  on('btn-picker-close', 'click', LaterUI.closePicker);
  on('btn-detail-complete', 'click', completeDetail);
  on('btn-detail-delete', 'click', deleteDetail);

  // ふりかえり
  on('today-list', 'click', openClick);

  // ひとりごと
  on('hitori-form', 'submit', postHitori);
  on('hitori-input', 'keydown', HitoriUI.keydown);
  on('hitori-input', 'input', HitoriUI.grow);
  on('hitori-list', 'click', HitoriUI.listClick);
  on('btn-hitori-prev', 'click', (e) => HitoriUI.goTo(e.currentTarget.dataset.to));
  on('btn-hitori-next', 'click', (e) => HitoriUI.goTo(e.currentTarget.dataset.to));
  on('btn-hitori-today', 'click', HitoriUI.goToday);

  // 「← ホーム」ボタン（data-go="home"）
  document.querySelectorAll('[data-go]').forEach((b) =>
    b.addEventListener('click', () => go(b.dataset.go))
  );

  // 迷子救済
  on('btn-return', 'click', returnFromLost);
  document.addEventListener('keydown', globalKeydown);

  // アプリに戻ってきたとき：ホームなら「まだやってる？」を確認し直す
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && current === 'home' && !editing) {
      UI.renderHome({ showCheck: shouldCheck() });
    }
  });

  // 別タブで更新されたとき
  window.addEventListener('storage', () => {
    if (current === 'home' && !editing) UI.renderHome({ showCheck: shouldCheck() });
    if (current === 'later') LaterUI.renderList();
    if (current === 'hitori') HitoriUI.render();
  });

  window.addEventListener('hashchange', handleHash);

  // =========================================================
  // 起動
  // =========================================================
  UI.init();
  StickerUI.init();
  $('btn-voice').hidden = !Voice.isSupported(); // 使えないブラウザではボタンを出さない
  go('home');
  handleHash();
})();
