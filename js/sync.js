/* =========================================================
   sync.js ― 合言葉で、ほかの端末（Mac と iPhone など）と同期する係
   ---------------------------------------------------------
   しくみ：
     ・置き場所は「うちのこと」のサーバー（/api/sync）を借りています。
       合言葉の頭に "noutab:" を付けて送るので、うちのことのデータとは混ざりません。
     ・この端末で変わった記録だけを送り、ほかの端末で変わった記録を受け取ります。
     ・同じ記録を両方で変えていたら、後から変えたほうを残します。
   同期するもの：
     いまの作業・あとで見る（思いつき）・終わった作業・ひとりごと・
     描く（記録・タイマー・これまでの時間）・今日のルーティン・思いつきの画像
     （シールの設定は端末ごと）
   いつ同期するか：
     ・何かを変えた2秒後　・画面を開いている間は30秒ごと
     ・アプリに戻ってきたとき、ネットにつながったとき
   合言葉そのものはサーバーに保存されません（暗号化した値を置き場所の名前にするだけ）。
   ========================================================= */

const Sync = (() => {
  const ENDPOINT = 'https://uchinokoto.vercel.app/api/sync';
  const PREFIX = 'noutab:'; // うちのことと置き場所を分けるための目印
  const INTERVAL = 30000;
  const OVERLAP = 5000; // 取りこぼし防止に、少し前から受け取り直す（ミリ秒）
  const MAX_BATCH_BYTES = 2.5 * 1024 * 1024; // 1回に送る量の上限
  const IMG_MAX = 1024; // 送る画像の長い辺
  const IMG_LIMIT = 280 * 1024; // これより大きい画像は縮め直して送る

  const K = {
    code: 'noutab.sync.code',
    shadow: 'noutab.sync.shadow', // 最後に同期したときの各記録の「指紋」と時刻
    since: 'noutab.sync.since',
    last: 'noutab.sync.last',
  };
  const DATA = {
    tabs: 'noutab.brainTabs',
    history: 'noutab.taskHistory',
    mumbles: 'noutab.mumbles',
    current: 'noutab.currentTask',
    draw: 'noutab.draw',
    routine: 'noutab.routine',
  };
  const ARRAYS = { tabs: DATA.tabs, history: DATA.history, mumbles: DATA.mumbles };
  // この版が知っている記録の種類。知らない種類（新しい版で増えたもの）は、消したことにして送らない。
  // ※ 古い版が「知らない記録＝消えた」と送ってしまい、新しい版のデータが消える事故を防ぐため
  const KNOWN_COLS = ['tabs', 'history', 'mumbles', 'meta', 'draw', 'routine', 'images'];
  // 消した知らせを受け取っても消さない種類（古い版からの「消えた」を無視する）
  const KEEP_ON_DELETE = ['routine'];

  const ls = window.localStorage;
  let applying = false; // 受け取った記録を書き込み中（そのときは「変わった」と数えない）
  let running = false;
  let again = false;
  let pushTimer = null;
  let loopTimer = null;
  let status = 'off'; // off / syncing / ok / offline / error
  const listeners = new Set();

  // ---------------------------------------------------------
  // 小道具
  // ---------------------------------------------------------
  function read(key, fallback) {
    try {
      const raw = ls.getItem(key);
      return raw === null ? fallback : JSON.parse(raw);
    } catch (e) {
      return fallback;
    }
  }
  function write(key, value) {
    applying = true;
    try {
      ls.setItem(key, JSON.stringify(value));
    } catch (e) {
      /* 容量いっぱいなど */
    } finally {
      applying = false;
    }
  }
  /** 文字列の短い指紋（同じ内容なら同じ値） */
  function hash(str) {
    let h = 5381;
    for (let i = 0; i < str.length; i++) h = ((h << 5) + h + str.charCodeAt(i)) | 0;
    return (h >>> 0).toString(36) + ':' + str.length;
  }
  const code = () => ls.getItem(K.code) || null;

  // ---------------------------------------------------------
  // この端末の記録を「col/id → 中身」に並べる
  // ---------------------------------------------------------
  function collect() {
    const map = new Map();
    Object.entries(ARRAYS).forEach(([col, key]) => {
      const list = read(key, []);
      if (Array.isArray(list)) list.forEach((r) => r && r.id && map.set(col + '/' + r.id, r));
    });
    map.set('meta/currentTask', { value: read(DATA.current, null) });
    const draw = read(DATA.draw, {}) || {};
    (Array.isArray(draw.sessions) ? draw.sessions : []).forEach((s) => s && s.id && map.set('draw/' + s.id, s));
    map.set('meta/drawState', { running: draw.running || null, target: draw.target || 30, baseMin: +draw.baseMin || 0 });
    const routine = read(DATA.routine, {}) || {};
    Object.entries(routine).forEach(([day, d]) => d && typeof d === 'object' && map.set('routine/' + day, d));
    return map;
  }

  /** 思いつきに付いている画像の id */
  function imageIds() {
    const list = read(DATA.tabs, []);
    return [...new Set((Array.isArray(list) ? list : []).map((t) => t && t.imageId).filter(Boolean))];
  }

  // ---------------------------------------------------------
  // 受け取った記録を、この端末に書き込む
  // ---------------------------------------------------------
  async function applyRemote(records, shadow) {
    const byCol = {};
    let changed = false;
    for (const r of records) {
      if (!r || typeof r.col !== 'string' || typeof r.id !== 'string') continue;
      const key = r.col + '/' + r.id;
      const mine = shadow[key];
      if (mine && mine.u >= (r.updatedAt || 0)) continue; // こっちのほうが新しい（か同じ）
      if (r.deleted && KEEP_ON_DELETE.includes(r.col)) continue; // 古い版からの「消えた」は無視
      if (r.col === 'images') {
        if (!r.deleted && r.data && r.data.d) {
          try {
            const blob = await (await fetch(r.data.d)).blob();
            await Images.putBlob(r.id, blob);
          } catch (e) {
            continue; // 書けなかったら、次の同期でまた受け取る
          }
        }
        shadow[key] = { h: 'img', u: r.updatedAt || 0, del: !!r.deleted };
        changed = true;
        continue;
      }
      (byCol[r.col] = byCol[r.col] || []).push(r);
      shadow[key] = { h: r.deleted ? 'del' : hash(JSON.stringify(r.data)), u: r.updatedAt || 0, del: !!r.deleted };
      changed = true;
    }

    // 配列のデータ（思いつき・作業の記録・ひとりごと）
    Object.entries(ARRAYS).forEach(([col, key]) => {
      const rs = byCol[col];
      if (!rs) return;
      const list = read(key, []);
      const arr = Array.isArray(list) ? list : [];
      rs.forEach((r) => {
        const i = arr.findIndex((x) => x && x.id === r.id);
        if (r.deleted) {
          if (i >= 0) arr.splice(i, 1);
        } else if (i >= 0) arr[i] = r.data;
        else arr.push(r.data);
      });
      write(key, arr);
    });

    // 描く（記録とタイマーの状態）
    if (byCol.draw || (byCol.meta && byCol.meta.some((r) => r.id === 'drawState'))) {
      const draw = read(DATA.draw, {}) || {};
      const sessions = Array.isArray(draw.sessions) ? draw.sessions : [];
      (byCol.draw || []).forEach((r) => {
        const i = sessions.findIndex((x) => x && x.id === r.id);
        if (r.deleted) {
          if (i >= 0) sessions.splice(i, 1);
        } else if (i >= 0) sessions[i] = r.data;
        else sessions.push(r.data);
      });
      draw.sessions = sessions;
      const st = (byCol.meta || []).find((r) => r.id === 'drawState');
      if (st && !st.deleted && st.data) {
        draw.running = st.data.running || null;
        draw.target = st.data.target || 30;
        draw.baseMin = +st.data.baseMin || 0;
      }
      write(DATA.draw, draw);
    }

    // 今日のルーティン（日ごと）
    if (byCol.routine) {
      const routine = read(DATA.routine, {}) || {};
      byCol.routine.forEach((r) => {
        if (r.deleted) delete routine[r.id];
        else if (r.data) routine[r.id] = r.data;
      });
      write(DATA.routine, routine);
    }

    // いまの作業
    const cur = (byCol.meta || []).find((r) => r.id === 'currentTask');
    if (cur && !cur.deleted && cur.data) write(DATA.current, cur.data.value || null);

    return changed;
  }

  // ---------------------------------------------------------
  // 画像を送れる大きさの文字（data URL）にする
  // ---------------------------------------------------------
  function blobToDataUrl(blob) {
    return new Promise((resolve, reject) => {
      const fr = new FileReader();
      fr.onload = () => resolve(fr.result);
      fr.onerror = () => reject(fr.error);
      fr.readAsDataURL(blob);
    });
  }
  function shrink(blob) {
    if (blob.size <= IMG_LIMIT) return Promise.resolve(blob);
    return new Promise((resolve) => {
      const img = new Image();
      const src = URL.createObjectURL(blob);
      img.onload = () => {
        const scale = Math.min(1, IMG_MAX / Math.max(img.width, img.height));
        const c = document.createElement('canvas');
        c.width = Math.round(img.width * scale);
        c.height = Math.round(img.height * scale);
        c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
        URL.revokeObjectURL(src);
        c.toBlob((b) => resolve(b || blob), 'image/jpeg', 0.72);
      };
      img.onerror = () => {
        URL.revokeObjectURL(src);
        resolve(blob);
      };
      img.src = src;
    });
  }

  // ---------------------------------------------------------
  // 同期を1回
  // ---------------------------------------------------------
  async function run() {
    const c = code();
    if (!c) return;
    if (running) {
      again = true;
      return;
    }
    running = true;
    setStatus('syncing');
    try {
      let shadow = read(K.shadow, null);
      const first = !shadow;
      shadow = shadow || {};
      let since = +ls.getItem(K.since) || 0;
      let gotAny = false;

      // はじめてつなぐ端末は、先に向こうの記録を受け取る（向こうを優先）
      if (first) {
        const res = await post({ code: PREFIX + c, since: 0, records: [] });
        gotAny = (await applyRemote(res.records || [], shadow)) || gotAny;
        since = Math.max(0, res.now - OVERLAP);
      }

      // この端末で変わった記録を集める
      const now = Date.now();
      const out = [];
      const cur = collect();
      cur.forEach((data, key) => {
        const h = hash(JSON.stringify(data));
        const sh = shadow[key];
        if (sh && sh.h === h && !sh.del) return;
        const u = Math.max(now, ((sh && sh.u) || 0) + 1);
        const [col, ...rest] = key.split('/');
        out.push({ col, id: rest.join('/'), updatedAt: u, data });
        shadow[key] = { h, u };
      });
      Object.keys(shadow).forEach((key) => {
        if (key.startsWith('images/') || shadow[key].del || cur.has(key)) return;
        if (!KNOWN_COLS.includes(key.split('/')[0])) return; // 知らない種類は消さない
        const u = Math.max(now, shadow[key].u + 1);
        const [col, ...rest] = key.split('/');
        out.push({ col, id: rest.join('/'), updatedAt: u, deleted: true });
        shadow[key] = { h: 'del', u, del: true };
      });
      for (const id of imageIds()) {
        const key = 'images/' + id;
        if (shadow[key] && !shadow[key].del) continue;
        const blob = await Images.getBlob(id);
        if (!blob) continue;
        const d = await blobToDataUrl(await shrink(blob));
        out.push({ col: 'images', id, updatedAt: now, data: { d } });
        shadow[key] = { h: 'img', u: now };
      }

      // 大きすぎないように分けて送る（送るものがなくても、受け取りのために1回は通信する）
      const batches = [];
      let batch = [];
      let size = 0;
      out.forEach((r) => {
        const n = JSON.stringify(r).length;
        if (batch.length && size + n > MAX_BATCH_BYTES) {
          batches.push(batch);
          batch = [];
          size = 0;
        }
        batch.push(r);
        size += n;
      });
      batches.push(batch);
      for (const b of batches) {
        const res = await post({ code: PREFIX + c, since, records: b });
        gotAny = (await applyRemote(res.records || [], shadow)) || gotAny;
        since = Math.max(0, res.now - OVERLAP);
      }

      write(K.shadow, shadow);
      applying = true;
      ls.setItem(K.since, String(since));
      ls.setItem(K.last, String(Date.now()));
      applying = false;
      setStatus('ok');
      if (gotAny) window.dispatchEvent(new CustomEvent('noutab:synced'));
    } catch (e) {
      applying = false;
      setStatus(navigator.onLine === false || e.network ? 'offline' : 'error');
    } finally {
      running = false;
      if (again) {
        again = false;
        schedule(500);
      }
    }
  }

  async function post(body) {
    let res;
    try {
      res = await fetch(ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
    } catch (e) {
      const err = new Error('network');
      err.network = true;
      throw err;
    }
    if (!res.ok) {
      const err = new Error('http ' + res.status);
      err.status = res.status;
      throw err;
    }
    return res.json();
  }

  function schedule(ms) {
    if (!code()) return;
    clearTimeout(pushTimer);
    pushTimer = setTimeout(run, ms);
  }
  function loop() {
    clearTimeout(loopTimer);
    loopTimer = setTimeout(() => {
      if (document.visibilityState === 'visible') run();
      loop();
    }, INTERVAL);
  }

  // ---------------------------------------------------------
  // 合言葉
  // ---------------------------------------------------------
  function normalize(c) {
    return (c || '').trim().toLowerCase().replace(/[\s　]+/g, '-');
  }
  function generateCode() {
    const words = ['haru', 'yoru', 'tsuki', 'hoshi', 'kumo', 'mori', 'umi', 'sora', 'akari', 'neko', 'koto', 'mado', 'yuki', 'kaze', 'hana', 'kage', 'niwa', 'oto'];
    const r = () => {
      const a = new Uint32Array(1);
      crypto.getRandomValues(a);
      return a[0] / 4294967296;
    };
    const pick = () => words[Math.floor(r() * words.length)];
    return [pick(), pick(), pick(), String(Math.floor(r() * 9000) + 1000)].join('-');
  }
  function connect(newCode) {
    const c = normalize(newCode);
    if (c.length < 8) return false;
    applying = true;
    ls.setItem(K.code, c);
    ls.removeItem(K.shadow); // つなぎ直したら、はじめから合わせ直す
    ls.removeItem(K.since);
    applying = false;
    run();
    return true;
  }
  function disconnect() {
    applying = true;
    [K.code, K.shadow, K.since, K.last].forEach((k) => ls.removeItem(k));
    applying = false;
    setStatus('off');
  }

  // ---------------------------------------------------------
  // 状態のお知らせ・画面（ふりかえりの一番下）
  // ---------------------------------------------------------
  function setStatus(s) {
    status = s;
    listeners.forEach((fn) => fn(s));
    render();
  }
  function onStatus(fn) {
    listeners.add(fn);
  }

  function render() {
    const $ = (id) => document.getElementById(id);
    if (!$('sync-card')) return;
    const c = code();
    $('sync-off').hidden = !!c;
    $('sync-on').hidden = !c;
    if (!c) return;
    $('sync-code').textContent = c;
    const last = +ls.getItem(K.last) || 0;
    const t = last ? new Date(last) : null;
    const when = t ? t.getMonth() + 1 + '/' + t.getDate() + ' ' + String(t.getHours()).padStart(2, '0') + ':' + String(t.getMinutes()).padStart(2, '0') : '';
    $('sync-status').textContent =
      status === 'syncing' ? '同期中…' :
      status === 'offline' ? 'ネットにつながっていない。つながったら送る。' :
      status === 'error' ? 'うまく同期できなかった。少ししたら、もう一度ためす。' :
      when ? '同期した（' + when + '）' : 'つないだ。';
  }

  function init() {
    const $ = (id) => document.getElementById(id);
    // この端末で何か変わったら、少しあとで同期（同期の係が書いたものは数えない）
    const proto = Object.getPrototypeOf(ls);
    const orig = proto.setItem;
    proto.setItem = function (k, v) {
      orig.call(this, k, v);
      if (!applying && this === ls && typeof k === 'string' && k.startsWith('noutab.') && !k.startsWith('noutab.sync.') && k !== 'noutab.sticker') schedule(2000);
    };
    const origRemove = proto.removeItem;
    proto.removeItem = function (k) {
      origRemove.call(this, k);
      if (!applying && this === ls && typeof k === 'string' && k.startsWith('noutab.') && !k.startsWith('noutab.sync.')) schedule(2000);
    };

    if ($('sync-card')) {
      $('sync-form').addEventListener('submit', (e) => {
        e.preventDefault();
        const ok = connect($('sync-input').value);
        if (!ok) {
          $('sync-input').focus();
          UI.toast('合言葉は8文字以上にして。');
          return;
        }
        $('sync-input').value = '';
        render();
        UI.toast('つないだ。同期する。');
      });
      $('btn-sync-new').addEventListener('click', () => {
        $('sync-input').value = generateCode();
        $('sync-input').focus();
      });
      $('btn-sync-now').addEventListener('click', () => run());
      $('btn-sync-off').addEventListener('click', (e) => {
        const b = e.currentTarget;
        if (b.dataset.armed !== '1') {
          b.dataset.armed = '1';
          b.textContent = '本当に外す（この端末のデータは残る）';
          return;
        }
        b.dataset.armed = '';
        b.textContent = '合言葉を外す';
        disconnect();
        UI.toast('外した。この端末のデータはそのまま。');
      });
    }

    document.addEventListener('visibilitychange', () => document.visibilityState === 'visible' && run());
    window.addEventListener('online', () => run());
    if (code()) {
      status = 'ok';
      run();
    }
    loop();
    render();
  }

  return { init, run, render, connect, disconnect, onStatus };
})();
