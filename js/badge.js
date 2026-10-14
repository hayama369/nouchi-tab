/* =========================================================
   badge.js ― ホーム画面のアイコンに「未完了の数」を出す
   ---------------------------------------------------------
   ・数えるのは「あとで見る」の思いつきのうち、まだ完了していないもの。
   ・iPhone では「ホーム画面に追加」したアプリで、通知を許可したときだけ使えます
     （バッジは通知の仲間扱いのため）。
   ・通知そのものは一切送りません。iPhone の
     設定 → 通知 → 脳内タブ で「バナー」「サウンド」をオフ、「バッジ」だけオンにすれば、
     数字だけが出ます。
   ・数字が変わるのはアプリを開いている間と、アプリを閉じた瞬間です。
   ・ボタンと処理のひも付けは js/app.js。
   ========================================================= */

const Badge = (() => {
  const $ = (id) => document.getElementById(id);

  /** この端末でバッジが使えるか */
  function isSupported() {
    return 'setAppBadge' in navigator;
  }

  /** 通知（＝バッジ）の許可：'granted' / 'denied' / 'default' / 'unsupported' */
  function permission() {
    if (!('Notification' in window)) return 'unsupported';
    return Notification.permission;
  }

  /** 未完了の数 */
  function count() {
    return Storage.getBrainTabs().filter((t) => !t.completed).length;
  }

  /** アイコンの数字を今の状態に合わせる（使えない端末では何もしない） */
  function update() {
    if (!isSupported()) return;
    if (permission() === 'denied') return;
    const n = count();
    const p = n > 0 ? navigator.setAppBadge(n) : navigator.clearAppBadge();
    if (p && p.catch) p.catch(() => {});
  }

  /** ふりかえり画面の「アイコンに数字を出す」欄 */
  function render() {
    const card = $('badge-card');
    if (!card) return;
    const btn = $('btn-badge');
    const msg = $('badge-msg');
    const p = permission();

    if (!isSupported() || p === 'unsupported') {
      btn.hidden = true;
      msg.textContent = 'ホーム画面に追加した「脳内タブ」から開くと使えます。';
      return;
    }
    if (p === 'granted') {
      btn.hidden = true;
      msg.textContent =
        'オン。いま ' + count() + ' 個。通知はいらないなら、iPhoneの 設定 → 通知 → 脳内タブ で「バナー」と「サウンド」をオフ、「バッジ」だけオンにして。';
      return;
    }
    if (p === 'denied') {
      btn.hidden = true;
      msg.textContent = '通知がオフになっているので出せません。iPhoneの 設定 → 通知 → 脳内タブ で許可してから、もう一度ひらいて。';
      return;
    }
    btn.hidden = false;
    msg.textContent = '「あとで見る」の未完了の数を、アイコンに数字で出します。通知は送りません。';
  }

  /** 「オンにする」：許可をもらって、すぐ数字を出す */
  async function enable() {
    if (!('Notification' in window)) return;
    try {
      await Notification.requestPermission();
    } catch (e) {
      /* 何もしない */
    }
    update();
    render();
  }

  return { isSupported, update, render, enable };
})();
