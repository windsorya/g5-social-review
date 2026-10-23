// 錯題站（g5-wrong-review）讀的「社會 app 待加強題數」（交辦 #4027；介面＝錯題站 docs/app-weak-entry-design-20261019.md 第 2 節）。
// 這是樣板：網站根目錄的 weak-export.js 由 build.py 把下面兩個 INLINE 標記換成 src/socbank.js、src/core.js 原文產生，勿手改那一份。
// 題數一律由 app 自己出題用的同一份程式算：題庫物件＝socbank.js bank()（app.html 也用它）、存檔判讀＝core.js decode、
// 題集與判準＝core.js weakTally（裡面就是畫面「練待加強的」用的 poolCards＋reviewCounts）。這裡不另寫判定。
// 規矩（設計書第 0、2 節）：classic script、包在 IIFE 裡、執行期間同步註冊一次；不新增也不改任何全域、不讀寫 localStorage、不連網。
// socbank.js、core.js 是在下面的函式裡跑：把參數 window 換成私有物件 R、module 換成 undefined，它們的 root.G5SocBank／root.G5Core 就寫進 R，不碰真正的 window。
(function () {
  "use strict";
  if (typeof window === "undefined" || typeof window.G5WeakExportRegister !== "function") return;   // 不是被錯題站載入（例如直接開這個檔）就什麼都不做
  var R = {};
  (function (window, module) {
/*@INLINE src/socbank.js*/
/*@INLINE src/core.js*/
  })(R, undefined);
  var C = R.G5Core, BANK = R.G5SocBank.bank();
  window.G5WeakExportRegister({
    api: 1,
    key: C.LS_KEY,   // "g5soc.v1"
    links: { weak: null, challenge: null },   // 社會站沒有「直接開練待加強」的網址（只讀 #c/ 與 #sync=）；錯題站就連首頁並附說明
    // raw＝localStorage 或雲端那份原始字串；nowMs＝Date.now()。讀法與 app 開頁相同（decode：v3 升 v4、checkState 不合法就不讀）
    summarize: function (raw, nowMs) {
      if (typeof raw !== "string" || typeof nowMs !== "number" || !isFinite(nowMs)) return { ok: false };
      var d = C.decode(raw, BANK);
      if (!d.accepted) return { ok: false };
      var s = d.state, t = C.weakTally(s, BANK, C.dayKey(nowMs)), seen = 0;
      Object.keys(s.cards).forEach(function (k) { seen += s.cards[k].seen; });
      return { ok: true, answers: s.log.length, seen: seen, weak: t.weak, weakToday: t.weakToday,
               challenge: t.challenge, challengeToday: t.challengeToday, out: t.out };
    }
  });
})();
