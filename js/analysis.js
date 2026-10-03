/* =========================================================
   analysis.js ― 「ふりかえり」の集計（数えるだけ）を担当するファイル
   ---------------------------------------------------------
   ・よく出てくる言葉、思いつきやすい時間、カテゴリ別の数を数えます。
   ・画面には何も描きません（描くのは js/ui-review.js）。
   ========================================================= */

const Analysis = (() => {
  // 数えない言葉（どの思いつきにも出てきがちで意味の薄いもの）
  const STOP_WORDS = new Set(['あと', 'これ', 'それ', 'あれ', 'こと', 'もの', 'ため', '今日', '明日', 'やつ', 'とき']);

  // 文章を言葉に分ける。ブラウザの日本語分割機能（Intl.Segmenter）があれば使う
  function splitWords(text) {
    if (window.Intl && Intl.Segmenter) {
      const seg = new Intl.Segmenter('ja', { granularity: 'word' });
      return Array.from(seg.segment(text))
        .filter((s) => s.isWordLike)
        .map((s) => s.segment);
    }
    // 使えないブラウザ用：漢字・カタカナ・英数字のかたまりだけ拾う
    return text.match(/[一-鿿゠-ヿー]+|[A-Za-z0-9]+/g) || [];
  }

  // 数える価値のある言葉か
  function isMeaningful(w) {
    if (w.length < 2) return false; // 1文字は除く
    if (/^[぀-ゟ]+$/.test(w)) return false; // ひらがなだけ（「する」「たい」等）は除く
    if (/^[0-9０-９]+$/.test(w)) return false; // 数字だけは除く
    return !STOP_WORDS.has(w);
  }

  /** よく出てくる言葉 上位 n 個：[{ name, count }]
      （1つの思いつきの中で同じ言葉が2回出ても1回と数える） */
  function topWords(tabs, n = 8) {
    const count = {};
    tabs.forEach((tab) => {
      const words = new Set(splitWords(tab.text).map((w) => w.toLowerCase()).filter(isMeaningful));
      words.forEach((w) => (count[w] = (count[w] || 0) + 1));
    });
    return Object.entries(count)
      .filter(([, c]) => c >= 2) // 2回以上出たものだけ
      .sort((a, b) => b[1] - a[1])
      .slice(0, n)
      .map(([name, c]) => ({ name, count: c }));
  }

  /** 0時〜23時それぞれに何個思いついたか：長さ24の配列 */
  function hourCounts(tabs) {
    const hours = new Array(24).fill(0);
    tabs.forEach((tab) => hours[new Date(tab.createdAt).getHours()]++);
    return hours;
  }

  /** カテゴリ別の数：[{ name, count }]（未分類は最後） */
  function categoryCounts(tabs) {
    const count = {};
    let none = 0;
    tabs.forEach((tab) => {
      if (tab.category) count[tab.category] = (count[tab.category] || 0) + 1;
      else none++;
    });
    const list = Object.entries(count)
      .sort((a, b) => b[1] - a[1])
      .map(([name, c]) => ({ name, count: c }));
    if (none && list.length) list.push({ name: '未分類', count: none });
    return list;
  }

  /** 今日（0時以降）の思いつきだけ取り出す */
  function todayOnly(tabs) {
    const now = new Date();
    const start = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    return tabs.filter((t) => t.createdAt >= start);
  }

  return { topWords, hourCounts, categoryCounts, todayOnly };
})();
