// 答對提示音 10 種（src/tones.js）＋存檔欄位 settings.tone（src/core.js）。
// 執行：node --test tests/tones.test.js
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const T = require("../src/tones.js");
const C = require("../src/core.js");

function fakeCtx() {
  const ends = [], peaks = [];
  const param = (rec) => ({ setValueAtTime(v) { rec && rec.push(v); }, exponentialRampToValueAtTime(v) { rec && rec.push(v); } });
  return {
    currentTime: 0, sampleRate: 8000, destination: {}, ends, peaks,
    createOscillator() { return { type: "", frequency: param(), connect() {}, start() {}, stop(t) { ends.push(t); } }; },
    createGain() { return { gain: param(peaks), connect() {} }; },
    createBuffer(ch, len) { const d = new Float32Array(len); return { getChannelData: () => d }; },
    createBufferSource() { return { buffer: null, connect() {}, start() {}, stop(t) { ends.push(t); } }; }
  };
}

test("10 種、名稱不重複，每種都會發聲、1.2 秒內結束、音量 ≤ 0.3", () => {
  assert.equal(T.TONES.length, 10);
  assert.equal(new Set(T.TONES.map((t) => t.name)).size, 10);
  T.TONES.forEach((t, i) => {
    const c = fakeCtx();
    T.play(c, i);
    assert.ok(c.ends.length >= 1, t.name + " 沒有發聲");
    assert.ok(Math.max(...c.ends) <= 1.2, t.name + " 太長：" + Math.max(...c.ends));
    assert.ok(Math.max(...c.peaks) <= 0.3, t.name + " 太大聲");
  });
  const c = fakeCtx(); T.play(c, 99); assert.ok(c.ends.length >= 1, "超出範圍退回第 1 種");
});

test("settings.tone：可設 0–9；超出範圍、非整數被拒；舊存檔沒有 tone 照樣通過驗證", () => {
  const b = { cards: [], concepts: { "1-1": { unit: "1" } }, figs: {} };
  const env = { bank: b, now: Date.parse("2026-10-13T12:00:00+08:00") };
  const s0 = C.blankState();
  let r = C.reduce(s0, { type: "settings", id: "t1", tone: 7 }, env);
  assert.ok(!r.error, String(r.error)); assert.equal(r.state.settings.tone, 7);
  assert.ok(C.reduce(s0, { type: "settings", id: "t2", tone: 10 }, env).error, "10 要被拒");
  assert.ok(C.reduce(s0, { type: "settings", id: "t3", tone: 1.5 }, env).error, "1.5 要被拒");
  const old = JSON.parse(JSON.stringify(s0)); delete old.settings.tone;
  assert.equal(C.checkState(old, b).length, 0, "舊存檔沒有 tone 也要合法");
  const bad = JSON.parse(JSON.stringify(s0)); bad.settings.tone = "3";
  assert.ok(C.checkState(bad, b).length > 0, "tone 是字串要不合法");
});
