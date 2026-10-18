// （2026-10-13 由數學站 g5-math-review fd585e3 複製；只改存檔 key、診斷期日期與 M2 用的題庫）
// v3 驗收矩陣 30 條（Codex 設計者規格 g5-v3-design-spec-20261011.md §4）。執行：node --test tests/
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const C = require("../src/core.js");

const T = (iso) => Date.parse(iso);
const D = "2026-10-20";
const NOON = (d) => T(d + "T12:00:00+08:00");
const CONCEPTS = { "1-1": { unit: "1" }, "1-2": { unit: "1" }, "3-1": { unit: "3" } };
const FIGS = { "sun-am": 1, "sun-pm": 1 };
function card(id, concept, extra) {
  return Object.assign({ id, concept: concept || "1-1", type: "choice", q: "題目 " + id, opts: ["甲", "乙"], a: 0 }, extra || {});
}
function bank(ids, concept) { return { cards: ids.map((id) => card(id, concept)), concepts: CONCEPTS, figs: FIGS }; }
function env(b, iso) { return { bank: b, now: typeof iso === "number" ? iso : T(iso) }; }
let opn = 0;
function op(type, extra) { return Object.assign({ type, id: "op" + (++opn) }, extra || {}); }
function run(state, b, now, action) {
  const r = C.reduce(state, action, { bank: b, now });
  assert.ok(!r.error, "unexpected error " + r.error + " for " + action.type);
  return r.state;
}
function learned(seen, goodDays, due, extra) { return Object.assign({ seen, goodDays, blockedDay: null, due }, extra || {}); }
function memStorage(init) {
  const m = Object.assign({}, init || {}); let fail = false; let writes = 0;
  return { getItem: (k) => (k in m ? m[k] : null), setItem: (k, v) => { if (fail) throw new Error("QuotaExceeded"); writes++; m[k] = v; },
           setFail: (f) => { fail = f; }, raw: m, writes: () => writes };
}

test("01 同日重複答對不畢業", () => {
  const b = bank(["s1"]); let s = C.blankState();
  for (let i = 0; i < 3; i++) s = run(s, b, NOON(D), op("answer", { cardId: "s1", ok: true }));
  assert.deepEqual(s.cards.s1, { seen: 3, goodDays: [D], blockedDay: null, due: "2026-10-23" });   // 2026-10-18 排程改「答對後隔 3 天、第 2 次答對學會」（#2696）：只改日期，守的情形不變
  assert.equal(s.cards.s1.goodDays.length, 1);
});

test("02 不同日期有效作答才畢業", () => {
  const b = bank(["s1"]); let s = C.blankState();
  ["2026-10-19", "2026-10-20", "2026-10-22"].forEach((d) => { s = run(s, b, NOON(d), op("answer", { cardId: "s1", ok: true })); });
  assert.deepEqual(s.cards.s1.goodDays, ["2026-10-19", "2026-10-20", "2026-10-22"]);
  assert.equal(s.cards.s1.due, null);
  assert.equal(s.cards.s1.goodDays.length >= 3, true);
});

test("03 提示／不確定答對撤銷畢業", () => {
  const b = bank(["s1"]);
  for (const flag of ["hint", "unsure"]) {
    let s = C.blankState();
    s.cards.s1 = learned(3, ["2026-10-15", "2026-10-16", "2026-10-18"], null);
    s = run(s, b, NOON(D), op("answer", { cardId: "s1", ok: true, [flag]: true }));
    assert.deepEqual(s.cards.s1, { seen: 4, goodDays: [], blockedDay: D, due: "2026-10-21" }, flag);
  }
});

test("04 同日失敗後補答不算有效日", () => {
  const b = bank(["s1"]); let s = C.blankState();
  s = run(s, b, NOON(D), op("answer", { cardId: "s1", ok: false }));
  s = run(s, b, NOON(D), op("answer", { cardId: "s1", ok: true }));
  assert.deepEqual(s.cards.s1, { seen: 2, goodDays: [], blockedDay: D, due: "2026-10-21" });
  assert.deepEqual(s.days[D].doneIds, ["s1"]);
});

test("05 同一操作 ID 重送只處理一次", () => {
  const b = bank(["s1"]); let s = C.blankState();
  const a = { type: "answer", id: "a1", cardId: "s1", ok: true };
  s = run(s, b, NOON(D), a);
  const r = C.reduce(s, a, env(b, NOON(D)));
  assert.equal(r.dup, true); s = r.state;
  assert.equal(s.cards.s1.seen, 1); assert.equal(s.cards.s1.goodDays.length, 1);
  assert.deepEqual(s.days[D].doneIds, ["s1"]);
  assert.equal(s.ops.filter((x) => x === "a1").length, 1);
});

test("06 變式移到前方、不複製；同一實驗完成兩次只處理一次", () => {
  const b = bank(["s1", "s2", "s3", "s4"]); let s = C.blankState();
  ["s1", "s2", "s3", "s4"].forEach((id) => { s.cards[id] = learned(1, [], "2026-10-20"); });
  s = run(s, b, NOON(D), op("sessionStart", {}));
  s = run(s, b, NOON(D), op("answer", { cardId: "s1", ok: false }));
  s.session.queue = ["s3", "s2", "s4"];
  s = run(s, b, NOON(D), op("labStart", { runId: "r1", lab: "shadow", tasks: 1, answer: 0, from: "wrong", card: "s1" }));
  s = run(s, b, NOON(D), op("labPredict", { runId: "r1", choice: 0 }));
  s = run(s, b, NOON(D), op("labTask", { runId: "r1", task: 0 }));
  s = run(s, b, NOON(D), op("labComplete", { runId: "r1", variationId: "s2" }));
  const again = C.reduce(s, op("labComplete", { runId: "r1", variationId: "s2" }), env(b, NOON(D)));
  assert.equal(again.dup, true); s = again.state;
  assert.deepEqual(s.session.queue, ["s2", "s3", "s4"]);
  assert.equal(s.session.kinds.s2, "variation");
  assert.equal(s.days[D].labRuns, 1);
});

test("07 變式答對不增加有效日、同日再答也不畢業", () => {
  const b = bank(["s2"]); let s = C.blankState();
  s.cards.s2 = learned(2, ["2026-10-18", "2026-10-19"], "2026-10-21");
  s = run(s, b, NOON(D), op("answer", { cardId: "s2", ok: true, variation: true }));
  s = run(s, b, NOON(D), op("answer", { cardId: "s2", ok: true }));
  assert.equal(s.cards.s2.seen, 4); assert.equal(s.cards.s2.goodDays.length, 2);
  assert.equal(s.cards.s2.due, "2026-10-21");
});

function sixPlan() {
  const b = bank(["s1", "s2", "s3", "s4", "s5", "s23"]); const s = C.blankState();
  s.days[D] = { planIds: ["s1", "s2", "s3", "s4", "s5", "s23"], doneIds: [], touched: [], extraDone: false, labRuns: 0, teach: 0, mood: null };
  return { b, s };
}
test("08 短回合完成≠當日完成", () => {
  let { b, s } = sixPlan();
  s = run(s, b, NOON(D), op("sessionStart", { size: 3 }));
  ["s1", "s2", "s3"].forEach((id) => { s = run(s, b, NOON(D), op("answer", { cardId: id, ok: true })); });
  const v = C.view(s, env(b, NOON(D)));
  assert.equal(v.session.queue.length, 0); assert.equal(v.completed, false);
  assert.deepEqual(v.M.cardProgress, { done: 3, planned: 6 });
  assert.equal(C.endTitle(v), "這一輪完成了");
});

test("09 短回合後接續做完，最後一張不算加碼", () => {
  let { b, s } = sixPlan();
  s = run(s, b, NOON(D), op("sessionStart", { size: 3 }));
  ["s1", "s2", "s3"].forEach((id) => { s = run(s, b, NOON(D), op("answer", { cardId: id, ok: true })); });
  s = JSON.parse(JSON.stringify(s));   // 重載
  s = run(s, b, NOON(D), op("sessionStart", {}));
  assert.deepEqual(s.session.queue, ["s4", "s5", "s23"]);
  ["s4", "s5", "s23"].forEach((id) => { s = run(s, b, NOON(D), op("answer", { cardId: id, ok: true })); });
  const v = C.view(s, env(b, NOON(D)));
  assert.deepEqual(v.remainingIds, []); assert.equal(v.completed, true);
  assert.deepEqual(v.M.cardProgress, { done: 6, planned: 6 }); assert.equal(v.M.extraDone, false);
  assert.equal(C.endTitle(v), "今天的卡片都做完了");
});

function donePlan() {
  const b = bank(["s1"]); let s = C.blankState();
  s = run(s, b, NOON(D), op("answer", { cardId: "s1", ok: true }));
  assert.equal(C.view(s, env(b, NOON(D))).completed, true);
  return { b, s };
}
test("10 只開實驗室、沒完成不算加碼", () => {
  let { b, s } = donePlan();
  for (let i = 0; i < 2; i++) s = run(s, b, NOON(D), op("labStart", { runId: "m" + i, lab: "light", tasks: 3, answer: 1, from: "menu" }));
  const v = C.view(s, env(b, NOON(D)));
  assert.equal(v.M.extraDone, false); assert.equal(s.days[D].labRuns, 0);
});

test("11 預測前不能操作或觀察", () => {
  const b = bank(["s1"]); let s = C.blankState();
  s = run(s, b, NOON(D), op("labStart", { runId: "r1", lab: "shadow", tasks: 3, answer: 0, from: "menu" }));
  const before = JSON.stringify(s.labRuns.r1);
  for (const a of [op("labTask", { runId: "r1", task: 0 }), op("labComplete", { runId: "r1" })]) {
    const r = C.reduce(s, a, env(b, NOON(D)));
    assert.equal(r.error, "PREDICTION_REQUIRED"); assert.equal(r.state, s);
  }
  assert.equal(JSON.stringify(s.labRuns.r1), before);
  assert.equal(s.labRuns.r1.phase, "predict"); assert.equal(s.labRuns.r1.prediction, null);
});

test("12 真正完成實驗才算加碼，重送不重算", () => {
  let { b, s } = donePlan();
  s = run(s, b, NOON(D), op("labStart", { runId: "r1", lab: "shadow", tasks: 3, answer: 0, from: "menu" }));
  s = run(s, b, NOON(D), op("labPredict", { runId: "r1", choice: 2 }));
  [0, 1, 2].forEach((t) => { s = run(s, b, NOON(D), op("labTask", { runId: "r1", task: t })); });
  s = run(s, b, NOON(D), op("labComplete", { runId: "r1" }));
  s = C.reduce(s, op("labComplete", { runId: "r1" }), env(b, NOON(D))).state;
  assert.equal(s.labRuns.r1.phase, "complete"); assert.equal(s.labRuns.r1.predictionCorrect, false);
  assert.equal(s.days[D].labRuns, 1); assert.equal(C.view(s, env(b, NOON(D))).M.extraDone, true);
});

test("13 漏做的出口題持久待辦", () => {
  const b = bank(["s1"]); let s = C.blankState();
  s = run(s, b, NOON("2026-10-19"), op("answer", { cardId: "s1", ok: true }));
  s = JSON.parse(JSON.stringify(s));
  const v = C.view(s, env(b, NOON("2026-10-22")));
  assert.deepEqual([s.exits["1-1"].status, s.exits["1-1"].due], ["pending", "2026-10-20"]);
  assert.equal(v.M.exitPending, 1);
  assert.ok(C.exitList(s, env(b, NOON("2026-10-22"))).some((x) => x.cid === "1-1" && x.ready));
});

test("14 出口失敗只動已學卡，三類分流", () => {
  const b = bank(["s1", "s2", "s3", "s4", "s5"]); let s = C.blankState();
  s.cards.s1 = learned(2, ["2026-10-18"], "2026-10-25");
  s.cards.s3 = learned(2, ["2026-10-16"], "2026-10-18");
  s.cards.s4 = learned(2, ["2026-10-18"], "2026-10-20");
  s.cards.s5 = learned(5, ["2026-10-10", "2026-10-12", "2026-10-15"], null);
  s.exits["1-1"] = { status: "pending", due: "2026-10-19", opened: "2026-10-18", last: null };
  s = run(s, b, NOON(D), op("exit", { cid: "1-1", result: "fail" }));
  const dues = ["s1", "s2", "s3", "s4", "s5"].map((id) => C.cardState(s, id).due);
  assert.deepEqual(dues, ["2026-10-21", null, "2026-10-18", "2026-10-20", "2026-10-21"]);
  ["s1", "s3", "s4", "s5"].forEach((id) => assert.equal(s.cards[id].goodDays.length, 0));
  assert.equal(C.cardState(s, "s2").seen, 0);
  const dueToday = ["s1", "s2", "s3", "s4", "s5"].filter((id) => { const c = C.cardState(s, id); return c.seen > 0 && c.due && c.due <= D; });
  assert.deepEqual(dueToday, ["s3", "s4"]);
  // 隔天的計畫含未學 s2（仍是新卡）
  assert.ok(C.view(s, env(b, NOON("2026-10-21"))).planIds.includes("s2"));
});

