/* =========================================================
   images.js ― 添付画像の保存・読み込みを担当するファイル
   ---------------------------------------------------------
   ・画像は大きいので localStorage ではなく IndexedDB（ブラウザ内の
     大きめの保存場所）にしまいます。
   ・保存前に長い辺を 1280px まで縮めて、容量を節約します。
   ・思いつき側（storage.js）には「画像のid」だけを記録します。
   ========================================================= */

const Images = (() => {
  const DB_NAME = 'noutab';
  const STORE = 'images';
  const MAX_SIZE = 1280; // 長い辺の最大ピクセル
  const QUALITY = 0.82; // JPEGの画質（0〜1）

  let dbPromise = null;
  const urlCache = {}; // 一度表示した画像のURLを覚えておく

  // データベースを開く（初回だけ作る）
  function open() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(STORE);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    return dbPromise;
  }

  // 保存場所に対して1回分の読み書きをする共通処理
  async function run(mode, fn) {
    const db = await open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, mode);
      const req = fn(tx.objectStore(STORE));
      tx.oncomplete = () => resolve(req && req.result);
      tx.onerror = () => reject(tx.error);
    });
  }

  // 画像を縮めて JPEG にする
  function shrink(file) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      const src = URL.createObjectURL(file);
      img.onload = () => {
        const scale = Math.min(1, MAX_SIZE / Math.max(img.width, img.height));
        const canvas = document.createElement('canvas');
        canvas.width = Math.round(img.width * scale);
        canvas.height = Math.round(img.height * scale);
        canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
        URL.revokeObjectURL(src);
        canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('変換失敗'))), 'image/jpeg', QUALITY);
      };
      img.onerror = () => {
        URL.revokeObjectURL(src);
        reject(new Error('画像を読めなかった'));
      };
      img.src = src;
    });
  }

  /** ファイルを保存して、画像のidを返す */
  async function save(file) {
    const blob = await shrink(file);
    const id = 'img-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
    await run('readwrite', (s) => s.put(blob, id));
    return id;
  }

  /** 画像を表示するためのURLを返す（なければ null） */
  async function getUrl(id) {
    if (!id) return null;
    if (urlCache[id]) return urlCache[id];
    try {
      const blob = await run('readonly', (s) => s.get(id));
      if (!blob) return null;
      urlCache[id] = URL.createObjectURL(blob);
      return urlCache[id];
    } catch (e) {
      return null;
    }
  }

  /** 画像を消す */
  async function remove(id) {
    if (!id) return;
    if (urlCache[id]) {
      URL.revokeObjectURL(urlCache[id]);
      delete urlCache[id];
    }
    try {
      await run('readwrite', (s) => s.delete(id));
    } catch (e) {
      /* 消せなくても致命的ではないので無視 */
    }
  }

  // ---- 同期（js/sync.js）用 ----
  /** 画像そのもの（Blob）を返す（なければ null） */
  async function getBlob(id) {
    try {
      return (await run('readonly', (st) => st.get(id))) || null;
    } catch (e) {
      return null;
    }
  }
  /** ほかの端末から届いた画像をそのままの id でしまう */
  async function putBlob(id, blob) {
    await run('readwrite', (st) => st.put(blob, id));
  }

  return { save, getUrl, remove, getBlob, putBlob };
})();
