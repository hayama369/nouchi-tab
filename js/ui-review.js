/* =========================================================
   ui-review.js ― 「ふりかえり」画面の表示を担当
   ---------------------------------------------------------
   ・今日ひらいた脳内タブ／終わった作業の履歴／よく出る言葉／
     思いつきやすい時間／カテゴリ別、を描きます。
   ・数える処理そのものは js/analysis.js にあります。
   ========================================================= */

const ReviewUI = (() => {
  const $ = (id) => document.getElementById(id);
  const el = (...a) => UI.el(...a);

  const HISTORY_LIMIT = 20; // 作業履歴を何件まで出すか

  function render() {
    const tabs = Storage.getBrainTabs();
    renderToday(tabs);
    renderHistory();
    renderWords(tabs);
    renderHours(tabs);
    renderCats(tabs);
  }

  // --- 今日ひらいた脳内タブ ---
  function renderToday(tabs) {
    const today = Analysis.todayOnly(tabs);
    $('today-count').textContent = String(today.length);
    const ul = $('today-list');
    ul.textContent = '';
    today.forEach((t) => {
      const li = el('li', t.completed ? 'is-done' : '');
      li.appendChild(el('span', 'when', UI.formatTime(t.createdAt)));
      const b = el('button', 'what', t.text);
      b.type = 'button';
      b.dataset.open = t.id; // 押すと詳細へ
      li.appendChild(b);
      ul.appendChild(li);
    });
  }

  // --- 終わった作業 ---
  function renderHistory() {
    const history = Storage.getTaskHistory().slice(0, HISTORY_LIMIT);
    $('history-empty').hidden = history.length > 0;
    const ul = $('history-list');
    ul.textContent = '';
    history.forEach((h) => {
      const li = el('li');
      li.appendChild(el('span', 'when', UI.formatDay(h.finishedAt)));
      li.appendChild(el('span', 'what', h.text));
      li.appendChild(el('span', 'dur', UI.formatDuration(h.finishedAt - h.startedAt)));
      ul.appendChild(li);
    });
  }

  // --- 横棒グラフ共通 ---
  function drawBars(ul, items) {
    ul.textContent = '';
    const max = Math.max(...items.map((i) => i.count), 1);
    items.forEach((i) => {
      const li = el('li', 'bar-row');
      li.appendChild(el('span', 'bar-name', i.name));
      const track = el('span', 'bar-track');
      const fill = el('span', 'bar-fill');
      fill.style.display = 'block';
      fill.style.width = (i.count / max) * 100 + '%';
      track.appendChild(fill);
      li.appendChild(track);
      li.appendChild(el('span', 'bar-value', String(i.count)));
      li.title = i.name + '：' + i.count + '回';
      ul.appendChild(li);
    });
  }

  // --- よく出てくる言葉 ---
  function renderWords(tabs) {
    const words = Analysis.topWords(tabs);
    const empty = $('words-empty');
    empty.hidden = words.length > 0;
    empty.textContent = '同じ言葉が2回以上出てきたら、ここに並ぶ。';
    drawBars($('words'), words);
  }

  // --- 思いつきやすい時間（0〜23時の縦棒） ---
  function renderHours(tabs) {
    const hours = Analysis.hourCounts(tabs);
    const max = Math.max(...hours);
    const box = $('hours');
    box.textContent = '';
    hours.forEach((c, h) => {
      const col = el('div', 'hour' + (c === 0 ? ' is-zero' : '') + (c === max && c > 0 ? ' is-peak' : ''));
      const bar = el('span');
      bar.style.height = max ? (c / max) * 100 + '%' : '0';
      col.appendChild(bar);
      col.title = h + '時台：' + c + '個';
      box.appendChild(col);
    });

    const note = $('hours-note');
    note.textContent = '';
    if (!max) {
      note.textContent = 'まだ何も退避してない。';
      box.setAttribute('aria-label', 'まだデータなし');
      return;
    }
    const peak = hours.indexOf(max);
    note.append('いちばん多いのは ');
    note.appendChild(el('strong', '', peak + '時台'));
    note.append('（' + max + '個）');
    box.setAttribute('aria-label', '時間帯ごとの数。いちばん多いのは' + peak + '時台で' + max + '個');
  }

  // --- カテゴリ別 ---
  function renderCats(tabs) {
    const cats = Analysis.categoryCounts(tabs);
    $('cats-card').hidden = cats.length === 0;
    drawBars($('cats'), cats);
  }

  return { render };
})();