test("15 出口失敗票保留到通過；通過不取消卡片複習", () => {
  const b = bank(["s1"]); let s = C.blankState();
  s.cards.s1 = learned(1, ["2026-10-19"], "2026-10-20");
  s.exits["1-1"] = { status: "pending", due: "2026-10-20", opened: "2026-10-19", last: null };
  s = run(s, b, NOON(D), op("exit", { cid: "1-1", result: "fail" }));
  assert.deepEqual([s.exits["1-1"].status, s.exits["1-1"].due, s.cards.s1.due], ["fail", "2026-10-21", "2026-10-20"]);
  s.cards.s1.due = "2026-10-21";   // 依規格前置狀態
  s = JSON.parse(JSON.stringify(s));
  assert.equal(C.view(s, env(b, NOON("2026-10-23"))).M.exitPending, 1);
  s = run(s, b, NOON("2026-10-23"), op("exit", { cid: "1-1", result: "pass" }));
  assert.deepEqual([s.exits["1-1"].status, s.exits["1-1"].due], ["pass", null]);
  assert.equal(C.view(s, env(b, NOON("2026-10-23"))).M.exitPending, 0);
  assert.equal(s.cards.s1.due, "2026-10-21");
  assert.equal(C.reduce(s, op("exit", { cid: "1-1", result: "fail" }), env(b, NOON("2026-10-23"))).error, "EXIT_CLOSED");
});

function midnight() {
  const b = bank(["s1", "s2", "s3"]); let s = C.blankState();
  s.cards.s3 = learned(1, ["2026-10-19"], "2026-10-20");
  s.days["2026-10-19"] = { planIds: ["s1", "s2"], doneIds: [], touched: [], extraDone: false, labRuns: 0, teach: 0, mood: null };
  s.session = { day: "2026-10-19", kind: "plan", queue: ["s1", "s2"], answered: [], wrong: [], kinds: {} };
  return { b, s };
}
test("16 跨午夜作答記到新日並重建當日任務", () => {
  let { b, s } = midnight();
  s = run(s, b, T("2026-10-20T00:00:01+08:00"), op("answer", { cardId: "s1", ok: true }));
  assert.equal(s.log[s.log.length - 1].d, "2026-10-20");
  const v = C.view(s, env(b, T("2026-10-20T00:00:02+08:00")));
  assert.deepEqual(v.planIds, ["s1", "s2", "s3"]); assert.deepEqual(v.doneIds, ["s1"]);
  assert.deepEqual(v.session.queue, ["s2", "s3"]);
  assert.deepEqual(s.days["2026-10-19"].doneIds, []);
});

test("17 跨午夜恢復畫面＝任務也換新", () => {
  let { b, s } = midnight();
  s = run(s, b, T("2026-10-20T08:00:00+08:00"), { type: "tick" });
  assert.equal(s.session.day, "2026-10-20");                 // 狀態本身要換新，不能只靠畫面重算
  assert.deepEqual(s.session.queue, ["s1", "s2", "s3"]);
  const v = C.view(s, env(b, T("2026-10-20T08:00:00+08:00")));
  assert.equal(v.session.day, "2026-10-20");
  assert.deepEqual(v.remainingIds, ["s1", "s2", "s3"]); assert.deepEqual(v.session.queue, ["s1", "s2", "s3"]);
  assert.deepEqual(v.doneIds, []); assert.equal(v.completed, false);
});

