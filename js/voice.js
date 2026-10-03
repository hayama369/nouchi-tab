/* =========================================================
   voice.js ― 音声入力を担当するファイル
   ---------------------------------------------------------
   ・ブラウザに入っている音声認識（Web Speech API）を使います。
   ・対応していないブラウザでは「声で入れる」ボタン自体を出しません。
   ・iPhoneのキーボードのマイクでも同じことができるので、
     こちらが動かなくても困らないようにしてあります。
   ========================================================= */

const Voice = (() => {
  const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  let rec = null;

  /** このブラウザで使えるか */
  function isSupported() {
    return !!Recognition;
  }

  /**
   * 聞き取りを始める
   *   onText(文字, 確定したか) … 聞き取れた文字が届くたびに呼ばれる
   *   onEnd()                 … 聞き取りが終わったら呼ばれる
   *   onError(理由)           … うまくいかなかったら呼ばれる
   */
  function start(onText, onEnd, onError) {
    if (!Recognition) return onError && onError('unsupported');
    stop();
    rec = new Recognition();
    rec.lang = 'ja-JP';
    rec.interimResults = true; // 話している途中の文字も出す
    rec.continuous = false; // ひと息しゃべったら止まる

    rec.onresult = (e) => {
      let text = '';
      let isFinal = true;
      for (let i = 0; i < e.results.length; i++) {
        text += e.results[i][0].transcript;
        if (!e.results[i].isFinal) isFinal = false;
      }
      onText(text, isFinal);
    };
    rec.onerror = (e) => onError && onError(e.error);
    rec.onend = () => {
      rec = null;
      onEnd && onEnd();
    };

    try {
      rec.start();
    } catch (err) {
      onError && onError('start-failed');
    }
  }

  /** 聞き取りを止める */
  function stop() {
    if (rec) {
      try {
        rec.stop();
      } catch (e) {
        /* すでに止まっていれば何もしない */
      }
    }
  }

  function isListening() {
    return !!rec;
  }

  return { isSupported, start, stop, isListening };
})();
