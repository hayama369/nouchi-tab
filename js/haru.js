/* =========================================================
   haru.js ― 黒猫のハルを描いて動かすファイル
   ---------------------------------------------------------
   ・ハルはSVG（線と図形）で描いています。画像ファイルはありません。
   ・色は style.css の --cat-… で変えられます。
   ・動き（まばたき・しっぽ・寝る）のアニメーションも style.css の
     「ハル」の段にあります。ここでは「いつ・どの動きをするか」だけ決めます。

   使い方（app.js から）：
     const h = Haru.mount(入れたい場所の要素);
     h.setSleeping(true)  … 寝る／起きる
     h.meow('にゃ')       … ふきだしで鳴く
     h.hop()              … ぴょんと跳ねる
   ========================================================= */

const Haru = (() => {
  // タップしたときの鳴き声（ランダムに1つ）
  const VOICES = ['にゃ', 'にゃー', 'にゃっ', '…にゃ', 'んにゃ'];

  // --- ハルの形 -----------------------------------------------
  // 写真のハルに合わせて：大きい耳・丸い顔・金色の丸い目・胸の右寄りの白・床に流したしっぽ。
  // 余計な線は描かず、黒いシルエット＋目＋胸の白だけにしている。
  // 「ふち（背景から浮かせる細い輪郭）」と「黒い塗り」で2回描くので関数にしてある
  function silhouette() {
    return `
      <path d="M33 121 C29 95 37 68 60 60 C83 68 91 95 87 121 Z"/>
      <path class="haru-ear-l" d="M37 38 L39 9 L57 26 Z"/>
      <path class="haru-ear-r" d="M83 38 L81 9 L63 26 Z"/>
      <ellipse cx="60" cy="45" rx="25" ry="22"/>`;
  }

  const SVG = `
  <svg class="haru-svg" viewBox="0 0 120 130" aria-hidden="true" focusable="false">
    <!-- しっぽ（床に流して、先っぽがゆらゆら） -->
    <g class="haru-tail">
      <path class="rim-line" d="M40 120 C27 123 15 121 10 111"/>
      <path class="fill-line" d="M40 120 C27 123 15 121 10 111"/>
    </g>

    <g class="haru-breath">
      <!-- 体と頭：細いふち → 黒い塗り の順で重ねる -->
      <g class="rim">${silhouette()}</g>
      <g class="fill">${silhouette()}</g>

      <!-- 胸のエンジェルマーク（右寄りの小さい白） -->
      <ellipse class="angel" cx="66" cy="84" rx="2.4" ry="3.4" transform="rotate(-18 66 84)"/>

      <!-- 目（起きてるとき）：金色の丸い目 -->
      <g class="haru-eyes">
        <circle class="eye" cx="50" cy="46" r="5.6"/>
        <circle class="eye" cx="70" cy="46" r="5.6"/>
        <ellipse class="pupil" cx="50" cy="46" rx="1.7" ry="4.2"/>
        <ellipse class="pupil" cx="70" cy="46" rx="1.7" ry="4.2"/>
      </g>

      <!-- 目（寝てるとき） -->
      <g class="haru-eyes-closed">
        <path d="M44.5 47 Q50 50.5 55.5 47"/>
        <path d="M64.5 47 Q70 50.5 75.5 47"/>
      </g>
    </g>
  </svg>`;

  /** el の中にハルを置いて、操作用の道具を返す */
  function mount(el) {
    el.classList.add('haru');
    el.innerHTML = `
      <span class="haru-bubble" hidden></span>
      <span class="haru-z" aria-hidden="true">z</span>
      ${SVG}`;

    const bubble = el.querySelector('.haru-bubble');
    let bubbleTimer = null;
    let wantSleep = false; // アプリ側が「寝てて」と言っているかどうか

    // ぴょんと跳ねる
    function hop() {
      el.classList.remove('is-hop');
      void el.offsetWidth; // アニメーションを最初からやり直すためのおまじない
      el.classList.add('is-hop');
    }

    // ふきだしで鳴く
    function meow(text) {
      bubble.textContent = text || VOICES[Math.floor(Math.random() * VOICES.length)];
      bubble.hidden = false;
      clearTimeout(bubbleTimer);
      bubbleTimer = setTimeout(() => (bubble.hidden = true), 1600);
    }

    // 寝る／起きる
    function setSleeping(on) {
      wantSleep = !!on;
      el.classList.toggle('is-sleeping', wantSleep);
    }

    // タップしたら：寝てたら一瞬起きて、鳴いて跳ねる
    el.addEventListener('click', (e) => {
      e.stopPropagation();
      if (el.classList.contains('is-sleeping')) {
        el.classList.remove('is-sleeping');
        // 少ししたら、また寝る（その間に作業が登録されていたら起きたまま）
        setTimeout(() => el.classList.toggle('is-sleeping', wantSleep), 2200);
      }
      hop();
      meow();
    });

    return { hop, meow, setSleeping };
  }

  return { mount };
})();