test("18 沒有雲端合併：store 不碰 window.claude", () => {
  const b = bank(["s1"]); let calls = 0;
  const g = global; g.window = { claude: { use: () => { calls++; return Promise.resolve(null); } } };
  const st = memStorage(); const store = C.createStore({ storage: st, bank: b, clock: () => NOON(D) });
  store.load();
  store.dispatch(op("answer", { cardId: "s1", ok: false }));
  store.dispatch(op("exit", { cid: "1-1", result: "fail" }));
  delete g.window;
  assert.equal(calls, 0); assert.equal(store.get().syncMode, "local");
  assert.equal(store.get().state.exits["1-1"].status, "fail");
  assert.equal(store.get().state.cards.s1.due, "2026-10-21");
  const src = require("fs").readFileSync(require("path").join(__dirname, "../src/core.js"), "utf8");
  assert.ok(!/claude\s*\.\s*use|\.doc\(|merge\(/.test(src));
});

test("19 嚴格 schema：型別錯不轉成假成功、不寫入", () => {
  const b = bank(["s1"]); let s = C.blankState();
  s = run(s, b, NOON(D), op("answer", { cardId: "s1", ok: true }));
  const good = JSON.stringify(s);
  assert.equal(C.decode(good, b).accepted, true);
  const muts = [(o) => { o.cards.s1.seen = "2"; }, (o) => { o.cards.s1.seen = 1.5; }, (o) => { o.settings.unit3 = "false"; },
                (o) => { o.log[0].ok = "false"; }, (o) => { o.cards.s1.due = "2026-02-30"; }];
  for (const m of muts) {
    const o = JSON.parse(good); m(o); const raw = JSON.stringify(o);
    const r = C.decode(raw, b);
    assert.deepEqual([r.accepted, r.error], [false, "SCHEMA"]);
    const st = memStorage({ "g5soc.v1": raw });
    const store = C.createStore({ storage: st, bank: b, clock: () => NOON(D) });
    store.load(); store.dispatch(op("answer", { cardId: "s1", ok: true }));
    assert.equal(st.writes(), 0); assert.equal(st.raw["g5soc.v1"], raw);
    assert.equal(store.get().saveStatus, "blocked");
  }
});

test("20 題卡匯入邊界", () => {
  const b = { cards: [card("s1")], concepts: CONCEPTS, figs: FIGS }; let s = C.blankState();
  const r = C.reduce(s, op("import", { cards: [card("s1", "1-1", { a: 1 }), card("x1"), card("x2", "1-1", { type: "figure", fig: "no-such" })] }), env(b, NOON(D)));
  assert.deepEqual(r.info.acceptedIds, ["x1"]); assert.deepEqual(r.info.rejectedIds, ["s1", "x2"]);
  assert.equal(C.cardById(r.state, b, "s1").a, 0);
  assert.deepEqual([C.cardState(r.state, "x1").seen, C.cardState(r.state, "x1").due], [0, null]);
});

test("21 溶解：秤值由帳本算，冷水 10 秒溶完", () => {
  let m = C.dissolveNew(); const reads = [C.dissolveRead(m).scaleMass];
  m = C.dissolveAddSugar(m, 0); reads.push(C.dissolveRead(m).scaleMass);
  for (let t = 0; t <= 10000; t += 16) m = C.dissolveStep(m, t);
  m = C.dissolveStep(m, 10000);
  const r = C.dissolveRead(m); reads.push(r.scaleMass);
  assert.deepEqual(reads, [210, 220, 220]);
  assert.deepEqual([r.sugarSolid, r.sugarDissolved], [0, 10]);
});

test("22 糖鹽同杯守恆，換一杯清水歸零", () => {
  let m = C.dissolveAddSugar(C.dissolveNew(), 0); m = C.dissolveStep(m, 10000);
  for (let i = 0; i < 6; i++) m = C.dissolveAddSalt(m);
  const r = C.dissolveRead(m);
  assert.deepEqual([r.sugarTotal, r.saltTotal, r.saltDissolved, r.saltSolid, r.scaleMass], [10, 36, 30, 6, 256]);
  assert.equal(C.dissolveRead(C.dissolveNew()).scaleMass, 210);
});

test("23 溶解速度與幀率、減少動態效果無關", () => {
  for (const fps of [30, 60, 120]) for (const reduced of [false, true]) {
    void reduced;   // 減少動態效果只關粒子動畫，不進帳本
    let m = C.dissolveAddSugar(C.dissolveNew(), 0);
    for (let k = 1; k * 1000 / fps <= 4000 + 1e-9; k++) m = C.dissolveStep(m, k * 1000 / fps);
    m = C.dissolveStep(m, 4000);
    const r = C.dissolveRead(m);
    assert.deepEqual([r.sugarSolid, r.sugarDissolved, r.scaleMass], [6, 4, 220], fps + "fps");
    for (const hot of [false, true]) {
      let n = C.dissolveAddSugar(Object.assign(C.dissolveNew(), { hot }), 0);
      for (let k = 1; k * 1000 / fps <= 12000; k++) n = C.dissolveStep(n, k * 1000 / fps);
      assert.ok(Math.abs(n.sugarDoneAt - (hot ? 5000 : 10000)) < 1e-6, fps + " hot=" + hot + " " + n.sugarDoneAt);
    }
  }
});

test("24 影子方位：太陽對面、長度＝竿高÷tan(高度角)", () => {
  const cases = [[90, 45, 270, 1], [270, 45, 90, 1], [180, 60, 0, 0.577350269]];
  for (const [az, alt, eaz, elen] of cases) {
    const s = C.shadowFromSun(az, alt, 1);
    assert.equal(s.az, eaz); assert.ok(Math.abs(s.len - elen) < 1e-6);
  }
  assert.deepEqual(C.shadowFromSun(100, -2, 1), { az: null, len: null });
  // 偏離設計者：太陽位置用 src/sun.js 真實公式（台中、今天），畫面註明約略計算；見 tests/sun.test.js
});

test("26 植物階段由狀態派生", () => {
  const b = bank(["s1", "s2"]); let s = C.blankState();
  s.cards.s1 = learned(3, ["2026-10-14", "2026-10-15", "2026-10-17"], null);
  s.cards.s2 = learned(3, ["2026-10-14", "2026-10-15", "2026-10-17"], null);
  s.exits["1-1"] = { status: "pass", due: null, opened: "2026-10-14", last: "2026-10-18" };
  assert.equal(C.view(s, env(b, NOON(D))).stages["1-1"], 4);
  s = run(s, b, NOON(D), op("answer", { cardId: "s1", ok: true, hint: true }));
  assert.equal(s.cards.s1.goodDays.length, 0);
  assert.equal(C.view(s, env(b, NOON(D))).stages["1-1"], 3);
  s = run(s, b, NOON(D), op("exitRetest", { cid: "1-1" }));
  s = run(s, b, NOON(D), op("exit", { cid: "1-1", result: "fail" }));
  assert.equal(s.exits["1-1"].status, "fail");
  assert.equal(C.view(s, env(b, NOON(D))).stages["1-1"], 2);
});

test("27 寫入失敗不宣告完成，恢復後重試只算一次", () => {
  const b = bank(["s1"]); const st = memStorage();
  const store = C.createStore({ storage: st, bank: b, clock: () => NOON(D) }); store.load();
  st.setFail(true);
  const r = store.dispatch({ type: "answer", id: "a1", cardId: "s1", ok: true });
  assert.equal(r.ok, false);
  assert.equal(C.cardState(store.get().state, "s1").seen, 0);
  assert.equal(store.view().completed, false);
  assert.deepEqual([store.get().saveStatus, store.get().pendingAction.id], ["failed", "a1"]);
  st.setFail(false); store.retry(); store.retry();
  assert.equal(store.get().state.cards.s1.seen, 1); assert.equal(store.view().completed, true);
  assert.equal(store.get().saveStatus, "ok");
});

test("28 舊資料遷移：不承認未證實畢業、保留 v1 原文", () => {
  const b = bank(["s1"]);
  const v1 = JSON.stringify({ v: 1, cards: { s1: { box: 3, streak: 3, due: "2026-10-25", seen: 8, right: 8, wrong: 0, retired: true } }, unit3: false, extra: [], prefs: { sound: true } });
  const st = memStorage({ "g5soc.none": v1 });
  const store = C.createStore({ storage: st, bank: b, clock: () => NOON(D) }); store.load();
  const s = store.get().state;
  assert.deepEqual(s.cards.s1, { seen: 8, goodDays: [], blockedDay: null, due: "2026-10-21", needsRecheck: true });
  assert.deepEqual([s.exits["1-1"].status, s.exits["1-1"].due], ["pending", "2026-10-21"]);
  assert.equal(st.raw["g5soc.none"], v1); assert.ok(st.raw["g5soc.v1"]);
  assert.equal(C.decode(st.raw["g5soc.v1"], b).accepted, true);
});

test("29 當日計畫不因匯入／重載變動，隔天才納入", () => {
  const b = bank(["s1"]); let s = C.blankState();
  s = run(s, b, NOON(D), op("answer", { cardId: "s1", ok: true }));
  s = run(s, b, NOON(D), op("import", { cards: [card("x1")] }));
  s = JSON.parse(JSON.stringify(s));
  let v = C.view(s, env(b, NOON(D)));
  assert.deepEqual(v.planIds, ["s1"]); assert.equal(v.completed, true);
  v = C.view(s, env(b, NOON("2026-10-21")));
  assert.ok(v.planIds.includes("x1")); assert.equal(C.cardState(s, "x1").seen, 0);
});

test("30 空計畫不能假完成", () => {
  const b = bank(["s1"]); let s = C.blankState();
  s.cards.s1 = learned(3, ["2026-10-14", "2026-10-15", "2026-10-17"], null);
  s = run(s, b, NOON(D), op("sessionStart", {}));
  const v = C.view(s, env(b, NOON(D)));
  assert.deepEqual(v.planIds, []); assert.equal(v.completed, false);
  assert.deepEqual(v.M, { cardProgress: { done: 0, planned: 0 }, exitPending: 0, extraDone: false });
  assert.equal(C.endTitle(v), "今天沒有排定卡片");
});

test("不變量：reducer 不改輸入、每個成功狀態都過 schema", () => {
  const b = bank(["s1", "s2"]); let s = C.blankState();
  const acts = [op("answer", { cardId: "s1", ok: false }), op("answer", { cardId: "s2", ok: true }), op("exit", { cid: "1-1", result: "fail" }),
                op("teach", { cardId: "s1" }), op("mood", { value: "good" }), op("settings", { unit3: true })];
  for (const a of acts) {
    const snap = JSON.stringify(s);
    const r = C.reduce(s, a, env(b, NOON(D)));
    assert.equal(JSON.stringify(s), snap);
    assert.deepEqual(C.checkState(r.state, b), []);
    s = r.state;
  }
});

test("10b 計畫完成前的實驗、教學、非計畫卡都不算加碼；完成後才算", () => {
  const b = bank(["s1", "s2"]); let s = C.blankState();
  s.cards.s2 = learned(1, ["2026-10-19"], "2026-10-25");          // s2 不在今天計畫
  s = run(s, b, NOON(D), op("teach", { cardId: "s1" }));
  s = run(s, b, NOON(D), op("labStart", { runId: "r1", lab: "light", tasks: 1, answer: 0, from: "menu" }));
  s = run(s, b, NOON(D), op("labPredict", { runId: "r1", choice: 0 }));
  s = run(s, b, NOON(D), op("labTask", { runId: "r1", task: 0 }));
  s = run(s, b, NOON(D), op("labComplete", { runId: "r1" }));
  s = run(s, b, NOON(D), op("answer", { cardId: "s2", ok: true }));
  assert.equal(C.view(s, env(b, NOON(D))).M.extraDone, false);
  s = run(s, b, NOON(D), op("answer", { cardId: "s1", ok: true }));
  assert.deepEqual([C.view(s, env(b, NOON(D))).completed, C.view(s, env(b, NOON(D))).M.extraDone], [true, false]);
  s = run(s, b, NOON(D), op("teach", { cardId: "s1" }));
  assert.equal(C.view(s, env(b, NOON(D))).M.extraDone, true);
});

test("13b 出口題當天建立、隔天才算待辦（隔天問才是延遲提取）", () => {
  const b = bank(["s1"]); let s = C.blankState();
  s = run(s, b, NOON(D), op("answer", { cardId: "s1", ok: true }));
  const v = C.view(s, env(b, NOON(D)));
  assert.deepEqual([v.M.exitPending, v.exitLater], [0, 1]);
  assert.equal(C.view(s, env(b, NOON("2026-10-21"))).M.exitPending, 1);
});

test("19b schema 其他欄位也嚴格", () => {
  const b = bank(["s1"]); let s = C.blankState();
  s = run(s, b, NOON(D), op("sessionStart", { size: 2 }));
  s = run(s, b, NOON(D), op("answer", { cardId: "s1", ok: true }));
  const good = JSON.stringify(s);
  const muts = [(o) => { o.session.size = -1; }, (o) => { o.exits["1-1"].status = "passed"; }, (o) => { o.exits["1-1"].due = null; },
                (o) => { o.days[D].doneIds.push("zz"); }, (o) => { o.cards.s1.goodDays = [D, D]; }, (o) => { o.days[D].extraDone = 0; }];
  for (const m of muts) { const o = JSON.parse(good); m(o); assert.equal(C.decode(JSON.stringify(o), b).accepted, false, m.toString()); }
});

/* ---------- 補救流程三分支（律師 2026-10-11 依 Codex 建議：概念不懂→有效協助→獨立驗證） ---------- */
test("R1 第一次求助＝第一種解釋（圖解＋觀察任務）；不動卡片掌握度", () => {
  const b = bank(["s1", "s2"]); let s = C.blankState();
  s.cards.s1 = learned(1, ["2026-10-19"], "2026-10-20");
  const before = JSON.stringify(s.cards);
  const r = C.reduce(s, op("help", { cid: "1-1", ways: 2 }), env(b, NOON(D)));
  assert.equal(r.info.way, 0); assert.equal(r.info.previous, null);
  assert.deepEqual(r.state.help["1-1"], { count: 1, last: D, way: 0, needsHelp: false });
  assert.equal(JSON.stringify(r.state.cards), before);
});

test("R2 同概念再次求助＝帶出前次紀錄、換另一種解釋", () => {
  const b = bank(["s1"]); let s = C.blankState();
  s = run(s, b, NOON("2026-10-18"), op("help", { cid: "1-1", ways: 2 }));
  const r = C.reduce(s, op("help", { cid: "1-1", ways: 2 }), env(b, NOON(D)));
  assert.deepEqual(r.info.previous, { last: "2026-10-18", way: 0 });
  assert.equal(r.info.way, 1);
  const r3 = C.reduce(r.state, op("help", { cid: "1-1", ways: 2 }), env(b, NOON(D)));
  assert.equal(r3.info.way, 0);   // 輪流，不會永遠卡在同一種說法
});

test("R3 補救後變式仍錯＝停止本輪、標待協助；下一輪把它排到最後", () => {
  const b = bank(["s1", "s2", "s3"]); let s = C.blankState();
  ["s1", "s2", "s3"].forEach((id) => { s.cards[id] = learned(1, [], "2026-10-20"); });
  s = run(s, b, NOON(D), op("sessionStart", {}));
  s = run(s, b, NOON(D), op("answer", { cardId: "s1", ok: false }));
  s = run(s, b, NOON(D), op("help", { cid: "1-1", ways: 2 }));
  s = run(s, b, NOON(D), op("labStart", { runId: "r1", lab: "shadow", tasks: 1, answer: 0, from: "wrong", card: "s1" }));
  s = run(s, b, NOON(D), op("labPredict", { runId: "r1", choice: 0 }));
  s = run(s, b, NOON(D), op("labTask", { runId: "r1", task: 0 }));
  s = run(s, b, NOON(D), op("labComplete", { runId: "r1", variationId: "s2" }));
  const r = C.reduce(s, op("answer", { cardId: "s2", ok: false }), env(b, NOON(D)));
  assert.equal(r.info.halted, true); s = r.state;
  assert.equal(s.session.halted, true); assert.equal(s.help["1-1"].needsHelp, true);
  const v = C.view(s, env(b, NOON(D)));
  assert.deepEqual(v.needsHelp, ["1-1"]); assert.equal(C.endTitle(v), "這一輪先停在這裡");
  const b2 = { cards: [card("s1"), card("s2"), card("s3"), card("t1", "1-2")], concepts: CONCEPTS, figs: FIGS };
  let s2 = JSON.parse(JSON.stringify(s));
  s2.days[D].planIds = ["s3", "t1"]; s2.days[D].doneIds = [];      // 夾具要合法：done ⊆ plan（Codex 第 1 輪 C3 指出）
  assert.deepEqual(C.checkState(s2, b2), []);
  s2 = run(s2, b2, NOON(D), op("sessionStart", {}));
  assert.deepEqual(s2.session.queue, ["t1", "s3"]);
  const f = C.reduce(s2, op("sessionStart", { focus: "1-1" }), env(b2, NOON(D)));
  assert.equal(f.info.focusBlocked, true);                            // 待協助優先於概念入口
  assert.deepEqual(f.state.session.queue, ["t1", "s3"]);
  const rv = C.reduce(s2, op("sessionStart", { kind: "review", ids: ["s3", "t1"] }), env(b2, NOON(D)));
  assert.deepEqual(rv.state.session.queue, ["t1", "s3"]);              // 小考複習也把卡住的觀念排最後
  s2 = run(s2, b2, NOON(D), op("helped", { cid: "1-1" }));
  assert.equal(s2.help["1-1"].needsHelp, false);
});

test("R4 普通題答錯不會停本輪；只有補救後的變式答錯才會", () => {
  const b = bank(["s1", "s2"]); let s = C.blankState();
  s = run(s, b, NOON(D), op("sessionStart", {}));
  const r = C.reduce(s, op("answer", { cardId: "s1", ok: false }), env(b, NOON(D)));
  assert.equal(r.info.halted, undefined); assert.equal(r.state.session.halted, undefined);
});

test("F1 概念入口：選的觀念先練，計畫與到期日不變", () => {
  const b = { cards: [card("s1"), card("t1", "1-2"), card("s2"), card("t2", "1-2")], concepts: CONCEPTS, figs: FIGS };
  let s = C.blankState();
  s = run(s, b, NOON(D), op("sessionStart", { focus: "1-2" }));
  assert.deepEqual(s.session.queue, ["t1", "t2", "s1", "s2"]);
  assert.deepEqual(s.days[D].planIds, ["s1", "t1", "s2", "t2"]);
  assert.deepEqual(C.checkState(s, b), []);
});

test("V1 小考複習回合：指定整個單元的題、作答照規則記分、不改當日計畫與完成判定", () => {
  const b = { cards: [card("s1"), card("s2"), card("t1", "1-2"), card("p1", "2-1")], concepts: Object.assign({ "2-1": { unit: "2" } }, CONCEPTS), figs: FIGS };
  let s = C.blankState();
  s.cards.s1 = learned(1, ["2026-10-19"], "2026-10-25");
  s = run(s, b, NOON(D), op("sessionStart", { kind: "review", ids: ["s1", "s2", "t1", "zz"] }));
  // 2026-10-11 律師問「每次複習都要從頭來一遍嗎」後改：沒練過的排在已經會的前面（見 V2）
  assert.deepEqual([s.session.kind, s.session.queue], ["review", ["s2", "t1", "s1"]]);
  const planBefore = s.days[D].planIds.slice();
  s = run(s, b, NOON(D), op("answer", { cardId: "s1", ok: true }));
  assert.deepEqual(s.cards.s1.goodDays, ["2026-10-19", D]);          // 第一次答對照樣算有效日
  assert.equal(s.cards.s1.due, null);   // 2026-10-18（#2696）：第 2 個答對日就學會，不再排到期日
  assert.deepEqual(s.days[D].planIds, planBefore);
  assert.deepEqual(C.checkState(s, b), []);
  const v = C.view(s, env(b, NOON(D)));
  assert.equal(v.session.queue.length, 2);
});

/* ---------- Codex 第 1 輪（設計後）缺測補齊：真的經 store 重載、儲存層各分支 ---------- */
function mkStore(storage, b, clockRef) { const st = C.createStore({ storage, bank: b, clock: () => clockRef.t }); st.load(); return st; }

test("09R 短回合後真的重載（新 store 讀同一份儲存）再接續", () => {
  const b = bank(["s1", "s2", "s3", "s4", "s5", "s23"]); const mem = memStorage(); const clk = { t: NOON(D) };
  let st = mkStore(mem, b, clk);
  st.dispatch(op("sessionStart", { size: 3 }));
  ["s1", "s2", "s3"].forEach((id) => st.dispatch(op("answer", { cardId: id, ok: true })));
  st = mkStore(mem, b, clk);                                         // 重載
  assert.equal(st.get().loadError, null);
  st.dispatch(op("sessionStart", {}));
  assert.deepEqual(st.get().state.session.queue, ["s4", "s5"]);      // 計畫只有 5 張新卡（10/20 起每日 5 張）
  ["s4", "s5"].forEach((id) => st.dispatch(op("answer", { cardId: id, ok: true })));
  const v = st.view();
  assert.deepEqual([v.completed, v.M.extraDone, v.M.cardProgress.planned], [true, false, 5]);
});

test("13R／15R 出口題票真的寫進儲存、隔幾天重載還在，通過才關閉", () => {
  const b = bank(["s1"]); const mem = memStorage(); const clk = { t: NOON("2026-10-19") };
  let st = mkStore(mem, b, clk);
  st.dispatch(op("answer", { cardId: "s1", ok: true }));
  clk.t = NOON("2026-10-22"); st = mkStore(mem, b, clk);
  assert.equal(st.view().M.exitPending, 1);
  st.dispatch(op("exit", { cid: "1-1", result: "fail" }));
  clk.t = NOON("2026-10-24"); st = mkStore(mem, b, clk);
  assert.deepEqual([st.get().state.exits["1-1"].status, st.view().M.exitPending], ["fail", 1]);
  st.dispatch(op("exit", { cid: "1-1", result: "pass" }));
  st = mkStore(mem, b, clk);
  assert.equal(st.view().M.exitPending, 0);
});

test("29R 匯入後真的重載，當天計畫不變、隔天才納入", () => {
  const b = bank(["s1"]); const mem = memStorage(); const clk = { t: NOON(D) };
  let st = mkStore(mem, b, clk);
  st.dispatch(op("answer", { cardId: "s1", ok: true }));
  st.dispatch(op("import", { cards: [card("x1")] }));
  st = mkStore(mem, b, clk);
  assert.deepEqual(st.view().planIds, ["s1"]);
  clk.t = NOON("2026-10-21"); st = mkStore(mem, b, clk);
  assert.ok(st.view().planIds.includes("x1"));
});

test("12b 觀察階段任務沒做完不能完成實驗", () => {
  const b = bank(["s1"]); let s = C.blankState();
  s = run(s, b, NOON(D), op("labStart", { runId: "r1", lab: "shadow", tasks: 3, answer: 0, from: "menu" }));
  s = run(s, b, NOON(D), op("labPredict", { runId: "r1", choice: 0 }));
  s = run(s, b, NOON(D), op("labTask", { runId: "r1", task: 0 }));
  const r = C.reduce(s, op("labComplete", { runId: "r1" }), env(b, NOON(D)));
  assert.equal(r.error, "TASKS_LEFT"); assert.equal(r.state, s);
});

test("18b 啟動前已有出口失敗與 window.claude 舊進度：不呼叫雲端、不改本機狀態", () => {
  const b = bank(["s1"]); let s = C.blankState();
  s = run(s, b, NOON(D), op("answer", { cardId: "s1", ok: true }));
  s = run(s, b, NOON(D), op("exit", { cid: "1-1", result: "fail" }));
  const mem = memStorage({ "g5soc.v1": JSON.stringify(s) }); let calls = 0;
  global.window = { claude: { use: () => { calls++; return Promise.resolve({ doc: () => ({ get: () => Promise.resolve({ exists: true, data: () => ({ v: 1, cards: {} }) }) }) }); } } };
  const st = mkStore(mem, b, { t: NOON("2026-10-21") });
  st.dispatch({ type: "tick" });
  delete global.window;
  assert.equal(calls, 0);
  assert.deepEqual([st.get().state.exits["1-1"].status, st.get().state.cards.s1.due], ["fail", "2026-10-21"]);
});

test("27b 存檔失敗後切回頁面（tick）：先補寫待重試的答案，不會被沖掉；畫面以操作 ID 判斷", () => {
  const b = bank(["s1"]); const mem = memStorage(); const clk = { t: NOON(D) };
  const st = mkStore(mem, b, clk);
  mem.setFail(true);
  assert.equal(st.dispatch({ type: "answer", id: "a1", cardId: "s1", ok: true }).ok, false);
  const t1 = st.dispatch({ type: "tick" });                           // 還寫不進去：tick 也不接受，a1 仍待重試
  assert.equal(t1.ok, false); assert.equal(st.get().pendingAction.id, "a1"); assert.equal(st.accepted("a1"), false);
  mem.setFail(false);
  assert.equal(st.dispatch({ type: "tick" }).ok, true);               // 恢復後 tick 先補寫 a1
  assert.equal(st.get().pendingAction, null); assert.equal(st.accepted("a1"), true);
  assert.equal(st.get().state.cards.s1.seen, 1);
  assert.equal(st.retry().nothing, true);                             // 沒有待重試的了
  assert.equal(st.get().state.cards.s1.seen, 1);                      // 只算一次
});

test("27c 讀不到存檔（getItem 丟錯）：封鎖寫入，不拿空白蓋掉", () => {
  const b = bank(["s1"]); let writes = 0;
  const bad = { getItem: () => { throw new Error("SecurityError"); }, setItem: () => { writes++; } };
  const st = C.createStore({ storage: bad, bank: b, clock: () => NOON(D) }); st.load();
  assert.equal(st.get().loadError, "READ");
  st.dispatch(op("answer", { cardId: "s1", ok: true }));
  assert.equal(writes, 0); assert.equal(st.get().state.cards.s1, undefined);
});

test("28b 舊資料搬不進去（寫入失敗）：不公布、封鎖寫入、v1 原文不動", () => {
  const b = bank(["s1"]);
  const v1 = JSON.stringify({ v: 1, cards: { s1: { box: 1, streak: 1, due: "2026-10-21", seen: 2, right: 2, wrong: 0, retired: false } } });
  const mem = memStorage({ "g5soc.none": v1 }); mem.setFail(true);
  const st = mkStore(mem, b, { t: NOON(D) });
  assert.equal(st.get().loadError, "MIGRATE"); assert.equal(st.get().migrated, false);
  assert.equal(st.get().state.cards.s1, undefined);
  assert.equal(mem.raw["g5soc.none"], v1); assert.equal(mem.raw["g5soc.v1"], undefined);
});

test("19c schema 拒絕重複集合（假進度 2/1）與重複佇列", () => {
  const b = bank(["s1", "s2"]); let s = C.blankState();
  s = run(s, b, NOON(D), op("sessionStart", {}));
  s = run(s, b, NOON(D), op("answer", { cardId: "s1", ok: true }));
  const good = JSON.stringify(s);
  for (const m of [(o) => { o.days[D].doneIds.push("s1"); }, (o) => { o.days[D].planIds.push("s2"); }, (o) => { o.session.queue.push("s2"); }, (o) => { o.ops.push(o.ops[0]); }]) {
    const o = JSON.parse(good); m(o); assert.equal(C.decode(JSON.stringify(o), b).accepted, false, m.toString());
  }
});

test("Q1 每日新卡額度：10/18 前診斷期最多 10 張，之後 5 張（社會站預計 10/14 起用，診斷期 10/14–10/17）（刻意偏離規格的 5 張，理由：先把教過的卡各做一遍）", () => {
  const ids = Array.from({ length: 14 }, (_, i) => "c" + i); const b = bank(ids);
  assert.equal(C.view(C.blankState(), env(b, NOON("2026-10-14"))).planIds.length, 10);
  assert.equal(C.view(C.blankState(), env(b, NOON("2026-10-17"))).planIds.length, 10);
  assert.equal(C.view(C.blankState(), env(b, NOON("2026-10-18"))).planIds.length, 5);
});

/* ---------- Codex 第 2 輪（設計後）缺陷的回歸測試 ---------- */
test("D1 store：A 待重試時送 B 被拒（SAVE_PENDING），恢復後 A 先寫、B 再送才成功，不會丟 B", () => {
  const b = bank(["s1", "s2"]); const mem = memStorage(); const st = mkStore(mem, b, { t: NOON(D) });
  mem.setFail(true);
  st.dispatch({ type: "answer", id: "A", cardId: "s1", ok: true });
  mem.setFail(false);
  mem.setFail(true);
  const rb = st.dispatch({ type: "answer", id: "B", cardId: "s2", ok: true });
  assert.deepEqual([rb.ok, rb.error, st.get().pendingAction.id], [false, "SAVE_PENDING", "A"]);
  mem.setFail(false);
  assert.equal(st.dispatch({ type: "answer", id: "B", cardId: "s2", ok: true }).ok, true);
  assert.deepEqual([st.accepted("A"), st.accepted("B")], [true, true]);
});

test("D2 舊資料是壞的（無法解析的 v1）：封鎖、不建立 v3；家長按略過才從頭開始，v1 原文不動", () => {
  const b = bank(["s1"]); const mem = memStorage({ "g5soc.none": "{" });
  const st = mkStore(mem, b, { t: NOON(D) });
  assert.equal(st.get().loadError, "MIGRATE");
  st.dispatch({ type: "tick" });
  assert.equal(mem.raw["g5soc.v1"], undefined);
  assert.equal(st.discardBroken(), true);
  assert.ok(mem.raw["g5soc.v1"]); assert.equal(mem.raw["g5soc.none"], "{");
});

test("D3 題卡 id：匯入題自己重複 → schema 拒絕；與內建題同 id → 以內建題為準，不卡住操作", () => {
  const b = bank(["s1"]); let s = C.blankState();
  const dupSelf = JSON.parse(JSON.stringify(s)); dupSelf.extra = [card("x1"), card("x1")];
  assert.equal(C.decode(JSON.stringify(dupSelf), b).accepted, false);
  const clash = JSON.parse(JSON.stringify(s)); clash.extra = [card("s1", "1-1", { q: "匯入的同名題" })];
  assert.equal(C.decode(JSON.stringify(clash), b).accepted, true);
  const mem = memStorage({ "g5soc.v1": JSON.stringify(clash) }); const st = mkStore(mem, b, { t: NOON(D) });
  assert.equal(st.dispatch(op("sessionStart", {})).ok, true);
  assert.deepEqual(st.get().state.days[D].planIds, ["s1"]);
  assert.equal(C.cardById(st.get().state, b, "s1").q, "題目 s1");
});

test("M11（Codex 第 3 輪規格核對）：三卡題庫＋同 id 匯入題 → 計畫照常排三張新卡，s1 只出現一次且是內建版", () => {
  const b = bank(["s1", "s2", "s3"]);
  const clash = C.blankState(); clash.extra = [card("s1", "1-1", { q: "匯入的同名題" })];
  const mem = memStorage({ "g5soc.v1": JSON.stringify(clash) }); const st = mkStore(mem, b, { t: NOON(D) });
  assert.equal(st.dispatch(op("sessionStart", {})).ok, true);
  const plan = st.get().state.days[D].planIds;
  assert.deepEqual(plan.slice().sort(), ["s1", "s2", "s3"]);
  assert.equal(plan.filter((id) => id === "s1").length, 1);
  assert.equal(C.allCards(st.get().state, b).filter((c) => c.id === "s1").length, 1);
  assert.equal(C.cardById(st.get().state, b, "s1").q, "題目 s1");
});

test("D4 題庫改版後消失的卡：從計畫與回合剔除，不假完成、不留永遠做不完的計畫", () => {
  const b = bank(["s1"]); let s = C.blankState();
  s.days[D] = { planIds: ["gone", "s1"], doneIds: [], touched: [], extraDone: false, labRuns: 0, teach: 0, mood: null };
  s.session = { day: D, kind: "plan", queue: ["gone", "s1"], answered: [], wrong: [], kinds: {} };
  // 2026-10-18 改（Codex 設計者 T23 vs 本條 D4 的折衷）：計畫存檔不刪查不到的題（保留引用、列為 missingIds），回合待答照舊拿掉；
  //   畫面的「還要做」與「完成」只看查得到的題，所以不會留下永遠做不完的計畫（本條原意）
  let v = C.view(s, env(b, NOON(D)));
  assert.deepEqual([v.planIds, v.session.queue, v.remainingIds, v.missingIds], [["gone", "s1"], ["s1"], ["s1"], ["gone"]]);
  s = run(s, b, NOON(D), op("answer", { cardId: "s1", ok: true }));
  assert.deepEqual([s.days[D].planIds, s.session.queue], [["gone", "s1"], []]);
  v = C.view(s, env(b, NOON(D)));
  assert.deepEqual([v.remainingIds, v.completed, v.missingIds], [[], true, ["gone"]]);
});

test("D10 schema：實驗任務 tasksDone 重複要拒絕", () => {
  const b = bank(["s1"]); let s = C.blankState();
  s = run(s, b, NOON(D), op("labStart", { runId: "r1", lab: "shadow", tasks: 3, answer: 0, from: "menu" }));
  s = run(s, b, NOON(D), op("labPredict", { runId: "r1", choice: 0 }));
  s = run(s, b, NOON(D), op("labTask", { runId: "r1", task: 0 }));
  const o = JSON.parse(JSON.stringify(s)); o.labRuns.r1.tasksDone.push(0);
  assert.equal(C.decode(JSON.stringify(o), b).accepted, false);
});

// ---------- 小考複習分段（2026-10-11 律師：「每次複習都要從頭來一遍嗎？」「當天時間夠，想要全部做完，可以嗎？」） ----------
const B6 = () => ({ cards: [card("a1"), card("a2"), card("a3"), card("b1", "1-2"), card("b2", "1-2"), card("b3", "1-2")], concepts: CONCEPTS, figs: FIGS });
const ALL6 = ["a1", "a2", "a3", "b1", "b2", "b3"];

test("V2 小考複習排序：答錯過的 → 沒練過的 → 已經會的（最久沒練的先）；同一層觀念交錯；size 只取前 N 題", () => {
  const b = B6(); let s = C.blankState();
  s = run(s, b, NOON("2026-10-15"), op("answer", { cardId: "b1", ok: true }));
  s = run(s, b, NOON("2026-10-18"), op("answer", { cardId: "a1", ok: true }));
  s = run(s, b, NOON("2026-10-19"), op("answer", { cardId: "a1", ok: true }));
  s = run(s, b, NOON("2026-10-19"), op("answer", { cardId: "a2", ok: false }));
  const full = run(s, b, NOON(D), op("sessionStart", { kind: "review", ids: ALL6 }));
  assert.deepEqual(full.session.queue, ["a2", "a3", "b2", "b3", "b1", "a1"]);
  const seg = run(s, b, NOON(D), op("sessionStart", { kind: "review", ids: ALL6, size: 4 }));
  assert.deepEqual(seg.session.queue, ["a2", "a3", "b2", "b3"]);
  assert.deepEqual(seg.days[D].planIds, full.days[D].planIds);     // 分段不改當日計畫
  assert.deepEqual(C.checkState(seg, b), []);
});

test("V3 不用每次從頭：隔天再按同一個單元，接著練還沒練過的", () => {
  const b = B6(); let s = C.blankState();
  s = run(s, b, NOON("2026-10-19"), op("sessionStart", { kind: "review", ids: ALL6, size: 3 }));
  const first = s.session.queue.slice();
  assert.deepEqual(first, ["a1", "b1", "a2"]);
  first.forEach((id, i) => { s = run(s, b, NOON("2026-10-19"), op("answer", { cardId: id, ok: i !== 1 })); });   // b1 答錯
  s = run(s, b, NOON(D), op("sessionStart", { kind: "review", ids: ALL6, size: 3 }));
  assert.deepEqual(s.session.queue, ["b1", "a3", "b2"]);                 // 答錯的先，其次沒練過的（觀念交錯）；昨天答對的 a1、a2 不重來
});

test("V4 當天時間夠想全部做完：同一天連續按「再練一段」，每一段都接著沒練過的，做完全部；不給 size 就一次排全部", () => {
  const b = B6(); let s = C.blankState(); const done = new Set();
  for (let k = 0; k < 3; k++) {
    s = run(s, b, NOON(D), op("sessionStart", { kind: "review", ids: ALL6, size: 2 }));
    const q = s.session.queue.slice();
    assert.equal(q.filter((id) => done.has(id)).length, 0, "第 " + (k + 1) + " 段不該重複已經答對的題");
    q.forEach((id) => { s = run(s, b, NOON(D), op("answer", { cardId: id, ok: true })); done.add(id); });
  }
  assert.equal(done.size, 6);
  const all = run(C.blankState(), b, NOON(D), op("sessionStart", { kind: "review", ids: ALL6 }));
  assert.equal(all.session.queue.length, 6);
});

test("V5 卡住（待協助）的觀念在小考複習排最後，一段 20 題取不到它；size 不合法（0、負數、小數）就當作全部", () => {
  const b = B6(); let s = C.blankState();
  s.help["1-1"] = { count: 2, last: "2026-10-19", way: 1, needsHelp: true };
  s = run(s, b, NOON(D), op("sessionStart", { kind: "review", ids: ALL6, size: 3 }));
  assert.deepEqual(s.session.queue, ["b1", "b2", "b3"]);
  [0, -2, 1.5, "3"].forEach((bad) => {
    const r = run(s, b, NOON(D), op("sessionStart", { kind: "review", ids: ALL6, size: bad }));
    assert.equal(r.session.queue.length, 6, "size=" + bad);
  });
});

/* ---------- 4agent 必修（run 4B-20261011-g5app；交辦 #1182 自修 session 接手）---------- */
test("R9 停輪標題優先：halted 不得被「今天都做完了」或「沒有排定卡片」蓋掉（M22）", () => {
  const se = { halted: true, queue: ["s3"], answered: ["s1", "s2"], wrong: ["s2"] };
  assert.equal(C.endTitle({ planIds: ["s1"], completed: true, session: se }), "這一輪先停在這裡");
  assert.equal(C.endTitle({ planIds: [], completed: false, session: se }), "這一輪先停在這裡");
  assert.equal(C.endTitle({ planIds: ["s1"], completed: true, session: Object.assign({}, se, { halted: false }) }), "今天的卡片都做完了");
});

test("R5/R8 v1 結構不合法：封鎖、BAD_V1、不寫 v3、v1 原文不動（D2-c／M08）", () => {
  const b = bank(["s1"]);
  for (const raw of ['{"v":1,"cards":[]}', '{"v":1}', '{"v":1,"cards":{"s1":{"seen":"2"}}}', '{"v":1,"cards":{},"extra":{}}', '{"v":1,"cards":{},"unit3":"yes"}']) {
    const mem = memStorage({ "g5soc.none": raw }); const st = mkStore(mem, b, { t: NOON(D) });
    assert.equal(st.get().loadError, "MIGRATE", raw); assert.equal(st.get().migrateReason, "BAD_V1", raw);
    const r = st.dispatch({ type: "tick" });
    assert.equal(r.error, "SAVE_BLOCKED", raw); assert.equal(mem.writes(), 0, raw);
    assert.equal(mem.raw["g5soc.v1"], undefined, raw); assert.equal(mem.raw["g5soc.none"], raw, raw);
  }
});

test("R5/R8 v1 失敗原因分開記：解析失敗 PARSE、版本不支援 VERSION、寫不進去 WRITE（D2-a／D2-b／M10；殺突變 N8）", () => {
  const b = bank(["s1"]);
  for (const [raw, why] of [["{", "PARSE"], ['{"v":2,"cards":{}}', "VERSION"]]) {
    const mem = memStorage({ "g5soc.none": raw }); const st = mkStore(mem, b, { t: NOON(D) });
    assert.deepEqual([st.get().loadError, st.get().migrateReason, mem.writes()], ["MIGRATE", why, 0], raw);
    assert.equal(mem.raw["g5soc.none"], raw);
  }
  const v1 = JSON.stringify({ v: 1, cards: { s1: { seen: 2, due: "2026-10-21" } } });
  const mem = memStorage({ "g5soc.none": v1 }); mem.setFail(true);
  const st = mkStore(mem, b, { t: NOON(D) });
  assert.deepEqual([st.get().loadError, st.get().migrateReason], ["MIGRATE", "WRITE"]);
});

function dayRec(plan, done, touched) { return { planIds: plan, doneIds: done, touched: touched || done.slice(), extraDone: false, labRuns: 0, teach: 0, mood: null }; }

// 2026-10-18 改期望（Codex 審 g5-math-review 3751016）：已做完的消失卡是歷史，計畫與已完成兩邊一起留（不變量 done⊂plan 照樣成立、突變 N3 照樣抓到）；
//   原本兩邊一起剔掉，題庫裁題當天「今天已完成」會倒退、補做被鎖。還沒做的消失卡照舊從計畫拿掉。
test("R4 D4-b 消失卡：計畫存檔一律不刪；還要做只算查得到的、查不到又沒做的列為 missingIds（殺突變 N3）", () => {
  const b = bank(["s1", "s2"]); const s = C.blankState();
  s.days[D] = dayRec(["gone", "gone2", "s1"], ["gone"]);
  const v = C.view(s, env(b, NOON(D)));
  assert.deepEqual([v.planIds, v.doneIds, v.remainingIds, v.missingIds], [["gone", "gone2", "s1"], ["gone"], ["s1"], ["gone2"]]);
  assert.ok(v.doneIds.every((id) => v.planIds.includes(id)), "已完成⊂計畫");
  assert.equal(v.completed, false);
  assert.deepEqual(s.days[D].doneIds, ["gone"], "view 不得改到輸入");
});

// 2026-10-18 改期望（同上）：這一輪已答／答錯是歷史，照留（補做結算靠 answered；再練答錯的在 sessionStart 會略過不存在的卡）；待答的照舊拿掉
test("R4 D4-c 消失卡：session 待答拿掉，已答／答錯照留", () => {
  const b = bank(["s1", "s2"]); const s = C.blankState();
  s.cards.s2 = learned(1, [D], "2026-10-21");
  s.days[D] = dayRec(["s1", "s2"], ["s2"], ["s2"]);
  s.session = { day: D, kind: "plan", queue: ["gone", "s1"], answered: ["gone", "s2"], wrong: ["gone", "s2"], kinds: {} };
  const v = C.view(s, env(b, NOON(D)));
  assert.deepEqual([v.session.queue, v.session.answered, v.session.wrong], [["s1"], ["gone", "s2"], ["gone", "s2"]]);
  assert.equal(v.completed, false);
});

test("R5/R8 合法 v1 照常搬（D2-d）：只寫一次、migrateReason=null", () => {
  const b = bank(["s1"]);
  const v1 = '{"v":1,"cards":{"s1":{"seen":8,"due":"2026-10-25"}}}';
  const mem = memStorage({ "g5soc.none": v1 }); const st = mkStore(mem, b, { t: NOON(D) });
  assert.deepEqual([st.get().loadError, st.get().migrateReason, mem.writes()], [null, null, 1]);
  assert.deepEqual(st.get().state.cards.s1, { seen: 8, goodDays: [], blockedDay: null, due: "2026-10-21", needsRecheck: true });
  assert.equal(mem.raw["g5soc.none"], v1);
});

// ---- Codex 審 e6c7ed6 的核心 FAIL 項（報告 ~/scripts/state/codex_commit_reviews/g5-math-review-e6c7ed67-*）----
test("M1 兩個分頁：A 存了作答，B 隨後 tick 不得用舊的記憶體狀態蓋掉", () => {
  const b = bank(["s1", "s2"]); const mem = memStorage();
  const A = C.createStore({ storage: mem, bank: b, clock: () => NOON(D) }); A.load();
  const B = C.createStore({ storage: mem, bank: b, clock: () => NOON(D) }); B.load();
  assert.ok(A.dispatch(op("answer", { cardId: "s1", ok: true })).ok);
  assert.ok(B.dispatch({ type: "tick" }).ok);
  assert.deepEqual(Object.keys(JSON.parse(mem.raw["g5soc.v1"]).cards), ["s1"], "A 的作答被 B 蓋掉了");
  assert.ok(B.dispatch(op("answer", { cardId: "s2", ok: true })).ok);
  assert.deepEqual(Object.keys(JSON.parse(mem.raw["g5soc.v1"]).cards).sort(), ["s1", "s2"]);
  assert.deepEqual(Object.keys(B.get().state.cards).sort(), ["s1", "s2"], "B 畫面用的狀態也要換成最新的");
});

test("M2 預設每日計畫：每天做完排定的題目、全答對，考前一天以前每張卡都至少練過一次", () => {
  const MB = require("../src/socbank.js");   // 社會站：用真的社會題庫跑
  [false, true].forEach((u3) => {
    const real = { cards: MB.CARDS, concepts: {}, figs: {} };
    Object.keys(MB.CONCEPTS).forEach((k) => { real.concepts[k] = { unit: MB.CONCEPTS[k].unit }; });
    let s = C.blankState(); s.settings.unit3 = u3;
    for (let d = "2026-10-14"; d < C.EXAM; d = C.addDays(d, 1)) {
      s = run(s, real, NOON(d), op("tick"));
      s.days[d].planIds.forEach((id) => { s = run(s, real, NOON(d), op("answer", { cardId: id, ok: true })); });
    }
    const want = MB.CARDS.filter((c) => u3 || MB.CONCEPTS[c.concept].unit !== "3");
    const miss = want.filter((c) => !(s.cards[c.id] && s.cards[c.id].seen > 0)).map((c) => c.id);
    assert.deepEqual(miss, [], "unit3=" + u3 + " 考前沒排到：" + miss.join(","));
  });
});

test("M3 新使用者第一題答錯、做完補救：換一題確認必須真的是同觀念的另一題（答錯就停輪、標待協助）", () => {
  const b = bank(["s1", "s2", "s3"]); let s = C.blankState();
  s = run(s, b, NOON(D), op("sessionStart", {}));
  s = run(s, b, NOON(D), op("answer", { cardId: "s1", ok: false }));
  s = run(s, b, NOON(D), op("labStart", { runId: "r9", lab: "x", tasks: 1, answer: 0, from: "wrong", card: "s1" }));
  s = run(s, b, NOON(D), op("labPredict", { runId: "r9", choice: 0 }));
  s = run(s, b, NOON(D), op("labTask", { runId: "r9", task: 0 }));
  s = run(s, b, NOON(D), op("labComplete", { runId: "r9" }));
  const v = s.session.queue[0];
  assert.ok(v && v !== "s1", "要換一題");
  assert.equal(s.session.kinds[v], "variation", "換的那一題要標成確認題");
  const r = C.reduce(s, op("answer", { cardId: v, ok: false }), env(b, NOON(D)));
  assert.equal(r.info.halted, true); assert.equal(r.state.help["1-1"].needsHelp, true);
});


// Codex 審 2e70601（自然站多分頁修正）：①讀取失敗時不可蓋掉既有的待存操作（我上一版引入的回歸）②外部清空存檔後不可把舊紀錄寫回去
function flakyStorage() {
  const m = {}; let readFail = false, writeFail = false;
  return { getItem: (k) => { if (readFail) throw new Error("read"); return k in m ? m[k] : null; },
           setItem: (k, v) => { if (writeFail) throw new Error("QuotaExceeded"); m[k] = v; }, removeItem: (k) => { delete m[k]; },
           setRead: (f) => { readFail = f; }, setWrite: (f) => { writeFail = f; }, raw: m };
}
test("M4 已有待存操作 A，讀取又失敗時送出 B：回 SAVE_PENDING、待存仍是 A；恢復後重試 A 成功、再送 B 成功", () => {
  const b = bank(["s1", "s2"]); const mem = flakyStorage();
  const S = C.createStore({ storage: mem, bank: b, clock: () => NOON(D) }); S.load();
  const A = op("answer", { cardId: "s1", ok: true }), B = op("answer", { cardId: "s2", ok: true });
  mem.setWrite(true); assert.equal(S.dispatch(A).ok, false); mem.setWrite(false);
  mem.setRead(true);
  const r = S.dispatch(B);
  assert.equal(r.error, "SAVE_PENDING"); assert.equal(S.get().pendingAction.id, A.id);
  mem.setRead(false);
  assert.ok(S.retry().ok); assert.ok(S.accepted(A.id));
  assert.ok(S.dispatch(B).ok); assert.ok(S.accepted(B.id));
});
test("M5 別處把存檔整個刪掉後，這個分頁不得把舊紀錄寫回去", () => {
  const b = bank(["s1"]); const mem = flakyStorage();
  const S = C.createStore({ storage: mem, bank: b, clock: () => NOON(D) }); S.load();
  assert.ok(S.dispatch(op("answer", { cardId: "s1", ok: true })).ok);
  mem.removeItem(C.LS_KEY);
  // 磁碟上沒有存檔＝空白紀錄（Codex 審 8362c82／fd585e3：上一版改成一律拒寫，連「清除」與「再存一次」都卡死）
  assert.ok(S.dispatch({ type: "tick" }).ok);
  assert.deepEqual(Object.keys(JSON.parse(mem.raw[C.LS_KEY]).cards), [], "舊紀錄復活了");
});

test("M6 存檔被刪掉後：再作答只存新的、清除全部紀錄可以成功、待存操作可以重試成功", () => {
  const b = bank(["s1", "s2"]); const mem = flakyStorage();
  const S = C.createStore({ storage: mem, bank: b, clock: () => NOON(D) }); S.load();
  assert.ok(S.dispatch(op("answer", { cardId: "s1", ok: true })).ok);
  mem.removeItem(C.LS_KEY);
  mem.setWrite(true); const A = op("answer", { cardId: "s2", ok: true });
  assert.equal(S.dispatch(A).ok, false); mem.setWrite(false);
  assert.ok(S.retry().ok, "恢復後重試要成功");
  assert.deepEqual(Object.keys(JSON.parse(mem.raw[C.LS_KEY]).cards), ["s2"], "只留新的作答");
  assert.ok(S.dispatch(op("reset")).ok, "清除全部作答紀錄要成功");
  assert.deepEqual(Object.keys(JSON.parse(mem.raw[C.LS_KEY]).cards), []);
});

test("M7 待存的是一輪實驗的一步、那一輪又被別處刪掉：重試回 NO_RUN 並丟掉待存、狀態回 ok，不會卡在「再存一次」（Codex 審 e195ef98 第 3 項）", () => {
  const b = bank(["s1"]); const mem = flakyStorage();
  const S = C.createStore({ storage: mem, bank: b, clock: () => NOON(D) }); S.load();
  assert.ok(S.dispatch(op("labStart", { runId: "R", lab: "soc", tasks: 3, answer: 0 })).ok);
  assert.ok(S.dispatch(op("labPredict", { runId: "R", choice: 0 })).ok);
  mem.setWrite(true); const T1 = op("labTask", { runId: "R", task: 0 });
  assert.equal(S.dispatch(T1).ok, false); mem.setWrite(false);
  assert.deepEqual([S.get().saveStatus, S.get().pendingAction.id], ["failed", T1.id]);
  mem.removeItem(C.LS_KEY);
  const r = S.retry();
  assert.deepEqual([r.ok, r.error], [false, "NO_RUN"]);
  assert.deepEqual([S.get().pendingAction, S.get().saveStatus], [null, "ok"], "套不上的待存要丟掉、提示列要消失");
  assert.equal(S.retry().nothing, true, "再按一次不會又重試同一筆");
  assert.equal(mem.raw[C.LS_KEY], undefined, "不得把刪掉的那一輪寫回去");
  // 讀不到存檔（不是刪掉）時照舊：留著待存、狀態維持 failed
  assert.ok(S.dispatch(op("labStart", { runId: "R2", lab: "soc", tasks: 3, answer: 0 })).ok);
  assert.ok(S.dispatch(op("labPredict", { runId: "R2", choice: 0 })).ok);
  mem.setWrite(true); const T2 = op("labTask", { runId: "R2", task: 0 });
  assert.equal(S.dispatch(T2).ok, false); mem.setWrite(false); mem.setRead(true);
  assert.equal(S.retry().ok, false); mem.setRead(false);
  assert.deepEqual([S.get().saveStatus, S.get().pendingAction.id], ["failed", T2.id]);
});

// 補做（2026-10-14 律師：「有辦法補做之前沒做的天數嗎」）——結算制（4agent 4A-20261014-makeup 定案）驗收矩陣
// 前三版（每次作答決定記到哪天）被 Codex 連 3 輪 FAIL；這裡逐條收錄那些反例（T01–T16）。
const OLD = require("./fixtures/core.pre-makeup-d7d1d78.js");   // 加補做前、線上那一版核心
const MK = "2026-10-18";
function doneToday(b, d) {
  d = d || D; let s = run(C.blankState(), b, NOON(d), op("tick"));
  s.days[d].planIds.forEach((id) => { s = run(s, b, NOON(d), op("answer", { cardId: id, ok: true })); });
  return s;
}
function finishRound(s, b, d, ok) { while (s.session.queue.length) s = run(s, b, NOON(d || D), op("answer", { cardId: s.session.queue[0], ok: ok !== false })); return s; }
const B12 = bank(Array.from({ length: 12 }, (_, i) => "c" + (i + 1)));
const BM6 = bank(["c1", "c2", "c3", "c4", "c5", "c6"]);
const lab = (from, cardId, day) => ({ lab: "x", day: day || D, phase: "observe", prediction: null, predictionCorrect: null, answer: 0, tasks: 0, tasksDone: [], from, card: cardId });

test("T01 正常補做：今天做完 → 開補做（review 回合＋makeup）→ 做完結算 → 那天記成練過、madeUp＝今天、間隔複習照今天算", () => {
  let s = doneToday(B12);
  assert.deepEqual(C.missedDays(s, "2026-10-17", D), ["2026-10-17", "2026-10-18", "2026-10-19"]);
  s = run(s, B12, NOON(D), op("sessionStart", { kind: "makeup", day: MK }));
  assert.equal(s.session.kind, "review"); assert.equal(s.session.makeup, MK); assert.equal(s.session.queue.length, 5);
  assert.equal(s.days[MK], undefined, "開始時不寫那天（不留半成品）");
  const ids = s.session.queue.slice();
  s = finishRound(s, B12);
  s = run(s, B12, NOON(D), op("makeupClaim", { day: MK, ids: s.session.answered }));
  assert.deepEqual(s.days[MK].touched.slice().sort(), ids.slice().sort());
  assert.deepEqual(s.days[MK].doneIds.slice().sort(), ids.slice().sort());
  assert.equal(s.days[MK].madeUp, D);
  assert.deepEqual(s.cards[ids[0]].goodDays, [D]); assert.equal(s.cards[ids[0]].due, "2026-10-23");   // #2696 隔 3 天
  assert.deepEqual(C.missedDays(s, "2026-10-17", D), ["2026-10-17", "2026-10-19"]);
  assert.deepEqual(C.checkState(s, B12), []);
});

test("T02 今天還沒做完不能開補做；那天已練過、今天或以後、壞日期都不行", () => {
  let s = run(C.blankState(), B12, NOON(D), op("tick"));
  assert.equal(C.reduce(s, op("sessionStart", { kind: "makeup", day: MK }), env(B12, NOON(D))).error, "MAKEUP_TODAY_FIRST");
  s = doneToday(B12);
  [D, "2026-10-21", "10/18", null].forEach((d) => assert.equal(C.reduce(s, op("sessionStart", { kind: "makeup", day: d }), env(B12, NOON(D))).error, "MAKEUP_DAY", String(d)));
  s.days["2026-10-19"] = { planIds: ["c12"], doneIds: ["c12"], touched: ["c12"], extraDone: false, labRuns: 0, teach: 0, mood: null };
  assert.equal(C.reduce(s, op("sessionStart", { kind: "makeup", day: "2026-10-19" }), env(B12, NOON(D))).error, "MAKEUP_DAY");
});

test("T03 結算條件：今天真的練過、不在今天計畫裡；沒練過的、今天計畫裡的、壞 id 都不算；一張都不算就拒絕且不寫", () => {
  let s = doneToday(B12);
  const todayCard = s.days[D].planIds[0];
  assert.equal(C.reduce(s, op("makeupClaim", { day: MK, ids: ["c12", 5, null] }), env(B12, NOON(D))).error, "MAKEUP_NONE", "c12 今天沒練過");
  assert.equal(C.reduce(s, op("makeupClaim", { day: MK, ids: [todayCard] }), env(B12, NOON(D))).error, "MAKEUP_NONE", "今天計畫的卡不能借去補別天");
  const r = C.reduce(s, op("makeupClaim", { day: MK, ids: "c1" }), env(B12, NOON(D)));
  assert.equal(r.error, "MAKEUP_NONE"); assert.equal(r.state.days[MK], undefined);
});

test("T04（Codex 第 3 輪 a）兩分頁各補不同日子、排到同一張卡：第一個結算拿走那張卡，第二個拒絕、不會誤報完成", () => {
  let s = doneToday(BM6);
  s = run(s, BM6, NOON(D), op("sessionStart", { kind: "makeup", day: MK }));            // A
  assert.deepEqual(s.session.queue, ["c6"]);
  s = run(s, BM6, NOON(D), op("sessionStart", { kind: "makeup", day: "2026-10-19" }));  // B 換掉共用回合
  s = run(s, BM6, NOON(D), op("answer", { cardId: "c6", ok: true }));                    // A 作答（不帶日子）
  s = run(s, BM6, NOON(D), op("makeupClaim", { day: MK, ids: ["c6"] }));                 // A 結算
  assert.deepEqual(s.days[MK].touched, ["c6"]);
  const r = C.reduce(s, op("makeupClaim", { day: "2026-10-19", ids: ["c6"] }), env(BM6, NOON(D)));   // B 結算
  assert.equal(r.error, "MAKEUP_NONE"); assert.equal(r.state.days["2026-10-19"], undefined);
  assert.ok(C.missedDays(s, "2026-10-17", D).includes("2026-10-19"), "10/19 照樣可以再補");
});

test("T05（Codex 第 3 輪 b）B 一般複習先答補做卡、A 再答同卡：那張卡今天練過，結算照樣算進補做日（touched 與 doneIds 一致）", () => {
  let s = doneToday(BM6);
  s = run(s, BM6, NOON(D), op("sessionStart", { kind: "makeup", day: MK }));
  s = run(s, BM6, NOON(D), op("sessionStart", { kind: "review", ids: ["c6"] }));
  s = run(s, BM6, NOON(D), op("answer", { cardId: "c6", ok: true }));
  s = run(s, BM6, NOON(D), op("answer", { cardId: "c6", ok: true }));
  s = run(s, BM6, NOON(D), op("makeupClaim", { day: MK, ids: ["c6"] }));
  assert.deepEqual(s.days[MK].touched, ["c6"]); assert.deepEqual(s.days[MK].doneIds, ["c6"]);
  assert.ok(!C.missedDays(s, "2026-10-17", D).includes(MK));
});

test("T06（Codex 第 3 輪 c）補做卡答錯進補救實驗、拖到隔天才完成：照一般規則算加碼（補救實驗不再有補做特例）", () => {
  let s = doneToday(B12);
  s = run(s, B12, NOON(D), op("sessionStart", { kind: "makeup", day: MK }));
  const c0 = s.session.queue[0];
  s = run(s, B12, NOON(D), op("answer", { cardId: c0, ok: false }));
  s.labRuns.r1 = lab("wrong", c0);
  const D2 = "2026-10-21"; s = run(s, B12, NOON(D2), op("tick"));
  s.days[D2].planIds.forEach((id) => { s = run(s, B12, NOON(D2), op("answer", { cardId: id, ok: true })); });
  const r = C.reduce(s, op("labComplete", { runId: "r1" }), env(B12, NOON(D2)));
  assert.ok(!r.error); assert.equal(r.state.days[D2].extraDone, true, "隔天做完實驗＝隔天的加碼，與補做無關");
});

test("T07（Codex 第 2 輪）補做做完後，考考爸媽、一般實驗照常算今天加碼", () => {
  let s = doneToday(B12);
  s = run(s, B12, NOON(D), op("sessionStart", { kind: "makeup", day: MK }));
  s = finishRound(s, B12); s = run(s, B12, NOON(D), op("makeupClaim", { day: MK, ids: s.session.answered }));
  assert.equal(s.days[D].extraDone, true, "補做時多練的卡算今天加碼（範圍調整：她今天確實多練了）");
  let t = doneToday(B12);
  t = run(t, B12, NOON(D), op("teach", { cardId: t.days[D].planIds[0] }));
  assert.equal(t.days[D].extraDone, true);
});

test("T08（Codex 第 1 輪）那天原本有實驗、考考爸媽、心情（沒答卡）：結算後照留", () => {
  let s = doneToday(B12);
  s.days[MK] = { planIds: [], doneIds: [], touched: [], extraDone: false, labRuns: 1, teach: 2, mood: "good" };
  s = run(s, B12, NOON(D), op("sessionStart", { kind: "makeup", day: MK }));
  s = finishRound(s, B12); s = run(s, B12, NOON(D), op("makeupClaim", { day: MK, ids: s.session.answered }));
  assert.equal(s.days[MK].labRuns, 1); assert.equal(s.days[MK].teach, 2); assert.equal(s.days[MK].mood, "good");
  assert.equal(s.days[MK].touched.length, 5);
  assert.deepEqual(C.checkState(s, B12), []);
});

test("T09（Codex 第 1 輪）日曆的補做色只看 days[那天].madeUp（不靠作答紀錄，log 截斷也不誤標）；正常練的日子沒有 madeUp", () => {
  let s = doneToday(B12);
  s = run(s, B12, NOON(D), op("sessionStart", { kind: "makeup", day: MK }));
  s = finishRound(s, B12); s = run(s, B12, NOON(D), op("makeupClaim", { day: MK, ids: s.session.answered }));
  assert.equal(s.days[D].madeUp, undefined); assert.equal(s.days[MK].madeUp, D);
  s.log = [];   // 模擬作答紀錄被截斷
  assert.equal(s.days[MK].madeUp, D); assert.deepEqual(C.checkState(s, B12), []);
});

test("T10（Codex 第 1 輪）壞存檔：days 不是物件、madeUp 壞掉、session.makeup 配錯回合種類 ⇒ 讀檔檢查回報錯誤、不拋例外", () => {
  let s = doneToday(B12);
  s = run(s, B12, NOON(D), op("sessionStart", { kind: "makeup", day: MK }));
  s = finishRound(s, B12); s = run(s, B12, NOON(D), op("makeupClaim", { day: MK, ids: s.session.answered }));
  const cases = [
    (x) => { x.days = null; }, (x) => { x.days = 5; },
    (x) => { x.days[MK].madeUp = MK; }, (x) => { x.days[MK].madeUp = "10/20"; }, (x) => { x.days[MK].touched = []; x.days[MK].doneIds = []; },
    (x) => { x.session.kind = "plan"; }, (x) => { x.session.makeup = "x"; },
  ];
  cases.forEach((f, i) => { const x = JSON.parse(JSON.stringify(s)); f(x); let e; assert.doesNotThrow(() => { e = C.checkState(x, B12); }); assert.ok(e.length > 0, "case " + i); });
});

test("T11 線上舊版核心（d7d1d78）：補做回合進行中、結算後都讀得過；舊版作答、跨日後 madeUp 與 session.makeup 照留", () => {
  let s = doneToday(B12);
  s = run(s, B12, NOON(D), op("sessionStart", { kind: "makeup", day: MK }));
  assert.deepEqual(OLD.checkState(s, B12), []);
  const o1 = OLD.reduce(s, op("answer", { cardId: s.session.queue[0], ok: true }), { bank: B12, now: NOON(D) });
  assert.ok(!o1.error); assert.equal(o1.state.session.makeup, MK, "舊版作答後 session.makeup 照留");
  s = finishRound(s, B12); s = run(s, B12, NOON(D), op("makeupClaim", { day: MK, ids: s.session.answered }));
  assert.deepEqual(OLD.checkState(s, B12), []);
  const o2 = OLD.reduce(s, op("tick"), { bank: B12, now: NOON("2026-10-21") });
  assert.ok(!o2.error); assert.equal(o2.state.days[MK].madeUp, D);
});

test("T12 跨午夜：10/20 開補做、10/21 才做完 ⇒ 昨天答的卡不算；一張都不算就拒絕，10/18 仍可補（沒有死路）", () => {
  let s = doneToday(B12);
  s = run(s, B12, NOON(D), op("sessionStart", { kind: "makeup", day: MK }));
  const ids = s.session.queue.slice();
  ids.forEach((id) => { s = run(s, B12, NOON(D), op("answer", { cardId: id, ok: true })); });
  const D2 = "2026-10-21";
  const r = C.reduce(s, op("makeupClaim", { day: MK, ids }), env(B12, NOON(D2)));
  assert.equal(r.error, "MAKEUP_NONE");
  s = run(s, B12, NOON(D2), op("tick"));
  assert.ok(C.missedDays(s, "2026-10-17", D2).includes(MK));
});

test("T13 同一份補做卡不能結算兩個日子；同一天重複結算被擋（MAKEUP_DAY）", () => {
  let s = doneToday(B12);
  s = run(s, B12, NOON(D), op("sessionStart", { kind: "makeup", day: MK }));
  s = finishRound(s, B12); const ids = s.session.answered.slice();
  s = run(s, B12, NOON(D), op("makeupClaim", { day: MK, ids }));
  assert.equal(C.reduce(s, op("makeupClaim", { day: MK, ids }), env(B12, NOON(D))).error, "MAKEUP_DAY");
  assert.equal(C.reduce(s, op("makeupClaim", { day: "2026-10-19", ids }), env(B12, NOON(D))).error, "MAKEUP_NONE");
});

test("T14 補做排卡：新卡（不含今天計畫、今天碰過的）；新卡用完排練過沒畢業、今天沒碰過的；都沒有才說沒卡可補", () => {
  const b5 = bank(["a1", "a2", "a3", "a4", "a5"]);
  assert.equal(C.reduce(doneToday(b5), op("sessionStart", { kind: "makeup", day: MK }), env(b5, NOON(D))).error, "MAKEUP_EMPTY");
  const b8 = bank(["a1", "a2", "a3", "a4", "a5", "a6", "a7", "a8"]);
  let s = doneToday(b8);
  // 2026-10-18（#2696）排程改隔 3 天：a1–a5 10/23 到期並學會，a6–a8 當天第一次練；10/24 補做只剩練過沒學會、今天沒碰過的 a6–a8
  s = run(s, b8, NOON("2026-10-23"), op("tick")); s.days["2026-10-23"].planIds.forEach((id) => { s = run(s, b8, NOON("2026-10-23"), op("answer", { cardId: id, ok: true })); });
  assert.deepEqual(s.days["2026-10-23"].planIds, ["a1", "a2", "a3", "a4", "a5", "a6", "a7", "a8"]);
  s = run(s, b8, NOON("2026-10-24"), op("sessionStart", { kind: "makeup", day: MK }));
  assert.deepEqual(s.session.queue.slice().sort(), ["a6", "a7", "a8"], "新卡用完 → 排練過沒學會的");
  s.session.queue.slice().forEach((id) => { s = run(s, b8, NOON("2026-10-24"), op("answer", { cardId: id, ok: false })); });   // 答錯＝還沒學會（答對的話第 2 天就學會，測不到這條）
  assert.equal(C.reduce(s, op("sessionStart", { kind: "makeup", day: "2026-10-17" }), env(b8, NOON("2026-10-24"))).error, "MAKEUP_EMPTY", "今天練過的卡不再排");
});

test("T15 補做回合答錯照一般規則：進「再練答錯的」、換一題確認都可；作答與加碼都記今天", () => {
  let s = doneToday(B12);
  s = run(s, B12, NOON(D), op("sessionStart", { kind: "makeup", day: MK }));
  const c0 = s.session.queue[0];
  s = run(s, B12, NOON(D), op("answer", { cardId: c0, ok: false }));
  assert.deepEqual(s.session.wrong, [c0]);
  s = run(s, B12, NOON(D), op("sessionStart", { kind: "redo", ids: [c0] }));
  assert.equal(s.session.makeup, undefined);
  s = run(s, B12, NOON(D), op("makeupClaim", { day: MK, ids: [c0] }));
  assert.deepEqual(s.days[MK].touched, [c0], "答錯的卡今天也練過了，結算算數");
});

test("T16 補做回合跨午夜被換成當天計畫：補做那天沒被寫，仍可補", () => {
  let s = doneToday(B12);
  s = run(s, B12, NOON(D), op("sessionStart", { kind: "makeup", day: MK }));
  s = run(s, B12, NOON(D), op("answer", { cardId: s.session.queue[0], ok: true }));
  s = run(s, B12, NOON("2026-10-21"), op("tick"));
  assert.equal(s.session.makeup, undefined); assert.equal(s.days[MK], undefined);
  assert.deepEqual(C.checkState(s, B12), []);
});

test("T17（Grok 審 1b0aebe）每一張卡都畢業了 ⇒ MAKEUP_ALLDONE（不是「明天再來補」的 MAKEUP_EMPTY）", () => {
  const b2 = bank(["z1", "z2"]); let s = doneToday(b2);
  ["z1", "z2"].forEach((id) => { s.cards[id] = { seen: 3, goodDays: ["2026-10-15", "2026-10-17", "2026-10-19"], blockedDay: null, due: null }; });
  assert.equal(C.reduce(s, op("sessionStart", { kind: "makeup", day: MK }), env(b2, NOON(D))).error, "MAKEUP_ALLDONE");
  const b3 = bank(["z1", "z2", "z3"]); let t = doneToday(b3);
  t.cards.z3 = { seen: 1, goodDays: [D], blockedDay: null, due: "2026-10-21" };   // z3 沒畢業、但今天已練 ⇒ 明天就有
  ["z1", "z2"].forEach((id) => { t.cards[id] = { seen: 3, goodDays: ["2026-10-15", "2026-10-17", "2026-10-19"], blockedDay: null, due: null }; });
  assert.equal(C.reduce(t, op("sessionStart", { kind: "makeup", day: MK }), env(b3, NOON(D))).error, "MAKEUP_EMPTY");
});

// 2026-10-18 題庫裁重複題（Codex 審 g5-math-review 3751016 兩項 P2）：被拿掉的卡只從「還沒做」的清單移除，已做完的紀錄照留
test("V1 今天計畫已做完的卡被題庫拿掉：今天仍算完成，補做不被鎖", () => {
  const b1 = bank(["v1"]), b2 = bank(["v2"]);
  let s = run(C.blankState(), b1, NOON(D), op("answer", { cardId: "v1", ok: true }));
  assert.equal(C.view(s, env(b1, NOON(D))).completed, true);
  s = run(s, b2, NOON(D), op("tick"));
  assert.deepEqual([s.days[D].planIds, s.days[D].doneIds], [["v1"], ["v1"]]);
  assert.equal(C.view(s, env(b2, NOON(D))).completed, true);
  const r = C.reduce(s, op("sessionStart", { kind: "makeup", day: "2026-10-19" }), env(b2, NOON(D)));
  assert.notEqual(r.error, "MAKEUP_TODAY_FIRST");
});
// V2（10-18 第二輪「當場結算」）已依設計方案③作廢、改由 T06 涵蓋：清理題庫不能決定補做歸屬（Codex 設計者 L20261018061404-4e46e8）
test("V3 一般補做：最後一題答完、題庫沒變，不會被提前結算（照舊由畫面送結算）", () => {
  const b1 = bank(["p1", "m1", "m2"]), b0 = bank(["p1"]);
  let s = run(C.blankState(), b0, NOON(D), op("answer", { cardId: "p1", ok: true }));
  s = run(s, b1, NOON(D), op("sessionStart", { kind: "makeup", day: "2026-10-19" }));
  s.session.queue.slice().forEach((id) => { s = run(s, b1, NOON(D), op("answer", { cardId: id, ok: true })); });
  s = run(s, b1, NOON(D), op("tick"));
  assert.ok(!s.days["2026-10-19"] || !s.days["2026-10-19"].madeUp, "沒送結算前不得結算");
  s = run(s, b1, NOON(D), op("makeupClaim", { day: "2026-10-19", ids: s.session.answered.slice() }));
  assert.equal(s.days["2026-10-19"].madeUp, D);
});

// ===== 2026-10-18 設計方案③驗收（Codex 設計者 L20261018061404-4e46e8 矩陣 T01–T24 中核心可測的部分）=====
// bank.cards＝完整目錄；bank.active＝能排成新卡的題。停止出新的題 x 仍在目錄裡。
function abank(ids, active, concept) { const b = bank(ids, concept); b.active = {}; active.forEach((id) => { b.active[id] = 1; }); return b; }
test("T01 只練過停止出新的題：觀念階段不倒退（仍是發芽），母體含練過的舊題", () => {
  const full = bank(["x1", "x2", "k1", "k2", "k3"]), cut = abank(["x1", "x2", "k1", "k2", "k3"], ["k1", "k2", "k3"]);
  let s = run(C.blankState(), full, NOON(D), op("answer", { cardId: "x1", ok: true }));
  s = run(s, full, NOON(D), op("answer", { cardId: "x2", ok: true }));
  const pool = C.poolCards(s, cut).map((c) => c.id).sort();
  assert.deepEqual(pool, ["k1", "k2", "k3", "x1", "x2"], "練過的 x1、x2 仍在母體");
  assert.equal(C.view(s, env(cut, NOON(D))).stages["1-1"], 1, "發芽，不是種子");
  assert.equal(s.cards.k1, undefined, "不替保留題冒記作答（T10）");
});
test("T02 今天計畫做完的卡被停止出新：今天仍完成、計畫不變", () => {
  const full = bank(["x"]), cut = abank(["x", "k"], ["k"]);
  let s = run(C.blankState(), full, NOON(D), op("answer", { cardId: "x", ok: true }));
  s = run(s, cut, NOON(D), op("tick"));
  assert.deepEqual([s.days[D].planIds, s.days[D].doneIds], [["x"], ["x"]]);
  assert.equal(C.view(s, env(cut, NOON(D))).completed, true);
});
test("T03／T05 停止出新的題還在回合裡：查得回、可以繼續答，tick 不會自動結算補做", () => {
  const b0 = bank(["p1"]), full = bank(["p1", "x1", "x2"]), cut = abank(["p1", "x1", "x2"], ["p1"]);
  let s = run(C.blankState(), b0, NOON(D), op("answer", { cardId: "p1", ok: true }));
  s = run(s, full, NOON(D), op("sessionStart", { kind: "makeup", day: "2026-10-19" }));
  const q = s.session.queue.slice();
  s = run(s, full, NOON(D), op("answer", { cardId: q[0], ok: true }));
  s = run(s, cut, NOON(D), op("tick"));
  assert.deepEqual(s.session.queue, [q[1]], "待答的舊題保留");
  assert.ok(!s.days["2026-10-19"], "tick 不結算");
  s = run(s, cut, NOON(D), op("answer", { cardId: q[1], ok: true }));
  s = run(s, cut, NOON(D), op("makeupClaim", { day: "2026-10-19", ids: s.session.answered.slice() }));
  assert.deepEqual(s.days["2026-10-19"].touched.slice().sort(), q.slice().sort());
});
test("T04 舊版留下的空計畫：不猜原計畫；沒有待做任務就不擋補做", () => {
  const b = bank(["a", "b"]); const s = C.blankState();
  s.days[D] = { planIds: [], doneIds: [], touched: [], extraDone: false, labRuns: 0, teach: 0, mood: null };
  const v = C.view(s, env(b, NOON(D)));
  assert.equal(v.completed, false, "空計畫不是完成");
  const r = C.reduce(s, op("sessionStart", { kind: "makeup", day: "2026-10-19" }), env(b, NOON(D)));
  assert.notEqual(r.error, "MAKEUP_TODAY_FIRST");
  assert.deepEqual(r.state.days[D].touched, [], "沒作答不寫 touched");
});
test("T06 補做剩下的題在目錄裡真的查不到：不自動結算；首頁有結算入口；明確結算一次、重送不重複", () => {
  const b0 = bank(["p1"]), full = bank(["p1", "m1", "m2"]), gone = bank(["p1"]);
  let s = run(C.blankState(), b0, NOON(D), op("answer", { cardId: "p1", ok: true }));
  s = run(s, full, NOON(D), op("sessionStart", { kind: "makeup", day: "2026-10-19" }));
  const q = s.session.queue.slice();
  s = run(s, full, NOON(D), op("answer", { cardId: q[0], ok: true }));
  s = run(s, gone, NOON(D), op("tick"));
  assert.ok(!s.days["2026-10-19"], "tick 不結算");
  assert.equal(C.view(s, env(gone, NOON(D))).makeupPending, "2026-10-19", "首頁有結算入口");
  s = run(s, gone, NOON(D), op("makeupClaim", { day: "2026-10-19", ids: s.session.answered.slice() }));
  assert.deepEqual(s.days["2026-10-19"].touched, [q[0]]);
  assert.equal(C.view(s, env(gone, NOON(D))).makeupPending, null, "結算後入口消失");
  assert.equal(C.reduce(s, op("makeupClaim", { day: "2026-10-19", ids: [q[0]] }), env(gone, NOON(D))).error, "MAKEUP_DAY", "重送不重複");
});
test("T08／T09 新卡只從 active 挑；練過、沒畢業、到期的舊題照常排進複習", () => {
  const full = bank(["x", "k1", "k2"]), cut = abank(["x", "k1", "k2", "y"], ["k1", "k2"]);
  let s = run(C.blankState(), full, NOON("2026-10-19"), op("answer", { cardId: "x", ok: true }));
  const plan = C.view(s, env(cut, NOON("2026-10-22"))).planIds;   // 10/19 答對 ⇒ 隔 3 天 10/22 到期（#2696）
  assert.ok(plan.includes("x"), "到期的舊題 x 照排");
  assert.ok(!plan.includes("y"), "沒練過、非 active 的 y 不排成新卡");
  assert.ok(plan.includes("k1") && plan.includes("k2"));
  assert.deepEqual(s.cards.x.goodDays, ["2026-10-19"], "成績不因裁題改變");
});
test("T15 兩分頁：A 補 10/18 答一題後題被停止出新，B 換成補 10/19；tick 不替任何一天結算，只有明確請求才記", () => {
  const b0 = bank(["p1"]), full = bank(["p1", "a1", "a2", "b1"]), cut = abank(["p1", "a1", "a2", "b1"], ["p1", "b1"]);
  let s = run(C.blankState(), b0, NOON(D), op("answer", { cardId: "p1", ok: true }));
  s = run(s, full, NOON(D), op("sessionStart", { kind: "makeup", day: "2026-10-18" }));
  const a = s.session.queue[0];
  s = run(s, full, NOON(D), op("answer", { cardId: a, ok: true }));
  s = run(s, cut, NOON(D), op("sessionStart", { kind: "makeup", day: "2026-10-19" }));
  s = run(s, cut, NOON(D), op("tick"));
  assert.ok(!s.days["2026-10-18"] && !s.days["2026-10-19"], "沒有自動結算");
  s = run(s, cut, NOON(D), op("makeupClaim", { day: "2026-10-18", ids: [a] }));
  assert.deepEqual(s.days["2026-10-18"].touched, [a]);
});
test("T19 合併表刪一行（x 重新變成 active）：今天的計畫不變，明天起才排得到", () => {
  const cut = abank(["k", "x"], ["k"]), back = bank(["k", "x"]);
  let s = run(C.blankState(), cut, NOON(D), op("tick"));
  assert.deepEqual(s.days[D].planIds, ["k"]);
  s = run(s, back, NOON(D), op("tick"));
  assert.deepEqual(s.days[D].planIds, ["k"], "今天不重開");
  assert.ok(C.view(s, env(back, NOON("2026-10-21"))).planIds.includes("x"), "明天可出 x");
});

// ===== 2026-10-18 設計試做第 2 輪（Codex 審 4d71855 判 FAIL 的項目）＋排程改「隔 3 天、第 2 次答對學會」（#2696）=====
test("R2a 家長匯入的題（不在內建目錄）可以排成新卡、算進母體", () => {
  const cut = abank(["k", "x"], ["k"]);
  let s = run(C.blankState(), cut, NOON("2026-10-19"), op("import", { cards: [card("custom")] }));
  assert.ok(C.poolCards(s, cut, D).some((c) => c.id === "custom"), "母體有匯入題");
  assert.ok(C.view(s, env(cut, NOON(D))).planIds.includes("custom"), "隔天計畫排得到匯入題");
});
test("R2b 母體只看今天的計畫：昨天沒答的停止出新題不混進今天", () => {
  const full = bank(["x", "k"]), cut = abank(["x", "k"], ["k"]);
  let s = run(C.blankState(), full, NOON("2026-10-19"), op("tick"));
  assert.ok(s.days["2026-10-19"].planIds.includes("x"));
  assert.deepEqual(C.poolCards(s, cut, D).map((c) => c.id), ["k"], "今天的母體不含昨天沒答的 x");
  assert.deepEqual(C.poolCards(s, cut, "2026-10-19").map((c) => c.id).sort(), ["k", "x"], "昨天當天仍算");
});
test("R2c 新題候選都學會、只剩停止出新的題沒練過：補做回「全部學會」，不說明天再來", () => {
  const cut = abank(["k", "x"], ["k"]); let s = C.blankState();
  s.cards.k = learned(2, ["2026-10-15", "2026-10-18"], null);
  s.days[D] = { planIds: [], doneIds: [], touched: [], extraDone: false, labRuns: 0, teach: 0, mood: null };
  assert.equal(C.reduce(s, op("sessionStart", { kind: "makeup", day: "2026-10-19" }), env(cut, NOON(D))).error, "MAKEUP_ALLDONE");
});
test("R2d 補做中途停下來（halted）還有剩題：首頁仍有結算入口", () => {
  const b0 = bank(["p1"]), full = bank(["p1", "m1", "m2", "m3"]);
  let s = run(C.blankState(), b0, NOON(D), op("answer", { cardId: "p1", ok: true }));
  s = run(s, full, NOON(D), op("sessionStart", { kind: "makeup", day: "2026-10-19" }));
  s = run(s, full, NOON(D), op("answer", { cardId: s.session.queue[0], ok: true }));
  s.session.halted = true;
  assert.equal(C.view(s, env(full, NOON(D))).makeupPending, "2026-10-19");
});
test("R2f 作答紀錄截斷：當天 touched 有的卡照樣可以結算補做", () => {
  const b0 = bank(["p1"]), full = bank(["p1", "m1"]);
  let s = run(C.blankState(), b0, NOON(D), op("answer", { cardId: "p1", ok: true }));
  s = run(s, full, NOON(D), op("sessionStart", { kind: "makeup", day: "2026-10-19" }));
  s = run(s, full, NOON(D), op("answer", { cardId: "m1", ok: true }));
  s.log = s.log.filter((e) => e.card !== "m1");   // 模擬紀錄被截斷
  s = run(s, full, NOON(D), op("makeupClaim", { day: "2026-10-19", ids: ["m1"] }));
  assert.deepEqual(s.days["2026-10-19"].touched, ["m1"]);
});
test("S1 排程（#2696）：答對後隔 3 天到期；隔天再答對不算新的一天以外的提早學會；第 2 個答對日就學會", () => {
  const b = bank(["s1"]);
  let s = run(C.blankState(), b, NOON(D), op("answer", { cardId: "s1", ok: true }));
  assert.deepEqual([s.cards.s1.goodDays, s.cards.s1.due], [[D], "2026-10-23"]);
  s = run(s, b, NOON("2026-10-23"), op("answer", { cardId: "s1", ok: true }));
  assert.deepEqual([s.cards.s1.goodDays, s.cards.s1.due], [[D, "2026-10-23"], null], "第 2 個答對日學會");
  assert.ok(!C.view(s, env(b, NOON("2026-10-26"))).planIds.includes("s1"), "學會後不再排");
});
