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
   ・1件の形：{ id, text, when, createdAt, done, doneAt }
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
    const open = list.filter((x) => !x.done).sort((a, b) => b.createdAt - a.createdAt);
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
  // はじめに1回
  // ---------------------------------------------------------
  function init() {
    $('seg-wishes').addEventListener('click', () => switchKind('wishes'));
    $('seg-goals').addEventListener('click', () => switchKind('goals'));
    $('list-form').addEventListener('submit', add); // 「足す」かEnterで足す
    $('list-open').addEventListener('click', listClick);
    $('list-done').addEventListener('click', listClick);
  }

  init();
  return { render };
})();
