// 答對提示音 10 種（2026-10-13 律師：「請提供十種音效或音樂，讓我可以設定（她）自己手動選擇」）。
// 全部用 Web Audio 現場合成：不載外部音檔（沒有版權問題、離線也能播），每種 1.2 秒內結束。
// play(ctx, t0) 只用 createOscillator／createGain／createBuffer，node 測試用假的 AudioContext 驗長度與音量。
(function (root) {
  "use strict";
  // 一個音：頻率 f、開始 at（秒）、長度 dur、波形 type、音量 vol
  function note(ctx, t0, f, at, dur, type, vol, slideTo) {
    var o = ctx.createOscillator(), g = ctx.createGain(), t = t0 + at;
    o.type = type || "sine";
    o.frequency.setValueAtTime(f, t);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol || 0.12, t + 0.015);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(ctx.destination);
    o.start(t); o.stop(t + dur + 0.02);
    return t + dur + 0.02;
  }
  // 拍手：短促的雜訊
  function clap(ctx, t0, at, vol) {
    var len = Math.floor(ctx.sampleRate * 0.08), buf = ctx.createBuffer(1, len, ctx.sampleRate), d = buf.getChannelData(0);
    for (var i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3);
    var s = ctx.createBufferSource(), g = ctx.createGain(), t = t0 + at;
    s.buffer = buf; g.gain.setValueAtTime(vol || 0.25, t);
    s.connect(g); g.connect(ctx.destination); s.start(t); s.stop(t + 0.1);
    return t + 0.1;
  }
  var C5 = 523.25, D5 = 587.33, E5 = 659.25, G5 = 783.99, A5 = 880, C6 = 1046.5, E6 = 1318.5, G6 = 1568;
  var TONES = [
    { name: "叮咚", play: function (c, t) { note(c, t, 660, 0, 0.25); return note(c, t, 880, 0.12, 0.3); } },   // 原本那一種
    { name: "鈴鐺", play: function (c, t) { note(c, t, G6, 0, 0.6, "sine", 0.08); return note(c, t, G6 * 2.76, 0, 0.35, "sine", 0.03); } },
    { name: "木琴三連音", play: function (c, t) { note(c, t, C5, 0, 0.18, "triangle"); note(c, t, E5, 0.1, 0.18, "triangle"); return note(c, t, G5, 0.2, 0.3, "triangle"); } },
    { name: "星星閃爍", play: function (c, t) { var e = 0; [C6, E6, G6, E6 * 2].forEach(function (f, i) { e = note(c, t, f, i * 0.07, 0.15, "sine", 0.06); }); return e; } },
    { name: "拍手", play: function (c, t) { clap(c, t, 0); clap(c, t, 0.15); return clap(c, t, 0.3); } },
    { name: "小號號角", play: function (c, t) { note(c, t, G5, 0, 0.12, "sawtooth", 0.05); note(c, t, G5, 0.14, 0.12, "sawtooth", 0.05); return note(c, t, C6, 0.28, 0.45, "sawtooth", 0.05); } },
    { name: "水滴", play: function (c, t) { note(c, t, 1200, 0, 0.12, "sine", 0.12, 500); return note(c, t, 1500, 0.15, 0.12, "sine", 0.1, 650); } },
    { name: "彈跳", play: function (c, t) { return note(c, t, 300, 0, 0.35, "square", 0.04, 900); } },
    { name: "豎琴滑音", play: function (c, t) { var e = 0; [C5, D5, E5, G5, A5, C6].forEach(function (f, i) { e = note(c, t, f, i * 0.06, 0.35, "triangle", 0.07); }); return e; } },
    { name: "八音盒", play: function (c, t) { var e = 0; [[E6, 0], [C6, 0.18], [G5 * 2, 0.36], [C6 * 2, 0.6]].forEach(function (p) { e = note(c, t, p[0], p[1], 0.4, "sine", 0.06); }); return e; } }
  ];
  function play(ctx, i) { var k = TONES[i] ? i : 0; return TONES[k].play(ctx, ctx.currentTime); }
  var api = { TONES: TONES, play: play };
  if (typeof module !== "undefined" && module.exports) module.exports = api; else root.G5Tones = api;
})(typeof window !== "undefined" ? window : this);
