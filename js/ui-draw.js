/* =========================================================
   ui-draw.js ― 「描く」画面（絵を描いた時間をはかる）
   ---------------------------------------------------------
   ・「はじめる」で時間をはかり始め、「おわり」で記録します。
     はかっている途中でアプリを閉じても、戻ってくれば続きから数えます
     （始めた時刻を覚えているだけなので、閉じている間もちゃんと進む）。
   ・目安の時間（10・25・30・60分）を過ぎると「休憩しろ」と出ます。
     止めるまでは、そのまま数え続けます。
     アプリを開いていないときに知らせるのは、Webアプリの仕組み上できません。
   ・1000時間 → 3000 → 5000 → 10000時間と、次の目標までの残りを出します。
     前のアプリで数えていた時間は「これまでの時間」に手で入れられます。
   ・描いた日は月ごとのカレンダーに色がつきます（‹ › で月をめくる。日を押すとその日の記録）。
     続けた日数でハルがほめます。
   ・目安の時間を過ぎたとき、アプリを開いていれば音を鳴らします（オン／オフあり。
     オン／オフは端末ごとに noutab.drawSound に保存）。
   ・保存は localStorage の noutab.draw（この画面だけで使う）。
   ・ボタンのひも付けもこのファイルの init() の中にあります。
   ========================================================= */

