// 補做重開的固化（2026-10-19 律師：「為何補做暫停使用？請修好並固化」；交辦 #2995／#3015）。四站同一支。
// 10-18 縮範圍曾用 localStorage 旗標把補做入口預設關閉，孩子在日曆下只看到「補做暫停使用」。
// 這支擋：再加回開關、再出現暫停說明、補做排不出卡時的提示說假話（Codex 審 b7bfddf F5、a619a7a 等四站第 1 輪），
// 以及補做排到考不到的題（#3010 的 isOut：每日計畫連到期複習都停，補做同一條）。
// 行為面由 tests/e2e_missing.py ③⑤⑥⑦⑧ 在真瀏覽器鎖住。執行：node --test tests/makeup_open.test.js
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const C = require("../src/core.js");

const root = path.join(__dirname, "..");
for (const f of ["src/app.html", "index.html"]) {
  const t = () => fs.readFileSync(path.join(root, f), "utf8");
  const msg = (code) => { const m = t().match(new RegExp(code + ':"([^"]*)"')); assert.ok(m, "找不到 " + code + " 提示"); return m[1]; };
  test(f + "：補做入口沒有開關、日曆下沒有「暫停使用」說明", () => {
    const s = t();
    assert.ok(!/makeupOn|MAKEUP_ON/.test(s), "補做又被加了開關");
    assert.ok(!s.includes("暫停使用："), "補做又被關掉（日曆下的暫停說明回來了）");
    assert.ok(s.includes('data-mk="'), "補做按鈕不見了");
  });
  test(f + "：以後也排不出補做卡（ALLDONE）＝只說能出的題都學會了，不說每張都學會、不叫她再來", () => {
    const m = msg("MAKEUP_ALLDONE");
    assert.ok(m.includes("能出的題都已經學會了"), m);
    assert.ok(!/明天|再來|每一張|每張|全部/.test(m), m);
  });
  test(f + "：暫時排不出補做卡（EMPTY）＝說還沒到複習日，不承諾明天、不說都學會了", () => {
    const m = msg("MAKEUP_EMPTY");
    assert.ok(m.includes("還沒到該複習的日子"), m);
    assert.ok(!/明天|就是已經學會/.test(m), m);
  });
}

// ---- 核心：EMPTY／ALLDONE 分流與考不到的題 ----
const D = "2026-10-20", NOON = (d) => Date.parse(d + "T12:00:00+08:00");
const CONCEPTS = { "1-1": { unit: "1" } }, FIGS = {};
const card = (id) => ({ id, concept: "1-1", type: "choice", q: "題目 " + id, opts: ["甲", "乙"], a: 0 });
const mkbank = (ids, active, out) => ({ cards: ids.map(card), concepts: CONCEPTS, figs: FIGS, active: Object.fromEntries(active.map((i) => [i, 1])), out: Object.fromEntries((out || []).map((i) => [i, 1])) });
const blankDay = () => ({ planIds: [], doneIds: [], touched: [], extraDone: false, labRuns: 0, teach: 0, mood: null });
const LEARNED = { seen: 2, goodDays: ["2026-10-15", "2026-10-18"], blockedDay: null, due: null };
const start = (s, b) => C.reduce(s, { type: "sessionStart", id: "mk" + Math.random(), kind: "makeup", day: "2026-10-19" }, { bank: b, now: NOON(D) });

test("K1 能出的題只剩一張還沒到複習日（10/19 第一次答對、10/22 到期）：補做回 EMPTY，不是 ALLDONE", () => {
  const b = mkbank(["a", "s"], ["a", "s"]); const s = C.blankState();
  s.cards.a = Object.assign({}, LEARNED); s.cards.s = { seen: 1, goodDays: ["2026-10-19"], blockedDay: null, due: "2026-10-22" };
  s.days[D] = blankDay();
  assert.equal(start(s, b).error, "MAKEUP_EMPTY");
});
test("K2 只剩考不到的題（out）練過沒學會、已到期：補做不排它，回 ALLDONE（永遠排不到，不是之後就有）", () => {
  const b = mkbank(["a", "o"], ["a"], ["o"]); const s = C.blankState();
  s.cards.a = Object.assign({}, LEARNED); s.cards.o = { seen: 1, goodDays: ["2026-10-15"], blockedDay: null, due: "2026-10-18" };
  s.days[D] = blankDay();
  const r = start(s, b);
  assert.equal(r.error, "MAKEUP_ALLDONE", "補做排到考不到的題：" + JSON.stringify(r.state && r.state.session));
});
test("K3 考不到的題不進補做回合，其他到期的練過題照排", () => {
  const b = mkbank(["a", "o", "c"], ["a", "c"], ["o"]); const s = C.blankState();
  s.cards.a = Object.assign({}, LEARNED);
  s.cards.o = { seen: 1, goodDays: ["2026-10-15"], blockedDay: null, due: "2026-10-18" };
  s.cards.c = { seen: 1, goodDays: ["2026-10-15"], blockedDay: null, due: "2026-10-18" };
  s.days[D] = blankDay();
  const r = start(s, b);
  assert.ok(!r.error, r.error);
  assert.deepEqual(r.state.session.queue, ["c"]);
  assert.equal(r.state.session.makeup, "2026-10-19");
});
