/* =========================================================
   ui-later.js ― 「あとで見る」一覧と「詳細」画面の表示を担当
   ---------------------------------------------------------
   ・一覧：検索、絞り込み（すべて／今日／カテゴリ／未分類）
   ・詳細：画像、カテゴリ、関連づけ、完了・削除
   ・押した時の処理は js/app.js にあります。
   ========================================================= */

const LaterUI = (() => {
  const $ = (id) => document.getElementById(id);
  const el = (...a) => UI.el(...a);

  // 一覧の状態
  let filter = 'all'; // 'all' / 'today' / 'none' / 'cat:カテゴリ名'
  let query = ''; // 検索の文字

  // 詳細画面の状態
  let detailId = null; // いま開いている思いつきのid
  let deleteArmed = false; // 削除ボタンを1回押した状態か
  let pickerQuery = '';

  // =========================================================
  // 一覧
  // =========================================================

  function reset() {
    filter = 'all';
    query = '';
    $('search').value = '';
  }

  function setFilter(f) {
    filter = filter === f ? 'all' : f; // もう一度押したら解除
    renderList();
  }

  function setQuery(q) {
    query = q.trim().toLowerCase();
    renderList();
  }

  // 絞り込み・検索に合うか
  function matches(tab) {
    if (filter === 'today' && tab.createdAt < UI.startOfToday()) return false;
    if (filter === 'none' && tab.category) return false;
    if (filter.startsWith('cat:') && tab.category !== filter.slice(4)) return false;
    if (query) {
      const hay = (tab.text + ' ' + (tab.category || '')).toLowerCase();
      if (!hay.includes(query)) return false;
    }
    return true;
  }

  function renderList() {
    const all = Storage.getBrainTabs();
    renderChips(all);

    const tabs = all.filter(matches);
    const active = tabs.filter((t) => !t.completed);
    const done = tabs.filter((t) => t.completed);

    // 空っぽのときの一言
    const empty = $('later-empty');
    empty.hidden = active.length > 0;
    if (!all.length) empty.textContent = 'まだ何も退避してない。';
    else if (!tabs.length) empty.textContent = '見つからなかった。';
    else empty.textContent = 'ぜんぶ片づいてる。';

    fillList($('tab-list'), active);

    $('done-box').hidden = done.length === 0;
    $('done-count').textContent = String(done.length);
    fillList($('done-list'), done);
  }

  // 絞り込みボタンを作る
  function renderChips(all) {
    const box = $('filter-chips');
    box.textContent = '';
    const cats = Storage.getCategories();
    const items = [
      ['all', 'すべて'],
      ['today', '今日'],
      ...cats.map((c) => ['cat:' + c, c]),
    ];
    if (cats.length && all.some((t) => !t.category)) items.push(['none', '未分類']);

    // 消えたカテゴリで絞り込んでいたら解除
    if (!items.some(([key]) => key === filter)) filter = 'all';

    items.forEach(([key, label]) => {
      const b = el('button', 'chip' + (filter === key ? ' is-on' : ''), label);
      b.type = 'button';
      b.dataset.filter = key;
      b.setAttribute('aria-pressed', filter === key ? 'true' : 'false');
      box.appendChild(b);
    });
  }

  function fillList(ul, tabs) {
    ul.textContent = '';
    tabs.forEach((tab) => ul.appendChild(buildItem(tab)));
  }

  // 一覧の1件
  function buildItem(tab) {
    const li = el('li', tab.completed ? 'is-done' : '');
    const main = el('button', 'tab-main');
    main.type = 'button';
    main.dataset.open = tab.id;

    const body = el('span', 'tab-body');
    body.appendChild(el('span', 'tab-text', tab.text));

    const meta = el('span', 'tab-meta');
    meta.appendChild(el('time', '', UI.formatDate(tab.createdAt)));
    if (tab.category) meta.appendChild(el('span', 'tag', tab.category));
    if (tab.links.length) meta.appendChild(el('span', '', '関連 ' + tab.links.length));
    body.appendChild(meta);
    main.appendChild(body);

    // 画像があれば小さく表示（読み込みは後から）
    if (tab.imageId) {
      const img = el('img', 'tab-thumb');
      img.alt = '';
      main.appendChild(img);
      Images.getUrl(tab.imageId).then((url) => url && (img.src = url));
    }

    li.appendChild(main);
    return li;
  }

  // =========================================================
  // 詳細
  // =========================================================

  function openDetail(id) {
    detailId = id;
    deleteArmed = false;
    pickerQuery = '';
    $('picker').hidden = true;
    $('picker-search').value = '';
    $('new-cat-form').hidden = true;
    renderDetail();
  }

  function getDetailId() {
    return detailId;
  }

  function renderDetail() {
    const tab = Storage.getBrainTab(detailId);
    if (!tab) return;

    const text = $('detail-text');
    text.textContent = tab.text;
    text.classList.toggle('is-done', tab.completed);
    $('detail-time').textContent = UI.formatDate(tab.createdAt) + 'に退避';

    // 画像
    const img = $('detail-image');
    img.hidden = true;
    if (tab.imageId) {
      Images.getUrl(tab.imageId).then((url) => {
        if (url) {
          img.src = url;
          img.hidden = false;
        }
      });
    }
    $('btn-detail-image').textContent = tab.imageId ? '画像を変える' : '画像を付ける';
    $('btn-detail-image-remove').hidden = !tab.imageId;

    // カテゴリ
    const chips = $('cat-chips');
    chips.textContent = '';
    Storage.getCategories().forEach((c) => {
      const b = el('button', 'chip' + (tab.category === c ? ' is-on' : ''), c);
      b.type = 'button';
      b.dataset.cat = c;
      b.setAttribute('aria-pressed', tab.category === c ? 'true' : 'false');
      chips.appendChild(b);
    });
    const add = el('button', 'chip chip-new', '＋ 新しいカテゴリ');
    add.type = 'button';
    add.dataset.newcat = '1';
    chips.appendChild(add);

    // 関連
    const links = $('link-list');
    links.textContent = '';
    tab.links
      .map((id) => Storage.getBrainTab(id))
      .filter(Boolean)
      .forEach((t) => {
        const li = el('li', 'link-item');
        const open = el('button', 'link-open', t.text);
        open.type = 'button';
        open.dataset.open = t.id;
        const x = el('button', 'link-x', '外す');
        x.type = 'button';
        x.dataset.unlink = t.id;
        li.append(open, x);
        links.appendChild(li);
      });
    if (!links.children.length) links.appendChild(el('li', 'note', 'まだない。'));

    if (!$('picker').hidden) renderPicker();

    // 完了・削除
    $('btn-detail-complete').textContent = tab.completed ? '未完了に戻す' : '完了';
    const del = $('btn-detail-delete');
    del.textContent = deleteArmed ? '本当に削除' : '削除';
    del.className = 'btn ' + (deleteArmed ? 'btn-danger' : 'btn-ghost');
  }

  // 関連づける相手を選ぶ一覧
  function openPicker() {
    $('picker').hidden = false;
    renderPicker();
    $('picker-search').focus();
  }

  function closePicker() {
    $('picker').hidden = true;
  }

  function setPickerQuery(q) {
    pickerQuery = q.trim().toLowerCase();
    renderPicker();
  }

  function renderPicker() {
    const tab = Storage.getBrainTab(detailId);
    const list = $('picker-list');
    list.textContent = '';
    if (!tab) return;
    const candidates = Storage.getBrainTabs()
      .filter((t) => t.id !== tab.id && !tab.links.includes(t.id))
      .filter((t) => !pickerQuery || t.text.toLowerCase().includes(pickerQuery))
      .slice(0, 30);
    candidates.forEach((t) => {
      const li = el('li', 'link-item');
      const b = el('button', 'link-open', t.text);
      b.type = 'button';
      b.dataset.link = t.id;
      li.appendChild(b);
      list.appendChild(li);
    });
    if (!candidates.length) list.appendChild(el('li', 'note', 'つなげる相手がいない。'));
  }

  // 削除ボタン：1回目で「本当に削除」、2回目で true を返す
  function pressDelete() {
    if (deleteArmed) return true;
    deleteArmed = true;
    renderDetail();
    return false;
  }

  return {
    reset,
    setFilter,
    setQuery,
    renderList,
    openDetail,
    getDetailId,
    renderDetail,
    openPicker,
    closePicker,
    setPickerQuery,
    pressDelete,
  };
})();
