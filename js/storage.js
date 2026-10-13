/* =========================================================
   storage.js ― 文字データの保存と読み込みだけを担当するファイル
   ---------------------------------------------------------
   ・データはブラウザの localStorage（端末内）に保存します。
   ・画像だけは容量が大きいので js/images.js が別の場所に保存します。
   ・画面のことは一切知りません。ここを触っても見た目は変わりません。

   【保存しているデータ】
   CurrentTask（いまやっていること・1件だけ）
     { id, text, createdAt, checkedAt }
       checkedAt … 「まだやってる？」に「やってる」と答えた時刻

   BrainTab（退避した思いつき・何件でも）
     { id, text, createdAt, completed, completedAt,
       category,   … カテゴリ名（なしなら null）
       imageId,    … 添付画像のid（なしなら null）
       links }     … 関連づけた他の思いつきのid一覧

   TaskHistory（「終わった」を押した作業の記録）
     { id, text, startedAt, finishedAt }

   Mumble（ひとりごと・何件でも）
     { id, text, createdAt,
       paw }       … ハルが肉球を押していったら true

   時刻はすべて「1970年からのミリ秒」の数値です（Date.now() の値）。
   ========================================================= */

const Storage = (() => {
  // localStorage に保存するときの名前（キー）
  const KEY_CURRENT = 'noutab.currentTask';
  const KEY_TABS = 'noutab.brainTabs';
  const KEY_HISTORY = 'noutab.taskHistory';
  const KEY_MUMBLES = 'noutab.mumbles';

  // --- 内部用：安全に読み書きする小道具 ---------------------------
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

  function newId() {
    if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }

  // 古い版（MVP）で保存したデータにも新しい項目を足して揃える
  function normalize(tab) {
    return {
      id: tab.id,
      text: tab.text,
      createdAt: tab.createdAt,
      completed: !!tab.completed,
      completedAt: tab.completedAt || null,
      category: tab.category || null,
      imageId: tab.imageId || null,
      links: Array.isArray(tab.links) ? tab.links : [],
    };
  }

  function readTabs() {
    return read(KEY_TABS, []).map(normalize);
  }

  // 1件だけ書き換えて保存する共通処理
  function updateTab(id, fn) {
    const list = readTabs();
    const tab = list.find((x) => x.id === id);
    if (tab) fn(tab, list);
    write(KEY_TABS, list);
    return tab || null;
  }

  // =========================================================
  // CurrentTask（いまやっていること）
  // =========================================================

  function getCurrentTask() {
    return read(KEY_CURRENT, null);
  }

  /** 新しく登録（上書き）。text が空なら何もしない */
  function setCurrentTask(text) {
    const t = (text || '').trim();
    if (!t) return null;
    const task = { id: newId(), text: t, createdAt: Date.now(), checkedAt: null };
    write(KEY_CURRENT, task);
    return task;
  }

  /** 「変更」：文字だけ直す（始めた時刻はそのまま） */
  function renameCurrentTask(text) {
    const t = (text || '').trim();
    const task = getCurrentTask();
    if (!t || !task) return null;
    task.text = t;
    write(KEY_CURRENT, task);
    return task;
  }

  /** 「まだやってる？」に「やってる」と答えた */
  function markCurrentChecked() {
    const task = getCurrentTask();
    if (!task) return;
    task.checkedAt = Date.now();
    write(KEY_CURRENT, task);
  }

  /** 「終わった」：いまの作業を履歴へ移して消す。取り消し用の情報を返す */
  function finishCurrentTask() {
    const task = getCurrentTask();
    if (!task) return null;
    const entry = { id: newId(), text: task.text, startedAt: task.createdAt, finishedAt: Date.now() };
    const history = read(KEY_HISTORY, []);
    history.push(entry);
    write(KEY_HISTORY, history);
    write(KEY_CURRENT, null);
    return { task, entryId: entry.id };
  }

  /** 「終わった」の取り消し */
  function undoFinish(undoInfo) {
    if (!undoInfo) return;
    write(KEY_CURRENT, undoInfo.task);
    write(KEY_HISTORY, read(KEY_HISTORY, []).filter((h) => h.id !== undoInfo.entryId));
  }

  /** 終わった作業の履歴（新しい順） */
  function getTaskHistory() {
    return read(KEY_HISTORY, []).sort((a, b) => b.finishedAt - a.finishedAt);
  }

  // =========================================================
  // BrainTab（退避した思いつき）
  // =========================================================

  /** 一覧を新しい順で取得 */
  function getBrainTabs() {
    return readTabs().sort((a, b) => b.createdAt - a.createdAt);
  }

  function getBrainTab(id) {
    return readTabs().find((x) => x.id === id) || null;
  }

  /** 1件追加。imageId は画像を付けたときだけ */
  function addBrainTab(text, imageId) {
    const t = (text || '').trim();
    if (!t && !imageId) return null; // 文字も画像もなければ保存しない
    const tab = normalize({ id: newId(), text: t || '（画像）', createdAt: Date.now(), imageId });
    const list = readTabs();
    list.push(tab);
    write(KEY_TABS, list);
    return tab;
  }

  /** 完了／未完了を切り替える */
  function toggleBrainTab(id) {
    return updateTab(id, (tab) => {
      tab.completed = !tab.completed;
      tab.completedAt = tab.completed ? Date.now() : null;
    });
  }

  /** 1件削除（関連づけも外す）。消した項目を返す（画像の後片付け用） */
  function deleteBrainTab(id) {
    const list = readTabs();
    const removed = list.find((x) => x.id === id) || null;
    const rest = list.filter((x) => x.id !== id);
    rest.forEach((t) => (t.links = t.links.filter((l) => l !== id)));
    write(KEY_TABS, rest);
    return removed;
  }

  /** カテゴリを付ける（null で外す） */
  function setCategory(id, category) {
    const c = (category || '').trim() || null;
    return updateTab(id, (tab) => (tab.category = c));
  }

  /** 画像を付け替える（null で外す） */
  function setImage(id, imageId) {
    return updateTab(id, (tab) => (tab.imageId = imageId || null));
  }

  /** 使われているカテゴリ一覧（よく使う順） */
  function getCategories() {
    const count = {};
    readTabs().forEach((t) => {
      if (t.category) count[t.category] = (count[t.category] || 0) + 1;
    });
    return Object.keys(count).sort((a, b) => count[b] - count[a]);
  }

  /** 2つの思いつきを関連づける（お互いに） */
  function linkTabs(a, b) {
    if (a === b) return;
    const list = readTabs();
    const ta = list.find((x) => x.id === a);
    const tb = list.find((x) => x.id === b);
    if (!ta || !tb) return;
    if (!ta.links.includes(b)) ta.links.push(b);
    if (!tb.links.includes(a)) tb.links.push(a);
    write(KEY_TABS, list);
  }

  /** 関連づけを外す（お互いに） */
  function unlinkTabs(a, b) {
    const list = readTabs();
    list.forEach((t) => {
      if (t.id === a) t.links = t.links.filter((l) => l !== b);
      if (t.id === b) t.links = t.links.filter((l) => l !== a);
    });
    write(KEY_TABS, list);
  }

  // =========================================================
  // Mumble（ひとりごと）
  // =========================================================

  /** 全部を古い順で取得 */
  function getMumbles() {
    return read(KEY_MUMBLES, []).sort((a, b) => a.createdAt - b.createdAt);
  }

  /** 1件追加（時刻はこの瞬間）。空なら何もしない */
  function addMumble(text) {
    const t = (text || '').trim();
    if (!t) return null;
    const m = { id: newId(), text: t, createdAt: Date.now(), paw: false };
    const list = read(KEY_MUMBLES, []);
    list.push(m);
    write(KEY_MUMBLES, list);
    return m;
  }

  /** ハルの肉球を付ける／外す */
  function setMumblePaw(id, paw) {
    const list = read(KEY_MUMBLES, []);
    const m = list.find((x) => x.id === id);
    if (m) m.paw = !!paw;
    write(KEY_MUMBLES, list);
  }

  /** 1件削除。消したものを返す（取り消し用） */
  function deleteMumble(id) {
    const list = read(KEY_MUMBLES, []);
    const removed = list.find((x) => x.id === id) || null;
    write(KEY_MUMBLES, list.filter((x) => x.id !== id));
    return removed;
  }

  /** 削除の取り消し */
  function restoreMumble(m) {
    if (!m) return;
    const list = read(KEY_MUMBLES, []).filter((x) => x.id !== m.id);
    list.push(m);
    write(KEY_MUMBLES, list);
  }

  return {
    getCurrentTask,
    setCurrentTask,
    renameCurrentTask,
    markCurrentChecked,
    finishCurrentTask,
    undoFinish,
    getTaskHistory,
    getBrainTabs,
    getBrainTab,
    addBrainTab,
    toggleBrainTab,
    deleteBrainTab,
    setCategory,
    setImage,
    getCategories,
    linkTabs,
    unlinkTabs,
    getMumbles,
    addMumble,
    setMumblePaw,
    deleteMumble,
    restoreMumble,
  };
})();