const DrawUI = (() => {
  const KEY = 'noutab.draw';
  const TARGETS = [10, 25, 30, 60]; // 目安の時間（分）
  const GOALS = [1000, 3000, 5000, 10000]; // 目標（時間）
  const SOUND_KEY = 'noutab.drawSound'; // 休憩の音のオン／オフ（端末ごと・同期しない）
  const MIN_SAVE_SEC = 60; // これより短いと記録しない

  const $ = (id) => document.getElementById(id);
  const DAY = 86400000;

  let haru = null;
  let tick = null;
  let notifiedFor = null; // 休憩の知らせを出した回（始めた時刻）
  let calMonth = null; // カレンダーで見ている月（その月1日の時刻）。null なら今月
  let selDay = null; // カレンダーで押した日（'2026-10-23'）

  // ---------------------------------------------------------
  // 保存
  // ---------------------------------------------------------
  function load() {
    try {
      const d = JSON.parse(localStorage.getItem(KEY) || '{}');
      return {
        sessions: Array.isArray(d.sessions) ? d.sessions : [], // { id, start, end, sec }
        running: d.running || null, // { start, target }
        target: d.target || 30,
        baseMin: +d.baseMin || 0, // 前のアプリなどで数えた時間（分）
      };
    } catch (e) {
      return { sessions: [], running: null, target: 30, baseMin: 0 };
    }
  }
  function save(d) {
    try {
      localStorage.setItem(KEY, JSON.stringify(d));
    } catch (e) {
      /* 保存できなくても画面は動かす */
    }
  }

  // ---------------------------------------------------------
  // 計算の小道具
  // ---------------------------------------------------------
  const dayKey = (ms) => {
    const d = new Date(ms);
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  };
  const startOfDay = (ms) => {
    const d = new Date(ms);
    return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  };
  function clock(sec) {
    sec = Math.max(0, Math.floor(sec));
    const h = Math.floor(sec / 3600);
    const m = Math.floor((sec % 3600) / 60);
    const s = sec % 60;
    const mm = String(m).padStart(2, '0');
    const ss = String(s).padStart(2, '0');
    return h ? h + ':' + mm + ':' + ss : mm + ':' + ss;
  }
  /** 「3時間12分」「45分」 */
  function hm(min) {
    min = Math.max(0, Math.round(min));
    const h = Math.floor(min / 60);
    const m = min % 60;
    if (!h) return m + '分';
    return h.toLocaleString('ja-JP') + '時間' + (m ? m + '分' : '');
  }
  const elapsedSec = (run) => (run ? (Date.now() - run.start) / 1000 : 0);

  /** 日ごとの合計（分）。記録は「始めた日」に数える */
  function perDay(sessions) {
    const map = new Map();
    sessions.forEach((s) => {
      const k = dayKey(s.start);
      map.set(k, (map.get(k) || 0) + s.sec / 60);
    });
    return map;
  }

  /** 続いている日数（今日まだなら昨日まででも「続いてる」）と、最長記録 */
  function streaks(map) {
    const today = startOfDay(Date.now());
    let cur = 0;
    let d = map.has(dayKey(today)) ? today : today - DAY;
    while (map.has(dayKey(d))) {
      cur++;
      d -= DAY;
    }
    const days = [...map.keys()].sort();
    let best = 0;
    let run = 0;
    let prev = null;
    days.forEach((k) => {
      const t = new Date(k + 'T00:00:00').getTime();
      run = prev !== null && Math.round((t - prev) / DAY) === 1 ? run + 1 : 1;
      best = Math.max(best, run);
      prev = t;
    });
    return { cur, best: Math.max(best, cur), today: map.has(dayKey(today)) };
  }

  function totalMin(d, withRunning) {
    const rec = d.sessions.reduce((a, s) => a + s.sec / 60, 0);
    return d.baseMin + rec + (withRunning ? elapsedSec(d.running) / 60 : 0);
  }
  function goalOf(hours) {
    const next = GOALS.find((g) => hours < g) || GOALS[GOALS.length - 1];
    const idx = GOALS.indexOf(next);
    const prev = idx > 0 ? GOALS[idx - 1] : 0;
    return { next, prev, done: hours >= GOALS[GOALS.length - 1] };
  }

  // ---------------------------------------------------------
  // ハルのひとこと
  // ---------------------------------------------------------
  const pick = (a) => a[Math.floor(Math.random() * a.length)];
  function commentFor(min, streak, crossed) {
    if (crossed) return crossed.toLocaleString('ja-JP') + '時間、到達。……ずっと描いてきた手だ。にゃ';
    const lines = [];
    if (min < 10) lines.push(pick(['ちょっとでも描いた。それで十分。', '線を一本引いた日は、描いた日だ。', '短くても、開いたのがえらい。']));
    else if (min < 30) lines.push(pick(['いいぞ。手があったまってきたな。', 'このくらいがちょうどいい日もある。', 'ちゃんと座って描いた。上出来。']));
    else if (min < 60) lines.push(pick(['しっかり描いたな。肩を回しとけ。', '30分越え。集中してた。', 'いい時間だった。水飲め。']));
    else if (min < 120) lines.push(pick(['1時間越えか。目を休ませろ。', 'がっつり描いたな。えらい。', '集中しすぎ。でも、いい集中だ。']));
    else lines.push(pick(['2時間以上……描きすぎだ。横になれ。', 'すげぇ集中だ。今日はもう休め。', '手首、冷やしとけ。よくやった。']));
    if (streak >= 2) {
      const praise =
        streak >= 100 ? streak + '日連続。もう生活の一部だな。' :
        streak >= 30 ? streak + '日連続。ひと月描き続けた。' :
        streak >= 14 ? streak + '日連続。二週間止まってない。' :
        streak >= 7 ? streak + '日連続。一週間ぶっ通しだ。' :
        streak >= 3 ? streak + '日連続。続いてる。' : '2日連続。明日も少しだけでいい。';
      lines.push(praise);
    }
    return lines.join(' ') + ' にゃ';
  }
  function idleComment(st) {
    if (st.today) return '今日はもう描いた。続きを描くも、休むも自由だ。';
    if (st.cur >= 2) return st.cur + '日続いてる。今日も5分でいいから線を引け。';
    if (st.cur === 1) return '昨日は描いた。今日も少しだけ、どうだ。';
    return '描けない日は描かなくていい。描きたくなったら、ここを押せ。';
  }

  function say(text, voice) {
    $('draw-comment').textContent = text;
    if (haru) {
      haru.hop();
      haru.meow(voice || 'にゃ');
    }
  }

  // ---------------------------------------------------------
  // 表示
  // ---------------------------------------------------------
  function render() {
    const d = load();
    const run = d.running;

    // 目安のボタン
    $('draw-targets').querySelectorAll('[data-min]').forEach((b) => {
      const on = +b.dataset.min === (run ? run.target : d.target);
      b.classList.toggle('is-on', on);
      b.setAttribute('aria-pressed', on ? 'true' : 'false');
      b.disabled = !!run;
    });

    // ボタン
    $('btn-draw-start').hidden = !!run;
    $('btn-draw-stop').hidden = !run;
    $('btn-draw-cancel').hidden = !run;
    document.querySelector('.draw-timer').classList.toggle('is-running', !!run);

    renderClock(d);

    // 今日・続けた日
    const map = perDay(d.sessions);
    const st = streaks(map);
    const todayMin = map.get(dayKey(Date.now())) || 0;
    $('draw-today').textContent = hm(todayMin + (run ? elapsedSec(run) / 60 : 0));
    $('draw-streak').textContent = st.cur + '日';
    $('draw-best').textContent = '最長 ' + st.best + '日';
    if (!run && !$('draw-comment').dataset.fresh) $('draw-comment').textContent = idleComment(st);
    delete $('draw-comment').dataset.fresh;

    renderGoal(d);
    renderCalendar(map, d);
    renderLog(d);
    $('draw-base').textContent = d.baseMin ? hm(d.baseMin) : 'まだ入れてない';
    // ほかの端末で始めたタイマーが同期で届いたときも、時計を動かす
    if (run && !tick) startTick();
    if (!run && tick) stopTick();
  }

  function renderClock(d) {
    const run = d.running;
    const sec = elapsedSec(run);
    $('draw-clock').textContent = clock(sec);
    const target = run ? run.target : d.target;
    const over = run && sec >= target * 60;
    $('draw-clock-sub').textContent = run
      ? over
        ? '目安の' + target + '分を過ぎた。休憩しろ（止めるまで数え続ける）'
        : '目安 ' + target + '分まで あと ' + clock(target * 60 - sec)
      : '目安の時間を選んで「はじめる」';
    document.querySelector('.draw-timer').classList.toggle('is-over', !!over);
    const ring = $('draw-ring');
    const p = run ? Math.min(1, sec / (target * 60)) : 0;
    ring.style.setProperty('--p', p.toFixed(4));
  }

  function renderGoal(d) {
    const total = totalMin(d, true);
    const hours = total / 60;
    const g = goalOf(hours);
    $('draw-total').textContent = hm(total);
    $('draw-goal-name').textContent = g.next.toLocaleString('ja-JP') + '時間チャレンジ';
    const leftMin = Math.max(0, g.next * 60 - total);
    $('draw-goal-left').textContent = g.done ? '達成！' : 'あと ' + hm(leftMin);
    const span = (g.next - g.prev) * 60;
    const p = g.done ? 1 : Math.min(1, Math.max(0, (total - g.prev * 60) / span));
    $('draw-goal-fill').style.width = (p * 100).toFixed(1) + '%';
    $('draw-goal-meter').setAttribute('aria-label', g.next + '時間のうち' + Math.floor(hours) + '時間');
    $('draw-goal-steps').textContent = GOALS.map((x) => (hours >= x ? '✓' : '') + x.toLocaleString('ja-JP')).join(' → ');
  }

  /** 月の1日（0時）の時刻 */
  const monthStart = (ms) => {
    const d = new Date(ms);
    return new Date(d.getFullYear(), d.getMonth(), 1).getTime();
  };
  const addMonth = (ms, n) => {
    const d = new Date(ms);
    return new Date(d.getFullYear(), d.getMonth() + n, 1).getTime();
  };
  /** マスに入れる短い時間（「42分」「1h30」） */
  function short(min) {
    min = Math.round(min);
    if (min < 60) return min + '分';
    const m = min % 60;
    return Math.floor(min / 60) + 'h' + (m ? String(m).padStart(2, '0') : '');
  }
  const WEEK = ['日', '月', '火', '水', '木', '金', '土'];

  function renderCalendar(map, d) {
    const today = startOfDay(Date.now());
    const thisMonth = monthStart(today);
    if (calMonth === null || calMonth > thisMonth) calMonth = thisMonth;
    // 一番古い記録の月より前には戻らない
    const firstMs = d.sessions.length ? Math.min(...d.sessions.map((s) => s.start)) : today;
    const oldest = Math.min(monthStart(firstMs), thisMonth);
    if (calMonth < oldest) calMonth = oldest;

    const m0 = new Date(calMonth);
    const y = m0.getFullYear();
    const mo = m0.getMonth();
    const days = new Date(y, mo + 1, 0).getDate();
    $('draw-month-title').textContent = y + '年 ' + (mo + 1) + '月';
    $('btn-draw-prev').disabled = calMonth <= oldest;
    $('btn-draw-next').disabled = calMonth >= thisMonth;

    const box = $('draw-cal');
    box.textContent = '';
    const max = Math.max(30, ...map.values());
    for (let i = 0; i < m0.getDay(); i++) {
      const blank = document.createElement('span');
      blank.className = 'draw-cell is-blank';
      box.appendChild(blank);
    }
    let sum = 0;
    let count = 0;
    let best = 0;
    let run = 0;
    for (let day = 1; day <= days; day++) {
      const t = new Date(y, mo, day).getTime();
      const k = dayKey(t);
      const v = map.get(k) || 0;
      const cell = document.createElement('button');
      cell.type = 'button';
      cell.className = 'draw-cell';
      cell.dataset.day = k;
      const num = document.createElement('b');
      num.textContent = day;
      cell.appendChild(num);
      if (t > today) {
        cell.classList.add('is-future');
        cell.disabled = true;
      } else {
        const lv = v <= 0 ? 0 : v < max * 0.25 ? 1 : v < max * 0.5 ? 2 : v < max * 0.75 ? 3 : 4;
        cell.dataset.lv = lv;
        if (v > 0) {
          const sm = document.createElement('small');
          sm.textContent = short(v);
          cell.appendChild(sm);
        }
      }
      cell.setAttribute('aria-label', mo + 1 + '月' + day + '日 ' + (v ? hm(v) : 'なし'));
      if (t === today) cell.classList.add('is-today');
      if (k === selDay) cell.classList.add('is-selected');
      box.appendChild(cell);
      // その月のまとめ
      if (v > 0) {
        sum += v;
        count++;
        run++;
        best = Math.max(best, run);
      } else {
        run = 0;
      }
    }
    $('draw-m-days').innerHTML = count + '<small>日</small>';
    $('draw-m-total').textContent = hm(sum);
    $('draw-m-best').innerHTML = best + '<small>日</small>';
    renderDay(d, map);
  }

  /** カレンダーで押した日の記録 */
  function renderDay(d, map) {
    const box = $('draw-day');
    if (!selDay || selDay.slice(0, 7) !== dayKey(calMonth).slice(0, 7)) {
      box.hidden = true;
      return;
    }
    box.hidden = false;
    const t = new Date(selDay + 'T00:00:00');
    $('draw-day-title').textContent = t.getMonth() + 1 + '月' + t.getDate() + '日（' + WEEK[t.getDay()] + '）';
    const v = map.get(selDay) || 0;
    $('draw-day-total').textContent = v ? '合計 ' + hm(v) : '';
    const list = d.sessions.filter((s) => dayKey(s.start) === selDay).sort((a, b) => a.start - b.start);
    $('draw-day-empty').hidden = list.length > 0;
    const ol = $('draw-day-list');
    ol.textContent = '';
    list.forEach((s) => {
      const li = document.createElement('li');
      const dt = new Date(s.start);
      const when = document.createElement('span');
      when.className = 'when';
      when.textContent = s.manual ? '手入力' : String(dt.getHours()).padStart(2, '0') + ':' + String(dt.getMinutes()).padStart(2, '0');
      const len = document.createElement('span');
      len.className = 'len';
      len.textContent = hm(s.sec / 60);
      li.append(when, len);
      ol.appendChild(li);
    });
  }

  function calClick(e) {
    const b = e.target.closest('[data-day]');
    if (!b || b.disabled) return;
    selDay = selDay === b.dataset.day ? null : b.dataset.day;
    render();
  }
  function moveMonth(n) {
    calMonth = addMonth(calMonth === null ? Date.now() : calMonth, n);
    selDay = null;
    render();
  }

  function renderLog(d) {
    const ol = $('draw-log');
    ol.textContent = '';
    const list = [...d.sessions].sort((a, b) => b.start - a.start).slice(0, 10);
    $('draw-log-empty').hidden = list.length > 0;
    list.forEach((s) => {
      const li = document.createElement('li');
      li.className = 'draw-log-item';
      const dt = new Date(s.start);
      const when = document.createElement('span');
      when.className = 'draw-log-when';
      when.textContent = dt.getMonth() + 1 + '/' + dt.getDate() + ' ' + String(dt.getHours()).padStart(2, '0') + ':' + String(dt.getMinutes()).padStart(2, '0');
      const len = document.createElement('span');
      len.className = 'draw-log-len';
      len.textContent = hm(s.sec / 60) + (s.manual ? '（手入力）' : '');
      const del = document.createElement('button');
      del.type = 'button';
      del.className = 'draw-log-del';
      del.dataset.del = s.id;
      del.textContent = '消す';
      del.setAttribute('aria-label', when.textContent + 'の記録を消す');
      li.append(when, len, del);
      ol.appendChild(li);
    });
  }

  // ---------------------------------------------------------
  // 操作
  // ---------------------------------------------------------
  function chooseTarget(e) {
    const b = e.target.closest('[data-min]');
    if (!b) return;
    const d = load();
    if (d.running) return;
    d.target = +b.dataset.min;
    save(d);
    render();
  }

  function start() {
    const d = load();
    if (d.running) return;
    d.running = { start: Date.now(), target: d.target };
    save(d);
    notifiedFor = null;
    askNotify();
    unlockAudio(); // ボタンを押したこの瞬間に音の準備をしておく（iPhoneはこうしないと鳴らない）
    $('draw-comment').dataset.fresh = '1';
    say(pick(['描くか。見てる。', 'よし、始めろ。', 'ペン持ったな。行け。']), 'にゃっ');
    render();
    startTick();
  }

  function stop() {
    const d = load();
    const run = d.running;
    if (!run) return;
    const sec = Math.round(elapsedSec(run));
    d.running = null;
    if (sec < MIN_SAVE_SEC) {
      save(d);
      stopTick();
      render();
      say('1分たってないから、記録しなかった。', 'にゃ？');
      return;
    }
    const beforeH = totalMin(d, false) / 60;
    const rec = { id: Date.now().toString(36), start: run.start, end: Date.now(), sec };
    d.sessions.push(rec);
    save(d);
    stopTick();
    const afterH = totalMin(d, false) / 60;
    const crossed = GOALS.find((g) => beforeH < g && afterH >= g) || null;
    const st = streaks(perDay(d.sessions));
    $('draw-comment').dataset.fresh = '1';
    render();
    say(commentFor(sec / 60, st.cur, crossed), crossed ? 'にゃーん！' : 'にゃ');
    UI.toast(hm(sec / 60) + ' 記録した。', () => {
      const d2 = load();
      d2.sessions = d2.sessions.filter((s) => s.id !== rec.id);
      save(d2);
      render();
    });
  }

  /** はかるのをやめる（記録しない） */
  function cancel() {
    const d = load();
    if (!d.running) return;
    const run = d.running;
    d.running = null;
    save(d);
    stopTick();
    render();
    UI.toast('記録しないでやめた。', () => {
      const d2 = load();
      d2.running = run;
      save(d2);
      render();
      startTick();
    });
  }

  function logClick(e) {
    const b = e.target.closest('[data-del]');
    if (!b) return;
    if (b.dataset.armed !== '1') {
      b.dataset.armed = '1';
      b.textContent = '本当に消す';
      return;
    }
    const d = load();
    const removed = d.sessions.find((s) => s.id === b.dataset.del);
    d.sessions = d.sessions.filter((s) => s.id !== b.dataset.del);
    save(d);
    render();
    UI.toast('消した。', () => {
      const d2 = load();
      if (removed) d2.sessions.push(removed);
      save(d2);
      render();
    });
  }

  /** これまでの時間（前のアプリの分）を入れる */
  function saveBase(e) {
    e.preventDefault();
    const h = Math.max(0, parseInt($('draw-base-h').value, 10) || 0);
    const m = Math.max(0, parseInt($('draw-base-m').value, 10) || 0);
    const d = load();
    d.baseMin = h * 60 + m;
    save(d);
    render();
    UI.toast('これまでの時間を ' + hm(d.baseMin) + ' にした。');
  }

  /** はかり忘れた分を手で足す */
  function addManual(e) {
    e.preventDefault();
    const date = $('draw-add-date').value;
    const min = parseInt($('draw-add-min').value, 10) || 0;
    if (!date || min <= 0) return;
    const startMs = new Date(date + 'T12:00:00').getTime();
    const d = load();
    d.sessions.push({ id: Date.now().toString(36), start: startMs, end: startMs + min * 60000, sec: min * 60, manual: true });
    save(d);
    $('draw-add-min').value = '';
    render();
    UI.toast(hm(min) + ' 足した。');
  }

  // ---------------------------------------------------------
  // 時計を動かす・休憩の知らせ
  // ---------------------------------------------------------
  function startTick() {
    stopTick();
    tick = setInterval(onTick, 1000);
    onTick();
  }
  function stopTick() {
    if (tick) clearInterval(tick);
    tick = null;
  }
  function onTick() {
    const d = load();
    const run = d.running;
    if (!run) return stopTick();
    const screen = $('screen-draw');
    if (screen && !screen.hidden) {
      renderClock(d);
      $('draw-today').textContent = hm((perDay(d.sessions).get(dayKey(Date.now())) || 0) + elapsedSec(run) / 60);
      renderGoal(d);
    }
    if (elapsedSec(run) >= run.target * 60 && notifiedFor !== run.start) {
      notifiedFor = run.start;
      const msg = run.target + '分たった。休憩しろ。目と手首を休ませて、水飲め。';
      if (screen && !screen.hidden) {
        $('draw-comment').dataset.fresh = '1';
        say(msg, 'にゃっ！');
      }
      chime();
      notify(msg);
    }
  }

  // ブラウザが許してくれるときだけ、画面の外にも知らせる（だめなら何もしない）
  function askNotify() {
    try {
      if ('Notification' in window && Notification.permission === 'default') Notification.requestPermission().catch(() => {});
    } catch (e) {
      /* 何もしない */
    }
  }
  function notify(msg) {
    try {
      if (!('Notification' in window) || Notification.permission !== 'granted') return;
      if (document.visibilityState === 'visible') return;
      new Notification('脳内タブ', { body: msg, tag: 'draw-break' });
    } catch (e) {
      /* iPhoneなど、ここからは出せない端末もある */
    }
  }

  // ---------------------------------------------------------
  // 休憩の音（アプリを開いているときだけ鳴る）
  //   ・iPhone では、画面を押したあとでないと音を出せないので、
  //     「はじめる」を押したときに準備（unlockAudio）しておく。
  //   ・【Apple Music が止まる対策】2026-11-12
  //     iPhone は、このアプリが音の準備をしただけで「音楽アプリを止めて
  //     自分が鳴らす」扱いになることがある。なので：
  //       1. 音がオフの日は、音の準備を一切しない
  //       2. 準備するのは「描いてる最中」だけ（画面を開いただけではしない）
  //       3. ふだんは「ambient（ほかの音楽とまざる）」にしておく
  //       4. 鳴らす瞬間だけ「transient（音楽を少し小さくして、終わったら戻す）」
  //       5. 鳴らし終わったら音の部品を眠らせる（suspend）
  //     ※ ambient なので、マナーモード中は休憩の音が鳴らないことがある。
  //       そのときは画面の「休憩しろ」とハルのほうで気づける。
  // ---------------------------------------------------------
  let audio = null;
  const soundOn = () => {
    try {
      return localStorage.getItem(SOUND_KEY) !== 'off';
    } catch (e) {
      return true;
    }
  };
  /** 音の扱いを切り替える（対応していない端末では何もしない） */
  function setSession(type) {
    try {
      if (navigator.audioSession) navigator.audioSession.type = type;
    } catch (e) {
      /* 使えない端末もある */
    }
  }
  function renderSound() {
    const on = soundOn();
    const b = $('btn-draw-sound');
    b.textContent = on ? '🔔 休憩の音：オン' : '🔕 休憩の音：オフ';
    b.setAttribute('aria-pressed', on ? 'true' : 'false');
  }
  function toggleSound() {
    try {
      localStorage.setItem(SOUND_KEY, soundOn() ? 'off' : 'on');
    } catch (e) {
      /* 保存できなくても何もしない */
    }
    renderSound();
    if (soundOn()) {
      unlockAudio();
      chime(); // 試しに一回
    } else if (audio) {
      // オフにしたら、音の部品ごと片付ける
      try {
        audio.close();
      } catch (e) {
        /* 何もしない */
      }
      audio = null;
    }
  }
  function unlockAudio() {
    if (!soundOn()) return; // オフの日は準備しない（音楽を止めないため）
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      setSession('ambient'); // 先に「ほかの音楽とまざる」にしてから作る
      if (!audio) audio = new AC();
      if (audio.state === 'suspended') audio.resume();
      // 無音を一瞬鳴らして、鳴らせる状態にしておく
      const b = audio.createBuffer(1, 1, 22050);
      const src = audio.createBufferSource();
      src.buffer = b;
      src.connect(audio.destination);
      src.start(0);
      // 準備が終わったらすぐ眠らせる（起きっぱなしだと音楽の邪魔になる）
      setTimeout(sleepAudio, 300);
    } catch (e) {
      /* 音が出せない端末では何もしない */
    }
  }
  function sleepAudio() {
    try {
      if (audio && audio.state === 'running') audio.suspend();
    } catch (e) {
      /* 何もしない */
    }
  }
  /** ぽろん、ぽろん（2回） */
  function chime() {
    if (!soundOn()) return;
    try {
      if (!audio) unlockAudio();
      if (!audio) return;
      setSession('transient'); // 鳴らすあいだだけ、音楽を少し小さくしてもらう
      if (audio.state === 'suspended') audio.resume();
      const t0 = audio.currentTime + 0.05;
      const notes = [880, 1318.5, 880, 1318.5];
      notes.forEach((f, i) => {
        const at = t0 + i * 0.22 + (i >= 2 ? 0.35 : 0);
        const o = audio.createOscillator();
        const g = audio.createGain();
        o.type = 'sine';
        o.frequency.value = f;
        g.gain.setValueAtTime(0.0001, at);
        g.gain.exponentialRampToValueAtTime(0.35, at + 0.02);
        g.gain.exponentialRampToValueAtTime(0.0001, at + 0.6);
        o.connect(g);
        g.connect(audio.destination);
        o.start(at);
        o.stop(at + 0.65);
      });
      setTimeout(() => {
        sleepAudio();
        setSession('ambient'); // 音楽を元の大きさに戻す
      }, 1800);
    } catch (e) {
      /* 何もしない */
    }
  }

  // ---------------------------------------------------------
  // はじめに1回
  // ---------------------------------------------------------
  function init() {
    haru = Haru.mount($('haru-draw'));
    $('draw-targets').addEventListener('click', chooseTarget);
    $('btn-draw-start').addEventListener('click', start);
    $('btn-draw-stop').addEventListener('click', stop);
    $('btn-draw-cancel').addEventListener('click', cancel);
    $('draw-log').addEventListener('click', logClick);
    $('draw-cal').addEventListener('click', calClick);
    $('btn-draw-prev').addEventListener('click', () => moveMonth(-1));
    $('btn-draw-next').addEventListener('click', () => moveMonth(1));
    $('btn-draw-sound').addEventListener('click', toggleSound);
    renderSound();
    // アプリを開き直したあとも鳴らせるように、最初に画面を触ったときに音の準備をする。
    // ただし「描いてる最中」で「音がオン」のときだけ（それ以外は音楽を止めないよう何もしない）
    document.addEventListener('pointerdown', function firstTouch() {
      if (!load().running || !soundOn()) return; // 条件が合うまで待ち続ける
      document.removeEventListener('pointerdown', firstTouch);
      unlockAudio();
    });
    $('draw-base-form').addEventListener('submit', saveBase);
    $('draw-add-form').addEventListener('submit', addManual);
    $('draw-add-date').value = dayKey(Date.now());
    const d = load();
    const h = Math.floor(d.baseMin / 60);
    $('draw-base-h').value = d.baseMin ? h : '';
    $('draw-base-m').value = d.baseMin ? d.baseMin % 60 : '';
    if (d.running) startTick();
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible' && load().running) onTick();
    });
  }

  /** ホームなどから「いま描いてる？」を知るため */
  const isRunning = () => !!load().running;

  return { init, render, isRunning };
})();
