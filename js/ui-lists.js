/* =========================================================
   ui-lists.js ― 「リスト」画面（やりたいこと〈長期〉・目標）
   ---------------------------------------------------------
   ・思いつき（あとで見る）とは別の、長く置いておく2つのリスト。
       やりたいこと … いつかやりたいこと。急がない
       目標         … 目指していること
   ・どちらも「いつごろ」を書いても書かなくてもいい。
   ・丸を押すと「叶った／達成」になって、下に移る（もう一度押すと戻る）。
   ・「消す」は2回押し（1回目で赤くなる。3秒たつと元に戻る）。
   ・保存場所（localStorage）：
       noutab.wishes … やりたいこと
       noutab.goals  … 目標
     どちらも同期（js/sync.js）に入っている。
   ・1件の形：{ id, text, when, tag, createdAt, done, doneAt }（tag は Notion から移した分だけ）
   ========================================================= */

const ListsUI = (() => {
  const $ = (id) => document.getElementById(id);

  // 2つのリストの設定。言葉を変えたいときはここだけ直せばいい
  const KINDS = {
    wishes: {
      key: 'noutab.wishes',
      lead: 'いつかやりたいこと。急がない。思い出したら足す場所。',
      placeholder: 'やりたいこと',
      empty: 'まだ何もない。思いついたら一個だけ書いとけ。',
      doneTitle: '叶ったこと',
      doneToast: '叶った。',
    },
    goals: {
      key: 'noutab.goals',
      lead: '目指してること。小さくていい。',
      placeholder: '目標',
      empty: 'まだ何もない。大きくなくていい。',
      doneTitle: '達成したこと',
      doneToast: '達成。よくやった。',
    },
  };

  let kind = 'wishes';
  let armedId = null; // 「消す」を1回押した項目
  let armTimer = null;

  // ---------------------------------------------------------
  // 保存・読み込み
  // ---------------------------------------------------------
  function read(k) {
    try {
      const v = JSON.parse(localStorage.getItem(KINDS[k].key) || '[]');
      return Array.isArray(v) ? v.filter((x) => x && x.id) : [];
    } catch (e) {
      return [];
    }
  }
  function write(k, list) {
    try {
      localStorage.setItem(KINDS[k].key, JSON.stringify(list));
    } catch (e) {
      UI.toast('保存できなかった。');
    }
  }
  function newId() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  }

  // ---------------------------------------------------------
  // 表示
  // ---------------------------------------------------------
  const fmt = (t) => {
    const d = new Date(t);
    return d.getFullYear() + '/' + (d.getMonth() + 1) + '/' + d.getDate();
  };

  function itemHtml(it) {
    const li = document.createElement('li');
    li.className = 'list-item' + (it.done ? ' is-done' : '');
    li.dataset.id = it.id;

    const check = document.createElement('button');
    check.type = 'button';
    check.className = 'list-check';
    check.dataset.act = 'toggle';
    check.setAttribute('aria-label', it.done ? '未完了に戻す' : '叶った・達成にする');
    check.innerHTML =
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>';

    const body = document.createElement('div');
    body.className = 'list-body';
    const text = document.createElement('span');
    text.className = 'list-text';
    text.textContent = it.text;
    body.appendChild(text);

    const meta = document.createElement('span');
    meta.className = 'list-meta';
    if (it.tag) {
      const t = document.createElement('span');
      t.className = 'list-tag';
      t.textContent = it.tag;
      meta.appendChild(t);
    }
    if (it.when) {
      const w = document.createElement('span');
      w.className = 'list-when';
      w.textContent = it.when;
      meta.appendChild(w);
      meta.appendChild(document.createTextNode('　'));
    }
    meta.appendChild(document.createTextNode(it.done && it.doneAt ? fmt(it.doneAt) + ' ' + (kind === 'wishes' ? '叶った' : '達成') : fmt(it.createdAt) + ' に足した'));
    body.appendChild(meta);

    const del = document.createElement('button');
    del.type = 'button';
    del.className = 'list-del' + (armedId === it.id ? ' is-armed' : '');
    del.dataset.act = 'delete';
    del.textContent = armedId === it.id ? 'ほんとに消す' : '消す';

    li.append(check, body, del);
    return li;
  }

  function render() {
    const cfg = KINDS[kind];
    $('seg-wishes').setAttribute('aria-pressed', String(kind === 'wishes'));
    $('seg-goals').setAttribute('aria-pressed', String(kind === 'goals'));
    $('list-lead').textContent = cfg.lead;
    $('list-input').placeholder = cfg.placeholder;

    const list = read(kind);
    const open = list.filter((x) => !x.done).sort((a, b) => b.createdAt - a.createdAt); // 新しく足したものが上
    const done = list.filter((x) => x.done).sort((a, b) => (b.doneAt || 0) - (a.doneAt || 0));

    $('list-open').replaceChildren(...open.map(itemHtml));
    $('list-done').replaceChildren(...done.map(itemHtml));
    $('list-empty').hidden = open.length > 0;
    $('list-empty').textContent = cfg.empty;
    $('list-done-title').hidden = done.length === 0;
    $('list-done-title').textContent = cfg.doneTitle + '（' + done.length + '）';
  }

  // ---------------------------------------------------------
  // 操作
  // ---------------------------------------------------------
  function switchKind(k) {
    if (k === kind) return;
    kind = k;
    disarm();
    render();
  }

  function add(e) {
    e.preventDefault();
    const text = $('list-input').value.trim();
    if (!text) return $('list-input').focus();
    const list = read(kind);
    list.push({ id: newId(), text, when: $('list-when').value.trim(), createdAt: Date.now(), done: false, doneAt: null });
    write(kind, list);
    $('list-input').value = '';
    $('list-when').value = '';
    render();
    UI.toast('足した。');
  }

  function disarm() {
    armedId = null;
    clearTimeout(armTimer);
  }

  function listClick(e) {
    const b = e.target.closest('[data-act]');
    const li = e.target.closest('.list-item');
    if (!b || !li) return;
    const id = li.dataset.id;
    const list = read(kind);
    const i = list.findIndex((x) => x.id === id);
    if (i < 0) return;

    if (b.dataset.act === 'toggle') {
      const it = list[i];
      it.done = !it.done;
      it.doneAt = it.done ? Date.now() : null;
      write(kind, list);
      disarm();
      render();
      UI.toast(it.done ? KINDS[kind].doneToast : '戻した。');
      return;
    }

    if (b.dataset.act === 'delete') {
      if (armedId !== id) {
        disarm();
        armedId = id;
        armTimer = setTimeout(() => {
          armedId = null;
          render();
        }, 3000);
        render();
        return;
      }
      const [removed] = list.splice(i, 1);
      write(kind, list);
      disarm();
      render();
      UI.toast('消した。', () => {
        const now = read(kind);
        now.push(removed);
        write(kind, now);
        render();
      });
    }
  }


  // ---------------------------------------------------------
  // はじめの中身：Notion「やりたいこと置き場（2026/11/14）」から移したもの
  //   ・「やりたいこと」がまだ一度も保存されていない端末でだけ、1回入る
  //   ・id は全端末で同じ（seed1-…）なので、同期しても二重にならない
  //   ・tag は Notion での分け方
  // ---------------------------------------------------------
  const SEED_KEY = 'noutab.wishes.seeded';
  const SEED = [
    ['体のため', '腹帯'],
    ['体のため', '骨盤ベルト（そろそろないと腰がやばい）'],
    ['体のため', 'レギンス（一枚じゃ足りない）'],
    ['体のため', '蒸気でアイマスク（病院帰りの薬局かネットで）'],
    ['体のため', '母子手帳を書く'],
    ['家・片付け', 'ハルのトイレを洗う'],
    ['家・片付け', 'キッチンのバカでかいダイニングテーブルを捨てる'],
    ['家・片付け', '来客用の布団を片付ける（使ってない布団は捨てたい）'],
    ['家・片付け', '本棚、特に書類（10年前のはもういらない）'],
    ['家・片付け', '玄関の靴'],
    ['家・片付け', '洗濯機の横のごちゃっとしたところ'],
    ['家・片付け', 'ネイル用品をまとめるラック'],
    ['家・片付け', '部屋の配置を変える'],
    ['家・片付け', '掃除機・トイレ掃除・新聞紙'],
    ['家・片付け', 'いらないものを捨てまくる、とにかく物を減らす'],
    ['作るもの', 'タロットアプリ：全パターンの解説を作って、全部違う答えが出るようにする'],
    ['作るもの', '今あるアプリを全部一個にまとめる', true],
    ['作るもの', 'パソコンの中身を整理する'],
    ['発信', 'noteの記事を20本くらいストック'],
    ['発信', 'インスタとThreadsの中身を分ける（中身は素のまま、入口だけ工夫）'],
    ['発信', 'デタラメを流布するサイト（自分の語彙を自分の認識でまとめる）'],
    ['発信', '最低限の語彙を覚えればなんとなく分かる占星術'],
    ['発信', 'ジンクスを調べてまとめる（テーマ別）'],
    ['仕組み', '春千夜イメージの天然石（オニキスの次につける）', false, '産後'],
  ];
  function seedOnce() {
    try {
      if (localStorage.getItem(SEED_KEY) || localStorage.getItem(KINDS.wishes.key)) return;
      const base = Date.parse('2026-11-14T04:55:00+09:00');
      const list = SEED.map(([tag, text, done, when], i) => ({
        id: 'seed1-' + String(i + 1).padStart(2, '0'),
        text,
        when: when || '',
        tag,
        createdAt: base - i, // 新しい順に並ぶので、Notionの順で上から出るよう1ミリ秒ずつ戻す
        done: !!done,
        doneAt: done ? Date.parse('2026-11-19T13:30:00+09:00') : null,
      }));
      localStorage.setItem(KINDS.wishes.key, JSON.stringify(list));
      localStorage.setItem(SEED_KEY, '1');
    } catch (e) {
      /* 保存できない端末では何もしない */
    }
  }

  // ---------------------------------------------------------
  // はじめに1回
  // ---------------------------------------------------------
  function init() {
    seedOnce();
    $('seg-wishes').addEventListener('click', () => switchKind('wishes'));
    $('seg-goals').addEventListener('click', () => switchKind('goals'));
    $('list-form').addEventListener('submit', add); // 「足す」かEnterで足す
    $('list-open').addEventListener('click', listClick);
    $('list-done').addEventListener('click', listClick);
  }

  init();
  return { render };
})();
