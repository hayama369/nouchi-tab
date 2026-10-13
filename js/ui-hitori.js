/* =========================================================
   ui-hitori.js ― 「ひとりごと」画面（1日1ページの日記帳）
   ---------------------------------------------------------
   ・つぶやくたびに時刻が付いて、その日のページに古い順で並びます。
   ・ページは ‹ › で「書いた日」だけを行き来します。今日のページにはいつでも戻れます。
   ・書けるのは今日のページだけ。前のページは読むだけです。
   ・つぶやくとハルが反応します。ときどき肉球のはんこを押していきます
     （長めに吐き出したときは、必ず押していく）。
   ・項目を押すと「消す」が出ます（2回押しで削除、取り消しあり）。
   ・保存は js/storage.js（localStorage の noutab.mumbles）。
   ・ボタンと処理のひも付けは js/app.js の一番下。
   ========================================================= */

const HitoriUI = (() => {
  const $ = (id) => document.getElementById(id);
  const WEEK = ['日', '月', '火', '水', '木', '金', '土'];

  // ハルの反応（設定）
  const VOICES = ['にゃ', 'にゃーん', 'んにゃ', '…にゃ', 'にゃっ'];
  const PAW_CHANCE = 0.35; // 肉球を押していく確率
  const PAW_ALWAYS_LENGTH = 60; // この文字数以上なら必ず押していく

  // 肉球のはんこ（SVG）
  const PAW = `<svg class="hitori-paw" viewBox="0 0 32 32" aria-hidden="true"><g fill="currentColor">
    <ellipse cx="16" cy="21" rx="7.5" ry="6.5"/><ellipse cx="7" cy="13" rx="3" ry="3.8"/>
    <ellipse cx="12.5" cy="7.5" rx="3" ry="3.8"/><ellipse cx="19.5" cy="7.5" rx="3" ry="3.8"/>
    <ellipse cx="25" cy="13" rx="3" ry="3.8"/></g></svg>`;

  let day = null; // 表示しているページの日（その日の0時のミリ秒）
  let openId = null; // 「消す」を出している項目
  let armedId = null; // 「消す」を1回押した項目
  let newPawId = null; // いま押されたばかりの肉球（はんこの動きを1回だけ出す）

  // ---------------------------------------------------------
  // 日付の小道具
  // ---------------------------------------------------------
  function dayOf(ms) {
    const d = new Date(ms);
    return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  }
  function isToday() {
    return day === UI.startOfToday();
  }
  /** 「10月13日（火）」（去年以前なら年も付ける） */
  function pageTitle(ms) {
    const d = new Date(ms);
    const md = d.getMonth() + 1 + '月' + d.getDate() + '日（' + WEEK[d.getDay()] + '）';
    return d.getFullYear() === new Date().getFullYear() ? md : d.getFullYear() + '年' + md;
  }
  /** 「今日」「昨日」「3日前」 */
  function ago(ms) {
    const n = Math.round((UI.startOfToday() - ms) / 86400000);
    if (n <= 0) return '今日';
    if (n === 1) return '昨日';
    return n + '日前';
  }

  // ---------------------------------------------------------
  // 表示
  // ---------------------------------------------------------
  /** 画面を開くときに呼ぶ：今日のページから */
  function reset() {
    day = UI.startOfToday();
    openId = null;
    armedId = null;
  }

  function render() {
    if (day === null) reset();
    const today = UI.startOfToday();
    const all = Storage.getMumbles(); // 古い順
    const list = all.filter((m) => dayOf(m.createdAt) === day);
    const days = [...new Set(all.map((m) => dayOf(m.createdAt)))].sort((a, b) => a - b);

    // ‹ は「前に書いた日」、› は「次に書いた日」（なければ今日）
    const prev = days.filter((d) => d < day).pop();
    let next = days.find((d) => d > day && d < today);
    if (next === undefined && day < today) next = today;
    $('btn-hitori-prev').disabled = prev === undefined;
    $('btn-hitori-prev').dataset.to = prev === undefined ? '' : String(prev);
    $('btn-hitori-next').disabled = next === undefined;
    $('btn-hitori-next').dataset.to = next === undefined ? '' : String(next);
    $('btn-hitori-today').hidden = isToday();

    $('hitori-date').textContent = pageTitle(day);
    $('hitori-sub').textContent = ago(day) + (list.length ? '・' + list.length + 'こ' : '');

    const ol = $('hitori-list');
    ol.textContent = '';
    list.forEach((m) => ol.appendChild(item(m)));

    const empty = $('hitori-empty');
    empty.hidden = list.length > 0;
    empty.textContent = isToday() ? 'まだ何もない。思ったことを、そのまま。' : 'この日は何もない。';

    $('hitori-form').hidden = !isToday();
  }

  // ひとりごと1件
  function item(m) {
    const li = UI.el('li', 'hitori-item' + (m.paw ? ' has-paw' : '') + (openId === m.id ? ' is-open' : ''));
    li.dataset.id = m.id;
    const time = UI.el('time', 'hitori-time', UI.formatTime(m.createdAt));
    time.dateTime = new Date(m.createdAt).toISOString();
    li.appendChild(time);
    li.appendChild(UI.el('p', 'hitori-text', m.text));
    if (m.paw) {
      li.insertAdjacentHTML('beforeend', PAW);
      li.appendChild(UI.el('span', 'visually-hidden', '（ハルの肉球）'));
      if (newPawId === m.id) li.querySelector('.hitori-paw').classList.add('is-new');
    }
    const del = UI.el('button', 'hitori-del', armedId === m.id ? '本当に消す' : '消す');
    del.type = 'button';
    del.dataset.del = m.id;
    li.appendChild(del);
    return li;
  }

  // ---------------------------------------------------------
  // 操作（js/app.js から呼ばれる）
  // ---------------------------------------------------------
  /** つぶやく */
  function post() {
    const input = $('hitori-input');
    const m = Storage.addMumble(input.value);
    if (!m) {
      input.focus();
      return;
    }
    input.value = '';
    grow();
    openId = null;
    armedId = null;
    render();
    scrollToEnd();

    // ハルの反応：鳴いて跳ねる。ときどき肉球を押していく
    const stamp = m.text.length >= PAW_ALWAYS_LENGTH || Math.random() < PAW_CHANCE;
    setTimeout(() => {
      UI.haru.hitori.hop();
      UI.haru.hitori.meow(VOICES[Math.floor(Math.random() * VOICES.length)]);
      if (stamp) {
        Storage.setMumblePaw(m.id, true);
        newPawId = m.id;
        render();
        newPawId = null;
      }
    }, 280);
  }

  /** 入力欄：Enter でつぶやく（Shift+Enter は改行、変換確定の Enter は無視） */
  function keydown(e) {
    if (e.key !== 'Enter' || e.shiftKey) return;
    if (e.isComposing || e.keyCode === 229) return;
    e.preventDefault();
    post();
  }

  /** 入力欄を、書いた分だけ伸ばす */
  function grow() {
    const input = $('hitori-input');
    input.style.height = 'auto';
    input.style.height = Math.min(input.scrollHeight + 2, 160) + 'px';
  }

  /** ‹ › 今日 */
  function goTo(ms) {
    if (!ms) return;
    day = Number(ms);
    openId = null;
    armedId = null;
    render();
    window.scrollTo(0, 0);
  }
  function goToday() {
    goTo(UI.startOfToday());
  }

  /** 一覧を押したとき：「消す」を出す／消す */
  function listClick(e) {
    const del = e.target.closest('[data-del]');
    if (del) {
      const id = del.dataset.del;
      if (armedId !== id) {
        armedId = id;
        render();
        return;
      }
      const removed = Storage.deleteMumble(id);
      openId = null;
      armedId = null;
      render();
      UI.toast('消した。', () => {
        Storage.restoreMumble(removed);
        render();
      });
      return;
    }
    const li = e.target.closest('.hitori-item');
    if (!li) return;
    openId = openId === li.dataset.id ? null : li.dataset.id;
    armedId = null;
    render();
  }

  function scrollToEnd() {
    const last = $('hitori-list').lastElementChild;
    if (last) last.scrollIntoView({ block: 'nearest' });
  }

  return { reset, render, post, keydown, grow, goTo, goToday, listClick, scrollToEnd };
})();
