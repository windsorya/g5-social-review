// 探險地圖＋成長圖（2026-10-14）：規則與自然站同一份、一站一階、存檔 key 隔離。執行：node --test tests/map.test.js
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const M = require("../src/map.js");
const SRC = fs.readFileSync(path.join(__dirname, "../src/map.js"), "utf8");
const BANKF = fs.readdirSync(path.join(__dirname, "../src")).find((f) => /^(math|chi|soc)bank\.js$/.test(f));

function cids() { return Object.keys(require("../src/" + BANKF).CONCEPTS); }
const CIDS = cids();
const st = (n) => Object.fromEntries(CIDS.map((c, i) => [c, i < n ? 3 : 0]));
const on = () => true;

test("成長圖階數＝觀念數：一站一階、最後一站剛好長完", () => {
  assert.equal(M.PLANT.length - 1, CIDS.length);
  for (let n = 0; n <= CIDS.length; n++) {
    const t = M.trail({ cids: CIDS, stages: st(n), on });
    assert.equal(t.level, n); assert.equal(t.walked, n);
  }
  assert.equal(M.trail({ cids: CIDS, stages: st(CIDS.length), on }).allDone, true);
});

test("走過＝開花以上（BLOOM 3）：長葉了不算", () => {
  assert.equal(M.BLOOM, 3);
  const s = Object.fromEntries(CIDS.map((c) => [c, 2]));
  assert.equal(M.trail({ cids: CIDS, stages: s, on }).walked, 0);
});

test("每一階的圖都比上一階多畫東西，最後一階有新部位可播動畫", () => {
  let prev = -1;
  for (let n = 0; n <= CIDS.length; n++) {
    const svg = M.plantSvg(n);
    assert.match(svg, /^<svg class="pl"/);
    assert.ok(!/[\u{1F300}-\u{1FAFF}]/u.test(svg), "不用 emoji");
    const parts = (svg.match(/<(rect|path|circle|ellipse)\b/g) || []).length;
    assert.ok(parts > prev, `第 ${n} 階沒有多畫東西`); prev = parts;
    if (n > 0) assert.ok(M.plantSvg(n, { fresh: true }).includes('class="newpart"'));
  }
  assert.match(M.plantSvg(1, { ghost: true }), /class="ghost"/);
});

test("mapSeen 存在本站自己的 key，不碰作答存檔；壞值當沒有", () => {
  assert.match(M.SEEN_KEY, /^g5(math|chi|soc)\.mapSeen$/);
  const m = {}; const s = { getItem: (k) => (k in m ? m[k] : null), setItem: (k, v) => { m[k] = String(v); } };
  assert.equal(M.readSeen(s), null);
  M.writeSeen(s, 4); assert.deepEqual(Object.keys(m), [M.SEEN_KEY]); assert.equal(M.readSeen(s), 4);
  m[M.SEEN_KEY] = "x"; assert.equal(M.readSeen(s), null);
  const bad = { getItem() { throw new Error("SecurityError"); }, setItem() { throw new Error("Quota"); } };
  assert.equal(M.readSeen(bad), null); assert.equal(M.writeSeen(bad, 1), false);
});

test("規則與自然站逐字相同（trail／readSeen／writeSeen／growth）", (t) => {
  const sciP = path.join(__dirname, "../../g5-sci-review/src/map.js");
  if (!fs.existsSync(sciP)) return t.skip("本機沒有自然站 repo");
  const sci = fs.readFileSync(sciP, "utf8");
  const cut = (s) => s.slice(s.indexOf("  // o.cids："), s.indexOf("  // ", s.indexOf("function growth")));
  assert.equal(cut(SRC), cut(sci));
});

test("每一階的觀看紀錄都讀得回來（含兩位數的第 10、11 階）；前導零、超過上限都當沒有", () => {
  const m = {}; const s = { getItem: (k) => (k in m ? m[k] : null), setItem: (k, v) => { m[k] = String(v); } };
  for (let n = 0; n < M.PLANT.length; n++) { M.writeSeen(s, n); assert.equal(M.readSeen(s), n, "第 " + n + " 階"); }
  for (const bad of ["01", String(M.PLANT.length), "100", " 3"]) { m[M.SEEN_KEY] = bad; assert.equal(M.readSeen(s), null, bad); }
});

test("每一階的圖都畫在框內（viewBox 0 0 120 150），不會被切掉", () => {
  for (let n = 0; n < M.PLANT.length; n++) {
    const svg = M.plantSvg(n);
    for (const m of svg.matchAll(/[ML]\s*(-?[\d.]+)[ ,](-?[\d.]+)/g)) {
      const x = +m[1], y = +m[2];
      assert.ok(x >= 0 && x <= 120 && y >= 0 && y <= 150, `第 ${n} 階有點落在框外：${x},${y}`);
    }
  }
});
