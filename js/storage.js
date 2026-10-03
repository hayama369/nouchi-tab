/* =========================================================
   storage.js ― データの保存と読み込みだけを担当するファイル
   ---------------------------------------------------------
   ・データはブラウザの localStorage（端末内）に保存します。
   ・画面のことは一切知りません。ここを触っても見た目は変わりません。
   ・将来クラウド同期などに変えたくなったら、このファイルだけ差し替えればOK。

   【保存しているデータ】
   CurrentTask（いまやっていること・1件だけ）
     { id, text, createdAt }
   BrainTab（退避した思いつき・何件でも）
     { id, text, createdAt, completed }
   createdAt は「1970年からのミリ秒」の数値です（Date.now() の値）。
   ========================================================= */

const Storage = (() => {
  // localStorage に保存するときの名前（キー）
  const KEY_CURRENT = 'noutab.currentTask';
  const KEY_TABS = 'noutab.brainTabs';

  // --- 内部用：安全に読み書きする小道具 ---------------------------
  // （プライベートモード等で localStorage が使えない時にアプリが落ちないよう、
  //   失敗しても静かに続行します）
  function read(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch (e) {
      return fallback;
    }
  }

  function write(key, value) {
    try {
      if (value === null) localStorage.removeItem(key);
      else localStorage.setItem(key, JSON.stringify(value));
    } catch (e) {
      /* 保存できない環境では何もしない */
    }
  }

  // ランダムなIDを作る
  function newId() {
    if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }

  // --- CurrentTask（いまやっていること） ---------------------------

  /** いまの作業を取得。なければ null */
  function getCurrentTask() {
    return read(KEY_CURRENT, null);
  }

  /** いまの作業を登録（上書き）。text が空なら何もしない */
  function setCurrentTask(text) {
    const t = (text || '').trim();
    if (!t) return null;
    const task = { id: newId(), text: t, createdAt: Date.now() };
    write(KEY_CURRENT, task);
    return task;
  }

  /** いまの作業を丸ごと戻す（「取り消し」用） */
  function restoreCurrentTask(task) {
    write(KEY_CURRENT, task);
  }

  /** いまの作業を消す（「終わった」） */
  function clearCurrentTask() {
    write(KEY_CURRENT, null);
  }

  // --- BrainTab（退避した思いつき） --------------------------------

  /** 思いつき一覧を新しい順で取得 */
  function getBrainTabs() {
    const list = read(KEY_TABS, []);
    return list.slice().sort((a, b) => b.createdAt - a.createdAt);
  }

  /** 思いつきを1件追加。追加したものを返す */
  function addBrainTab(text) {
    const t = (text || '').trim();
    if (!t) return null;
    const tab = { id: newId(), text: t, createdAt: Date.now(), completed: false };
    const list = read(KEY_TABS, []);
    list.push(tab);
    write(KEY_TABS, list);
    return tab;
  }

  /** 完了／未完了を切り替える */
  function toggleBrainTab(id) {
    const list = read(KEY_TABS, []);
    const tab = list.find((x) => x.id === id);
    if (tab) tab.completed = !tab.completed;
    write(KEY_TABS, list);
  }

  /** 1件削除 */
  function deleteBrainTab(id) {
    const list = read(KEY_TABS, []).filter((x) => x.id !== id);
    write(KEY_TABS, list);
  }

  // 外から使える機能だけを公開
  return {
    getCurrentTask,
    setCurrentTask,
    restoreCurrentTask,
    clearCurrentTask,
    getBrainTabs,
    addBrainTab,
    toggleBrainTab,
    deleteBrainTab,
  };
})();
