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
  const s3fresh = JSON.parse(JSON.stringify(s2)); delete s3fresh.cards.s3;   // 小考複習只出沒做過的（2026-10-19）：讓 s3 也是沒做過的，才驗得到排序
  const rv = C.reduce(s3fresh, op("sessionStart", { kind: "review", ids: ["s3", "t1"] }), env(b2, NOON(D)));
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
  // 2026-10-19 律師：「為何已做過的題目還要做？」⇒ 做過的 s1 不排、查不到的 zz 不排（見 V2）
  assert.deepEqual([s.session.kind, s.session.queue], ["review", ["s2", "t1"]]);
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

// ---------- 小考複習／闖關只出還沒做過的（2026-10-19 律師：「為何用單元方式測驗，每次都要重頭做，為何已做過的題目還要做？」
// 「已經用其他方式做過的題目（比如闖關或每日模式），能否不用再重複做？」）。取代 10-11「答錯過的→沒練過的→已經會的」整份排序：
// 舊 V2–V4 只驗「每題都答對」，答錯當天再答對仍是待加強、每段開頭都是同一批，才一直沒測出來 ----------
const B6 = () => ({ cards: [card("a1"), card("a2"), card("a3"), card("b1", "1-2"), card("b2", "1-2"), card("b3", "1-2")], concepts: CONCEPTS, figs: FIGS });
const ALL6 = ["a1", "a2", "a3", "b1", "b2", "b3"];
const seenIds = (s) => Object.keys(s.cards).filter((id) => s.cards[id].seen > 0);

test("V2 單元／闖關只出還沒做過的（題庫順序、觀念交錯）；做過的不論對錯都不排；size 只取前 N 題", () => {
  const b = B6(); let s = C.blankState();
  s = run(s, b, NOON("2026-10-15"), op("answer", { cardId: "b1", ok: true }));
  s = run(s, b, NOON("2026-10-18"), op("answer", { cardId: "a1", ok: true }));
  s = run(s, b, NOON("2026-10-19"), op("answer", { cardId: "a1", ok: true }));
  s = run(s, b, NOON("2026-10-19"), op("answer", { cardId: "a2", ok: false }));
  const full = run(s, b, NOON(D), op("sessionStart", { kind: "review", ids: ALL6 }));
  assert.deepEqual(full.session.queue, ["a3", "b2", "b3"]);
  const seg = run(s, b, NOON(D), op("sessionStart", { kind: "review", ids: ALL6, size: 2 }));
  assert.deepEqual(seg.session.queue, ["a3", "b2"]);
  assert.deepEqual(seg.days[D].planIds, full.days[D].planIds);     // 分段不改當日計畫
  assert.deepEqual(C.checkState(seg, b), []);
});

test("V3 練待加強的（pick:weak）：只出做過但還沒把握、今天還沒在任何地方練過的；最久沒練的先；已經會的、沒做過的都不出", () => {
  const b = B6(); let s = C.blankState();
  s = run(s, b, NOON("2026-10-17"), op("answer", { cardId: "b2", ok: false }));
  s = run(s, b, NOON("2026-10-18"), op("answer", { cardId: "a2", ok: false }));
  s = run(s, b, NOON("2026-10-18"), op("answer", { cardId: "a3", ok: true, hint: true }));   // 看提示才答對＝還沒把握
  s = run(s, b, NOON("2026-10-18"), op("answer", { cardId: "a1", ok: true }));
  s = run(s, b, NOON(D), op("answer", { cardId: "b3", ok: false }));                         // 今天剛答錯：今天不再出
  assert.deepEqual(C.reviewCounts(s, b, ALL6, D), { total: 6, seen: 5, fresh: 1, weak: 4, weakNow: 3, againNow: 5 });
  let w = run(s, b, NOON(D), op("sessionStart", { kind: "review", ids: ALL6, pick: "weak" }));
  assert.deepEqual(w.session.queue, ["b2", "a2", "a3"]);
  w = run(w, b, NOON(D), op("answer", { cardId: "b2", ok: true }));    // 隔天以後第一次答對＝有把握了
  w = run(w, b, NOON(D), op("answer", { cardId: "a2", ok: false }));
  assert.deepEqual(run(w, b, NOON(D), op("sessionStart", { kind: "review", ids: ALL6, pick: "weak" })).session.queue, ["a3"], "同一天再按：剛練過的不再出");
  assert.deepEqual(run(w, b, NOON("2026-10-21"), op("sessionStart", { kind: "review", ids: ALL6, pick: "weak" })).session.queue.slice().sort(), ["a2", "a3", "b3"], "隔天：還沒把握的回來");
});

test("V4 同一天連按「再練一段」：不論答對答錯，每段都不重出做過的題；沒做過的做完就 REVIEW_EMPTY、存檔不動", () => {
  const ids = Array.from({ length: 60 }, (_, i) => "c" + (i + 1));
  const b = { cards: ids.map((id, i) => card(id, i % 2 ? "1-2" : "1-1")), concepts: CONCEPTS, figs: FIGS };
  let s = C.blankState();
  for (let i = 1; i <= 20; i++) s = run(s, b, NOON("2026-10-19"), op("answer", { cardId: "c" + i, ok: i > 6 }));   // 昨天每日練習做過 20 題（6 題答錯）
  let covered = 0;
  for (let k = 0; k < 2; k++) {
    const done = new Set(seenIds(s));
    s = run(s, b, NOON(D), op("sessionStart", { kind: "review", ids, size: 20 }));
    const q = s.session.queue.slice();
    assert.equal(q.length, 20); assert.equal(q.filter((id) => done.has(id)).length, 0, "第 " + (k + 1) + " 段不該出做過的題");
    q.forEach((id, i) => { s = run(s, b, NOON(D), op("answer", { cardId: id, ok: i % 2 === 0 })); });   // 一半答錯
    covered += q.length;
  }
  assert.equal(covered, 40);
  const r = C.reduce(s, op("sessionStart", { kind: "review", ids, size: 20 }), env(b, NOON(D)));
  assert.equal(r.error, "REVIEW_EMPTY"); assert.equal(r.state, s);
  assert.equal(C.reduce(s, op("sessionStart", { kind: "review", ids }), env(b, NOON(D))).error, "REVIEW_EMPTY", "一次做完全部也一樣");
  const all = run(C.blankState(), b, NOON(D), op("sessionStart", { kind: "review", ids }));
  assert.equal(all.session.queue.length, 60, "不給 size＝沒做過的一次排完");
});

test("V6 每日練習、闖關做過的題，單元與安親班卷都不再出（做過＝任何地方答過一次）；單元先做的計畫卡，計畫照樣算完成", () => {
  const b = B6(); let s = C.blankState();
  s = run(s, b, NOON(D), op("sessionStart", {}));                                              // 每日練習
  const daily = s.session.queue.slice(0, 2);
  s = run(s, b, NOON(D), op("answer", { cardId: daily[0], ok: true }));
  s = run(s, b, NOON(D), op("answer", { cardId: daily[1], ok: false }));
  s = run(s, b, NOON(D), op("sessionStart", { kind: "review", ids: ["b1", "b2", "b3"], size: 1 }));   // 闖關（觀念 1-2）
  const go = s.session.queue[0];
  s = run(s, b, NOON(D), op("answer", { cardId: go, ok: true }));
  const done = daily.concat(go);
  const unit = run(s, b, NOON(D), op("sessionStart", { kind: "review", ids: ALL6 }));
  assert.deepEqual(unit.session.queue.slice().sort(), ALL6.filter((id) => done.indexOf(id) < 0).sort());
  assert.equal(C.reviewCounts(unit, b, ALL6, D).fresh, unit.session.queue.length);
  let u = unit; u.session.queue.slice().forEach((id) => { u = run(u, b, NOON(D), op("answer", { cardId: id, ok: true })); });
  const v = C.view(u, env(b, NOON(D)));
  assert.deepEqual([v.remainingIds, v.completed], [[], true], "計畫卡在單元做過也算做完，不必回每日練習再做");
});

test("V7 畫面題數與出題同一判準：reviewCounts.fresh＝單元回合題數、weakNow＝練待加強回合題數（逐步作答都成立）", () => {
  const ids = Array.from({ length: 12 }, (_, i) => "c" + (i + 1));
  const b = { cards: ids.map((id, i) => card(id, i % 3 ? "1-2" : "1-1")), concepts: CONCEPTS, figs: FIGS };
  let s = C.blankState(); let k = 0;
  const check = (st, day) => {
    const c = C.reviewCounts(st, b, ids, day);
    const f = C.reduce(st, op("sessionStart", { kind: "review", ids }), env(b, NOON(day)));
    const w = C.reduce(st, op("sessionStart", { kind: "review", ids, pick: "weak" }), env(b, NOON(day)));
    assert.equal(f.error ? 0 : f.state.session.queue.length, c.fresh, day + " fresh");
    assert.equal(w.error ? 0 : w.state.session.queue.length, c.weakNow, day + " weakNow");
    assert.equal(c.fresh + c.seen, c.total);
  };
  ["2026-10-19", D, "2026-10-21"].forEach((day) => {
    check(s, day);
    for (let j = 0; j < 4; j++) { s = run(s, b, NOON(day), op("answer", { cardId: ids[(k * 5 + j) % 12], ok: (k + j) % 3 !== 0 })); check(s, day); }
    k++;
  });
});

test("V8 考前全部再練一遍（pick:again）：做過的也出、最久沒練的先、今天練過的不出；分段按、隔天再按都接著掃，不從頭來", () => {
  const b = B6(); let s = C.blankState();
  s = run(s, b, NOON("2026-10-15"), op("answer", { cardId: "b1", ok: true }));
  s = run(s, b, NOON("2026-10-18"), op("answer", { cardId: "a1", ok: true }));
  s = run(s, b, NOON("2026-10-19"), op("answer", { cardId: "a1", ok: true }));   // a1 學會了
  s = run(s, b, NOON(D), op("answer", { cardId: "a2", ok: false }));              // 今天練過：今天不出
  assert.deepEqual(C.reviewCounts(s, b, ALL6, D).againNow, 5);
  let g = run(s, b, NOON(D), op("sessionStart", { kind: "review", ids: ALL6, pick: "again", size: 3 }));
  assert.deepEqual(g.session.queue, ["a3", "b2", "b3"], "沒練過的先，其次最久沒練的");
  g.session.queue.slice().forEach((id) => { g = run(g, b, NOON(D), op("answer", { cardId: id, ok: true })); });
  g = run(g, b, NOON(D), op("sessionStart", { kind: "review", ids: ALL6, pick: "again", size: 3 }));
  assert.deepEqual(g.session.queue, ["b1", "a1"], "同一天再按：接著掃剩下的，學會的也出");
  assert.equal(C.reviewCounts(g, b, ALL6, D).againNow, 2);
  g = run(g, b, NOON("2026-10-21"), op("sessionStart", { kind: "review", ids: ALL6, pick: "again", size: 2 }));
  assert.deepEqual(g.session.queue, ["b1", "a1"], "隔天：最久沒練的先，不從題庫第 1 題重來");
  assert.deepEqual(C.checkState(g, b), []);
});

test("V9 作答紀錄截斷（LOG_KEEP）後，考前全部再練一遍照樣用 days[].touched 判最後練習日，不會一直重出同一批", () => {
  const b = B6(); let s = C.blankState();
  s = run(s, b, NOON("2026-10-15"), op("answer", { cardId: "a2", ok: true }));   // 日期順序故意和題庫順序相反：沒走 days[].touched 就排成 a1、b1、a2（突變自檢抓到原夾具日期與題庫同序、測不出來）
  s = run(s, b, NOON("2026-10-17"), op("answer", { cardId: "b1", ok: true }));
  s = run(s, b, NOON("2026-10-19"), op("answer", { cardId: "a1", ok: true }));
  s.log = [];   // 一天 60 多張，600 筆幾天就截斷；這裡截到一筆不剩
  assert.deepEqual(C.checkState(s, b), []);
  const g = run(s, b, NOON(D), op("sessionStart", { kind: "review", ids: ALL6, pick: "again" }));
  assert.deepEqual(g.session.queue, ["a3", "b2", "b3", "a2", "b1", "a1"], "沒練過的先，其次 10/15、10/17、10/19");
});

test("V10 續接 10-19 以前開的回合（沒有 pick）：做過的題自動拿掉（畫面與存檔一致）；weak 回合照它的條件；補做回合不動（Codex 審 b6c9b5e F2）", () => {
  const b = B6(); let s = C.blankState();
  s = run(s, b, NOON(D), op("answer", { cardId: "a1", ok: false }));
  s = run(s, b, NOON(D), op("answer", { cardId: "a2", ok: false }));
  s.session = { day: D, kind: "review", queue: ["a2", "a3", "b1"], answered: ["a1"], wrong: ["a1"], kinds: {} };   // 舊版「一次做完全部」開到一半：佇列裡有做過的 a2
  assert.deepEqual(C.checkState(s, b), []);
  assert.deepEqual(C.view(s, env(b, NOON(D))).session.queue, ["a3", "b1"], "首頁「繼續」與作答畫面讀到的");
  s = run(s, b, NOON(D), op("tick"));
  assert.deepEqual(s.session.queue, ["a3", "b1"], "存回去的也拿掉了");
  let w = C.blankState();
  w = run(w, b, NOON("2026-10-19"), op("answer", { cardId: "a1", ok: false }));
  w = run(w, b, NOON(D), op("sessionStart", { kind: "review", ids: ALL6, pick: "weak" }));
  assert.deepEqual([w.session.pick, C.view(w, env(b, NOON(D))).session.queue], ["weak", ["a1"]], "weak 回合的題本來就做過，續接照留");
  const bad = JSON.parse(JSON.stringify(w)); bad.session.pick = "all";
  assert.ok(C.checkState(bad, b).includes("session"), "pick 只能是 fresh／weak／again");
});

test("V11 補救換題守這一輪的條件：只出沒做過的回合只換沒做過的同觀念題、不拿今天練過的；挑不到就不換（Codex 審 b6c9b5e F1）", () => {
  const b = { cards: [card("a1"), card("a2"), card("a3"), card("a4")], concepts: CONCEPTS, figs: FIGS };
  const lab = (st, id) => {
    st = run(st, b, NOON(D), op("labStart", { runId: "r" + id, lab: "shadow", tasks: 1, answer: 0, from: "wrong", card: id }));
    st = run(st, b, NOON(D), op("labPredict", { runId: "r" + id, choice: 0 }));
    st = run(st, b, NOON(D), op("labTask", { runId: "r" + id, task: 0 }));
    return C.reduce(st, op("labComplete", { runId: "r" + id }), env(b, NOON(D)));
  };
  let s = C.blankState();
  s = run(s, b, NOON(D), op("answer", { cardId: "a1", ok: true }));                     // 今天先在別處做過 a1
  s = run(s, b, NOON(D), op("sessionStart", { kind: "review", ids: ["a1", "a2", "a3", "a4"], size: 2 }));
  assert.deepEqual(s.session.queue, ["a2", "a3"]);
  s = run(s, b, NOON(D), op("answer", { cardId: "a2", ok: false }));
  const r = lab(s, "a2");
  assert.equal(r.info.variation, "a3", "換成佇列裡沒做過的同觀念題，不插回做過的 a1");
  assert.deepEqual(r.state.session.queue, ["a3"]);
  let t = C.blankState();
  ["a1", "a3", "a4"].forEach((id) => { t = run(t, b, NOON("2026-10-19"), op("answer", { cardId: id, ok: true })); });
  t = run(t, b, NOON(D), op("sessionStart", { kind: "review", ids: ["a1", "a2", "a3", "a4"] }));
  assert.deepEqual(t.session.queue, ["a2"]);
  t = run(t, b, NOON(D), op("answer", { cardId: "a2", ok: false }));
  const r2 = lab(t, "a2");
  assert.equal(r2.info.variation, undefined, "同觀念沒有沒做過的題：不換題，也不插回做過的");
  assert.deepEqual(r2.state.session.queue, []);
});

test("V12 開新一輪存檔失敗＝沒開成：不留待存，之後作答不會把原本那一輪悄悄換掉；「再存一次」沒有待存時把提示清掉（Codex 審 b6c9b5e F4 延伸）", () => {
  const b = B6(); const mem = memStorage(); const st = mkStore(mem, b, { t: NOON(D) });
  assert.ok(st.dispatch(op("sessionStart", { kind: "review", ids: ["a1", "a2", "a3"], pick: "again" })).ok);
  const first = st.get().state.session.queue[0];
  mem.setFail(true);
  const r = st.dispatch(op("sessionStart", { kind: "review", ids: ["b1", "b2", "b3"] }));
  assert.deepEqual([r.ok, st.get().pendingAction, st.get().saveStatus], [false, null, "failed"]);
  mem.setFail(false);
  assert.ok(st.retry().ok); assert.equal(st.get().saveStatus, "ok", "提示列不卡住");
  assert.ok(st.dispatch(op("answer", { cardId: first, ok: true })).ok);
  const se = st.get().state.session;
  assert.deepEqual([se.pick, se.answered, se.queue.indexOf("b1")], ["again", [first], -1], "還是原本那一輪，沒被補開的新一輪換掉");
  mem.setFail(true);
  assert.equal(st.dispatch(op("answer", { cardId: se.queue[0], ok: true })).ok, false);
  assert.ok(st.get().pendingAction, "作答照舊留著重試");
  mem.setFail(false);
});

test("V13 補救換題：只出沒做過的回合不拿已裁掉（停止出新）的題；練待加強的回合不拿今天練過的題（Codex 審 b6c9b5e F1；突變自檢補測）", () => {
  const lab = (st, bk, id) => {
    st = run(st, bk, NOON(D), op("labStart", { runId: "r" + id, lab: "shadow", tasks: 1, answer: 0, from: "wrong", card: id }));
    st = run(st, bk, NOON(D), op("labPredict", { runId: "r" + id, choice: 0 }));
    st = run(st, bk, NOON(D), op("labTask", { runId: "r" + id, task: 0 }));
    return C.reduce(st, op("labComplete", { runId: "r" + id }), env(bk, NOON(D)));
  };
  const b = { cards: [card("a1"), card("a2"), card("a3"), card("a4")], concepts: CONCEPTS, figs: FIGS, active: { a1: 1, a2: 1, a4: 1 } };   // a3 停止出新
  let s = C.blankState();
  s = run(s, b, NOON("2026-10-19"), op("answer", { cardId: "a1", ok: true }));
  s = run(s, b, NOON(D), op("sessionStart", { kind: "review", ids: ["a2"] }));
  s = run(s, b, NOON(D), op("answer", { cardId: "a2", ok: false }));
  assert.equal(lab(s, b, "a2").info.variation, "a4", "不拿停止出新的 a3、也不拿做過的 a1");
  const b2 = { cards: [card("a1"), card("a2"), card("a3")], concepts: CONCEPTS, figs: FIGS };
  let w = C.blankState();
  w = run(w, b2, NOON("2026-10-19"), op("answer", { cardId: "a1", ok: false }));
  w = run(w, b2, NOON("2026-10-19"), op("answer", { cardId: "a2", ok: false }));
  w = run(w, b2, NOON(D), op("answer", { cardId: "a2", ok: false }));            // a2 今天又練過（仍待加強）
  w = run(w, b2, NOON(D), op("sessionStart", { kind: "review", ids: ["a1", "a2", "a3"], pick: "weak" }));
  assert.deepEqual(w.session.queue, ["a1"]);
  w = run(w, b2, NOON(D), op("answer", { cardId: "a1", ok: false }));
  assert.equal(lab(w, b2, "a1").info.variation, "a3", "不拿今天練過的 a2");
});

test("V14 讀存檔失敗時開新一輪：同樣不留待存，之後作答不會補開把原本那一輪換掉（Codex 審 b6c9b5e F4 延伸）", () => {
  const b = B6(); const mem = flakyStorage();
  const S = C.createStore({ storage: mem, bank: b, clock: () => NOON(D) }); S.load();
  assert.ok(S.dispatch(op("sessionStart", { kind: "review", ids: ["a1", "a2"], pick: "again" })).ok);
  mem.setRead(true);
  const r = S.dispatch(op("sessionStart", { kind: "review", ids: ["b1", "b2"] }));
  assert.deepEqual([r.ok, r.error, S.get().pendingAction], [false, "SAVE_FAILED", null]);
  mem.setRead(false);
  assert.ok(S.dispatch(op("answer", { cardId: "a1", ok: true })).ok);
  assert.equal(S.get().state.session.pick, "again");
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
  s = run(s, B12, NOON(D), op("makeupClaim", { answerDay: D, day: MK, ids: s.session.answered }));
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
  assert.equal(C.reduce(s, op("makeupClaim", { answerDay: D, day: MK, ids: ["c12", 5, null] }), env(B12, NOON(D))).error, "MAKEUP_NONE", "c12 今天沒練過");
  assert.equal(C.reduce(s, op("makeupClaim", { answerDay: D, day: MK, ids: [todayCard] }), env(B12, NOON(D))).error, "MAKEUP_NONE", "今天計畫的卡不能借去補別天");
  const r = C.reduce(s, op("makeupClaim", { answerDay: D, day: MK, ids: "c1" }), env(B12, NOON(D)));
  assert.equal(r.error, "MAKEUP_NONE"); assert.equal(r.state.days[MK], undefined);
});

test("T04（Codex 第 3 輪 a）兩分頁各補不同日子、排到同一張卡：第一個結算拿走那張卡，第二個拒絕、不會誤報完成", () => {
  let s = doneToday(BM6);
  s = run(s, BM6, NOON(D), op("sessionStart", { kind: "makeup", day: MK }));            // A
  assert.deepEqual(s.session.queue, ["c6"]);
  s = run(s, BM6, NOON(D), op("sessionStart", { kind: "makeup", day: "2026-10-19" }));  // B 換掉共用回合
  s = run(s, BM6, NOON(D), op("answer", { cardId: "c6", ok: true }));                    // A 作答（不帶日子）
  s = run(s, BM6, NOON(D), op("makeupClaim", { answerDay: D, day: MK, ids: ["c6"] }));                 // A 結算
  assert.deepEqual(s.days[MK].touched, ["c6"]);
  const r = C.reduce(s, op("makeupClaim", { answerDay: D, day: "2026-10-19", ids: ["c6"] }), env(BM6, NOON(D)));   // B 結算
  assert.equal(r.error, "MAKEUP_NONE"); assert.equal(r.state.days["2026-10-19"], undefined);
  assert.ok(C.missedDays(s, "2026-10-17", D).includes("2026-10-19"), "10/19 照樣可以再補");
});

test("T05（Codex 第 3 輪 b）B 一般複習先答補做卡、A 再答同卡：那張卡今天練過，結算照樣算進補做日（touched 與 doneIds 一致）", () => {
  let s = doneToday(BM6);
  s = run(s, BM6, NOON(D), op("sessionStart", { kind: "makeup", day: MK }));
  s = run(s, BM6, NOON(D), op("sessionStart", { kind: "review", ids: ["c6"] }));
  s = run(s, BM6, NOON(D), op("answer", { cardId: "c6", ok: true }));
  s = run(s, BM6, NOON(D), op("answer", { cardId: "c6", ok: true }));
  s = run(s, BM6, NOON(D), op("makeupClaim", { answerDay: D, day: MK, ids: ["c6"] }));
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
  s = finishRound(s, B12); s = run(s, B12, NOON(D), op("makeupClaim", { answerDay: D, day: MK, ids: s.session.answered }));
  assert.equal(s.days[D].extraDone, true, "補做時多練的卡算今天加碼（範圍調整：她今天確實多練了）");
  let t = doneToday(B12);
  t = run(t, B12, NOON(D), op("teach", { cardId: t.days[D].planIds[0] }));
  assert.equal(t.days[D].extraDone, true);
});

test("T08（Codex 第 1 輪）那天原本有實驗、考考爸媽、心情（沒答卡）：結算後照留", () => {
  let s = doneToday(B12);
  s.days[MK] = { planIds: [], doneIds: [], touched: [], extraDone: false, labRuns: 1, teach: 2, mood: "good" };
  s = run(s, B12, NOON(D), op("sessionStart", { kind: "makeup", day: MK }));
  s = finishRound(s, B12); s = run(s, B12, NOON(D), op("makeupClaim", { answerDay: D, day: MK, ids: s.session.answered }));
  assert.equal(s.days[MK].labRuns, 1); assert.equal(s.days[MK].teach, 2); assert.equal(s.days[MK].mood, "good");
  assert.equal(s.days[MK].touched.length, 5);
  assert.deepEqual(C.checkState(s, B12), []);
});

test("T09（Codex 第 1 輪）日曆的補做色只看 days[那天].madeUp（不靠作答紀錄，log 截斷也不誤標）；正常練的日子沒有 madeUp", () => {
  let s = doneToday(B12);
  s = run(s, B12, NOON(D), op("sessionStart", { kind: "makeup", day: MK }));
  s = finishRound(s, B12); s = run(s, B12, NOON(D), op("makeupClaim", { answerDay: D, day: MK, ids: s.session.answered }));
  assert.equal(s.days[D].madeUp, undefined); assert.equal(s.days[MK].madeUp, D);
  s.log = [];   // 模擬作答紀錄被截斷
  assert.equal(s.days[MK].madeUp, D); assert.deepEqual(C.checkState(s, B12), []);
});

test("T10（Codex 第 1 輪）壞存檔：days 不是物件、madeUp 壞掉、session.makeup 配錯回合種類 ⇒ 讀檔檢查回報錯誤、不拋例外", () => {
  let s = doneToday(B12);
  s = run(s, B12, NOON(D), op("sessionStart", { kind: "makeup", day: MK }));
  s = finishRound(s, B12); s = run(s, B12, NOON(D), op("makeupClaim", { answerDay: D, day: MK, ids: s.session.answered }));
  const cases = [
    (x) => { x.days = null; }, (x) => { x.days = 5; },
    (x) => { x.days[MK].madeUp = MK; }, (x) => { x.days[MK].madeUp = "10/20"; }, (x) => { x.days[MK].touched = []; x.days[MK].doneIds = []; },
    (x) => { x.session.kind = "plan"; }, (x) => { x.session.makeup = "x"; },
  ];
  cases.forEach((f, i) => { const x = JSON.parse(JSON.stringify(s)); f(x); let e; assert.doesNotThrow(() => { e = C.checkState(x, B12); }); assert.ok(e.length > 0, "case " + i); });
});

// 2026-10-18 契約反轉（設計報告 (C)8／T17，Codex 審 8364a83）：原本要舊版核心讀得懂新存檔，結果舊頁會照舊規則剪掉新版計畫。
// 現在存檔升 v4：舊核心（只認 v3）一律拒讀＝不寫；新核心讀得懂舊核心寫的 v3，寫回一律 v4
test("T11 舊版核心（d7d1d78）讀新版存檔一律拒讀；新版讀得懂舊版的 v3", () => {
  let s = doneToday(B12);
  s = run(s, B12, NOON(D), op("sessionStart", { kind: "makeup", day: MK }));
  assert.equal(s.v, 4);
  assert.ok(OLD.checkState(s, B12).length > 0, "舊核心拒讀 v4");
  const old3 = OLD.reduce(OLD.blankState(), op("tick"), { bank: B12, now: NOON(D) }).state;
  assert.equal(old3.v, 3);
  const r = C.decode(JSON.stringify(old3), B12);
  assert.ok(r.accepted); assert.equal(r.state.v, 4);
});

test("T12 跨午夜：10/20 開補做、10/21 才做完 ⇒ 昨天答的卡不算；一張都不算就拒絕，10/18 仍可補（沒有死路）", () => {
  let s = doneToday(B12);
  s = run(s, B12, NOON(D), op("sessionStart", { kind: "makeup", day: MK }));
  const ids = s.session.queue.slice();
  ids.forEach((id) => { s = run(s, B12, NOON(D), op("answer", { cardId: id, ok: true })); });
  const D2 = "2026-10-21";
  // 2026-10-18（Codex 審 8364a83 T16）：結算請求帶作答日（回合那天＝D）；隔天才送＝拒領 MAKEUP_STALE。假報成 D2 答的也查無作答＝MAKEUP_NONE
  assert.equal(C.reduce(s, op("makeupClaim", { answerDay: D, day: MK, ids }), env(B12, NOON(D2))).error, "MAKEUP_STALE");
  const r = C.reduce(s, op("makeupClaim", { answerDay: D2, day: MK, ids }), env(B12, NOON(D2)));
  assert.equal(r.error, "MAKEUP_NONE");
  s = run(s, B12, NOON(D2), op("tick"));
  assert.ok(C.missedDays(s, "2026-10-17", D2).includes(MK));
});

test("T13 同一份補做卡不能結算兩個日子；同一天重複結算被擋（MAKEUP_DAY）", () => {
  let s = doneToday(B12);
  s = run(s, B12, NOON(D), op("sessionStart", { kind: "makeup", day: MK }));
  s = finishRound(s, B12); const ids = s.session.answered.slice();
  s = run(s, B12, NOON(D), op("makeupClaim", { answerDay: D, day: MK, ids }));
  assert.equal(C.reduce(s, op("makeupClaim", { answerDay: D, day: MK, ids }), env(B12, NOON(D))).error, "MAKEUP_DAY");
  assert.equal(C.reduce(s, op("makeupClaim", { answerDay: D, day: "2026-10-19", ids }), env(B12, NOON(D))).error, "MAKEUP_NONE");
});

test("T14 補做排卡：新卡（不含今天計畫、今天碰過的）；新卡用完排練過沒畢業、今天沒碰過的；都沒有才說沒卡可補", () => {
  const b5 = bank(["a1", "a2", "a3", "a4", "a5"]);
  assert.equal(C.reduce(doneToday(b5), op("sessionStart", { kind: "makeup", day: MK }), env(b5, NOON(D))).error, "MAKEUP_EMPTY");
  const b8 = bank(["a1", "a2", "a3", "a4", "a5", "a6", "a7", "a8"]);
  let s = doneToday(b8);
  // 2026-10-18（#2696）排程改隔 3 天：a1–a5 10/23 到期並學會，a6–a8 當天第一次練；10/24 補做只剩練過沒學會、今天沒碰過的 a6–a8
  s = run(s, b8, NOON("2026-10-23"), op("tick")); s.days["2026-10-23"].planIds.forEach((id) => { s = run(s, b8, NOON("2026-10-23"), op("answer", { cardId: id, ok: true })); });
  assert.deepEqual(s.days["2026-10-23"].planIds, ["a1", "a2", "a3", "a4", "a5", "a6", "a7", "a8"]);
  // 2026-10-18（Codex 審 4d061e3）：補做只排「已到期」的練過卡——a6–a8 10/23 答對、10/26 到期；10/24 還沒到期不排（M07a 另測），改在 10/26 驗
  assert.equal(C.reduce(s, op("sessionStart", { kind: "makeup", day: MK }), env(b8, NOON("2026-10-24"))).error, "MAKEUP_EMPTY", "沒到期的不提早出");
  // 到期卡平常都在當天計畫裡；補做排得到的練過卡＝已到期、沒排進今天計畫（例如計畫已固定後才逾期）、今天沒碰過的
  const T24 = "2026-10-24";
  s.days[T24] = { planIds: ["a1"], doneIds: ["a1"], touched: ["a1"], extraDone: false, labRuns: 0, teach: 0, mood: null };
  s.cards.a6 = learned(1, ["2026-10-23"], "2026-10-26");   // 沒到期
  s.cards.a7 = learned(1, ["2026-10-20"], "2026-10-23");   // 逾期、不在今天計畫
  s.cards.a8 = learned(1, ["2026-10-20"], "2026-10-23"); s.days[T24].touched.push("a8");   // 逾期但今天碰過
  s = run(s, b8, NOON(T24), op("sessionStart", { kind: "makeup", day: MK }));
  assert.deepEqual(s.session.queue.slice(), ["a7"], "新卡用完 → 只排練過沒學會、已到期、今天沒碰過的");
});

test("T15 補做回合答錯照一般規則：進「再練答錯的」、換一題確認都可；作答與加碼都記今天", () => {
  let s = doneToday(B12);
  s = run(s, B12, NOON(D), op("sessionStart", { kind: "makeup", day: MK }));
  const c0 = s.session.queue[0];
  s = run(s, B12, NOON(D), op("answer", { cardId: c0, ok: false }));
  assert.deepEqual(s.session.wrong, [c0]);
  // 2026-10-18（Codex 審 3704a12 B7）：做到一半的補做不得被新回合覆蓋 ⇒ 先把這一輪補做答完，再按「再練答錯的」
  assert.equal(C.reduce(s, op("sessionStart", { kind: "redo", ids: [c0] }), env(B12, NOON(D))).error, "MAKEUP_IN_PROGRESS");
  while (s.session.queue.length && !s.session.halted) s = run(s, B12, NOON(D), op("answer", { cardId: s.session.queue[0], ok: true }));
  // 答完、還沒結算＝待結算的補做也不得被覆寫（Codex 審 6b45578 F1）；畫面的結束頁本來就先結算才出現「再練答錯的」
  assert.equal(C.reduce(s, op("sessionStart", { kind: "redo", ids: [c0] }), env(B12, NOON(D))).error, "MAKEUP_IN_PROGRESS");
  s = run(s, B12, NOON(D), op("makeupClaim", { answerDay: D, day: MK, ids: [c0] }));
  assert.deepEqual(s.days[MK].touched, [c0], "答錯的卡今天也練過了，結算算數");
  s = run(s, B12, NOON(D), op("sessionStart", { kind: "redo", ids: [c0] }));
  assert.equal(s.session.makeup, undefined);
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
  s = run(s, b1, NOON(D), op("makeupClaim", { answerDay: D, day: "2026-10-19", ids: s.session.answered.slice() }));
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
  s = run(s, cut, NOON(D), op("makeupClaim", { answerDay: D, day: "2026-10-19", ids: s.session.answered.slice() }));
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
  s = run(s, gone, NOON(D), op("makeupClaim", { answerDay: D, day: "2026-10-19", ids: s.session.answered.slice() }));
  assert.deepEqual(s.days["2026-10-19"].touched, [q[0]]);
  assert.equal(C.view(s, env(gone, NOON(D))).makeupPending, null, "結算後入口消失");
  assert.equal(C.reduce(s, op("makeupClaim", { answerDay: D, day: "2026-10-19", ids: [q[0]] }), env(gone, NOON(D))).error, "MAKEUP_DAY", "重送不重複");
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
  // 2026-10-18（Codex 審 3704a12 B7）：A 的 10/18 補做做到一半，B 換成補 10/19＝覆寫進行中的補做 ⇒ core 拒絕
  assert.equal(C.reduce(s, op("sessionStart", { kind: "makeup", day: "2026-10-19" }), env(cut, NOON(D))).error, "MAKEUP_IN_PROGRESS");
  s = run(s, cut, NOON(D), op("tick"));
  assert.ok(!s.days["2026-10-18"] && !s.days["2026-10-19"], "沒有自動結算");
  s = run(s, cut, NOON(D), op("makeupClaim", { answerDay: D, day: "2026-10-18", ids: [a] }));
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
  s = run(s, full, NOON(D), op("makeupClaim", { answerDay: D, day: "2026-10-19", ids: ["m1"] }));
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

// ===== 2026-10-18 第 3 輪（4agent 4B-20261018-g5r2 方案；Codex 審 8364a83／4d061e3／a7aa191／ca33987 的 FAIL 原重現）=====
test("M01 計畫裡有題目已不在題庫：planStatus＝complete_missing，首頁不得說「全部完成」", () => {
  const b = bank(["s1"]); let s = C.blankState();
  s.days[D] = { planIds: ["gone", "s1"], doneIds: [], touched: [], extraDone: false, labRuns: 0, teach: 0, mood: null };
  s = run(s, b, NOON(D), op("answer", { cardId: "s1", ok: true }));
  const v = C.view(s, env(b, NOON(D)));
  assert.deepEqual([v.planStatus, v.missingIds, v.completed], ["complete_missing", ["gone"], true]);
  const v2 = C.view(run(C.blankState(), b, NOON(D), op("answer", { cardId: "s1", ok: true })), env(b, NOON(D)));
  assert.equal(v2.planStatus, v2.completed ? "complete" : "open");
  assert.equal(C.view(C.blankState(), env(bank([]), NOON(D))).planStatus, "empty");
});
test("M02 第 2 個答對日學會：作答回饋 graduated＝真（Codex 審 8364a83：排程停了、回饋還說沒學會）", () => {
  const b = bank(["s1"]);
  let r = C.reduce(C.blankState(), op("answer", { cardId: "s1", ok: true }), env(b, NOON(D)));
  assert.equal(!!r.info.graduated, false);
  r = C.reduce(r.state, op("answer", { cardId: "s1", ok: true }), env(b, NOON("2026-10-23")));
  assert.deepEqual([r.state.cards.s1.due, !!r.info.graduated], [null, true]);
});
test("M04 兩個分頁交錯寫入：沒拿到寫入權的分頁唯讀（READONLY、零寫入），拿到的照常寫；不會兩邊都報成功卻漏紀錄", () => {
  const disk = memStorage(), b = bank(["s1", "s2"]); let owner = "A";
  const mk = (name) => C.createStore({ storage: disk, bank: b, clock: () => NOON(D), lock: { held: () => owner === name } });
  const A = mk("A"), B = mk("B"); A.load(); B.load();
  const rb = B.dispatch(op("answer", { cardId: "s2", ok: true }));
  assert.deepEqual([rb.ok, rb.error, disk.writes()], [false, "READONLY", 0]);
  const ra = A.dispatch(op("answer", { cardId: "s1", ok: true }));
  assert.ok(ra.ok); assert.equal(JSON.parse(disk.raw[Object.keys(disk.raw)[0]]).cards.s1.seen, 1);
  owner = "B";                                     // A 關掉、B 拿到寫入權：先換成磁碟最新版再寫，A 的作答不會被蓋掉
  B.reload(); assert.ok(B.dispatch(op("answer", { cardId: "s2", ok: true })).ok);
  const saved = JSON.parse(disk.raw[Object.keys(disk.raw)[0]]);
  assert.deepEqual([saved.cards.s1.seen, saved.cards.s2.seen], [1, 1]);
  assert.equal(B.discardBroken(), false);
});
test("M05 結算寫入失敗、隔天才重試：拒領（MAKEUP_STALE），補做日不會被記成隔天", () => {
  let s = doneToday(B12);
  s = run(s, B12, NOON(D), op("sessionStart", { kind: "makeup", day: MK }));
  s = finishRound(s, B12);
  const disk = memStorage({ "g5soc.v1": JSON.stringify(s) }); let now = NOON(D);
  const st = C.createStore({ storage: disk, bank: B12, clock: () => now }); st.load();
  disk.setFail(true);
  const claim = op("makeupClaim", { answerDay: D, day: MK, ids: s.session.answered.slice() });
  assert.equal(st.dispatch(claim).ok, false);
  disk.setFail(false); now = NOON("2026-10-21");
  const r = st.retry();
  assert.equal(r.error, "MAKEUP_STALE");
  assert.equal(JSON.parse(disk.raw["g5soc.v1"]).days[MK], undefined, "10/18 仍未結算、可再補");
});
test("M06 已開著的舊頁（只認 v3）：磁碟換成 v4 後再 tick／作答＝拒寫，磁碟逐字不變", () => {
  const b = bank(["gone", "k"]), key = "g5soc.v1";
  const old3 = OLD.reduce(OLD.blankState(), op("tick"), { bank: b, now: NOON(D) }).state;
  const disk = memStorage({ [key]: JSON.stringify(old3) });
  const oldStore = OLD.createStore({ storage: disk, bank: b, clock: () => NOON(D) }); oldStore.load();
  const neu = C.createStore({ storage: disk, bank: b, clock: () => NOON(D) }); neu.load();
  assert.ok(neu.dispatch(op("answer", { cardId: "k", ok: true })).ok);
  const after = disk.raw[key]; assert.equal(JSON.parse(after).v, 4);
  const w0 = disk.writes();
  assert.equal(oldStore.dispatch(op("tick")).ok, false);
  assert.equal(oldStore.dispatch(op("answer", { cardId: "k", ok: true })).ok, false);
  assert.deepEqual([disk.raw[key], disk.writes()], [after, w0]);
});
test("M07a 補做不提早出沒到期的卡（Codex 審 4d061e3：答對隔天補做又答對＝提早學會）", () => {
  const b = bank(["s1"]); let s = run(C.blankState(), b, NOON(D), op("answer", { cardId: "s1", ok: true }));
  assert.equal(s.cards.s1.due, "2026-10-23");
  ["2026-10-21", "2026-10-22"].forEach((d) => {
    const r = C.reduce(s, op("sessionStart", { kind: "makeup", day: "2026-10-19" }), env(b, NOON(d)));
    assert.ok(r.error || !r.state.session.queue.includes("s1"), d);
  });
});
test("M07b 作答紀錄截斷後：已被補做結算用掉的卡，同一天補別的日子不再排出來", () => {
  let s = doneToday(B12);
  s = run(s, B12, NOON(D), op("sessionStart", { kind: "makeup", day: MK }));
  s = finishRound(s, B12); const used = s.session.answered.slice();
  s = run(s, B12, NOON(D), op("makeupClaim", { answerDay: D, day: MK, ids: used }));
  s.log = [];                                      // 截斷
  // 讓「新卡用完、只剩練過的」：其餘卡都學會，另放一張逾期、不在今天計畫的 z ⇒ 必定走到練過卡那一行（不靠報錯空轉）
  B12.cards.forEach((c) => { if (!used.includes(c.id) && !s.days[D].planIds.includes(c.id)) s.cards[c.id] = learned(2, ["2026-10-10", "2026-10-13"], null); });
  const bz = { cards: B12.cards.concat([card("z")]), concepts: B12.concepts, figs: B12.figs };
  s.cards.z = learned(1, ["2026-10-14"], "2026-10-17");
  used.forEach((id) => { s.cards[id].due = D; });   // 就算到期，也已被 10/18 結算用掉
  s = run(s, bz, NOON(D), op("sessionStart", { kind: "makeup", day: "2026-10-17" }));
  assert.deepEqual(s.session.queue, ["z"], "已用過的卡不再排");
});
test("M09 跨日：昨天沒答完的回合帶著停止出新的題，今天母體與階段一致（Codex 審 8364a83 R2b）", () => {
  const cut = abank(["x", "k"], ["k"]); let s = C.blankState();
  s.cards.k = learned(1, ["2026-10-19"], "2026-10-22");
  s.days["2026-10-19"] = { planIds: ["x", "k"], doneIds: ["k"], touched: ["k"], extraDone: false, labRuns: 0, teach: 0, mood: null };
  s.session = { day: "2026-10-19", kind: "plan", queue: ["x"], answered: ["k"], wrong: [], kinds: {} };
  assert.deepEqual(C.poolCards(s, cut, D).map((c) => c.id), ["k"]);
  assert.equal(C.view(s, env(cut, NOON(D))).stages["1-1"], 2, "全部見過＝長葉，與母體 1／1 一致");
});

test("M04b 開頁時寫入權還沒決定：唯讀頁不搬 v1 舊存檔（零寫入）；拿到寫入權才搬，磁碟已有別頁搬好的新版就直接讀（Codex 審 8b894c2 B6）", () => {
  const b = bank(["s1", "s2"]);
  const v1 = JSON.stringify({ v: 1, cards: { s1: { box: 1, streak: 1, due: "2026-10-21", seen: 1, right: 1, wrong: 0, retired: false } }, unit3: false, extra: [], prefs: { sound: true } });
  const disk = memStorage({ [C.LS_V1]: v1 }); let owner = "A";
  const mk = (name) => C.createStore({ storage: disk, bank: b, clock: () => NOON(D), lock: { held: () => owner === name } });
  const B = mk("B"); B.load();
  assert.equal(disk.writes(), 0, "唯讀頁開頁不搬家");
  assert.equal(B.get().state.cards.s1.seen, 1, "畫面照樣看得到搬好的樣子");
  const A = mk("A"); A.load();
  assert.ok(disk.raw[C.LS_KEY], "寫入頁開頁就搬");
  assert.ok(A.dispatch(op("answer", { cardId: "s2", ok: true })).ok);
  const saved = disk.raw[C.LS_KEY], w0 = disk.writes();
  assert.equal(B.dispatch(op("tick")).error, "READONLY");
  assert.deepEqual([disk.raw[C.LS_KEY], disk.writes()], [saved, w0], "唯讀頁不蓋掉 A 剛存的作答");
  owner = "B"; B.reload();
  assert.equal(B.get().state.cards.s2.seen, 1, "接手後讀到 A 的作答，不是自己記憶體裡的 v1 搬家版");
  assert.ok(B.dispatch(op("tick")).ok);
  assert.equal(JSON.parse(disk.raw[C.LS_KEY]).cards.s2.seen, 1);
});
test("M04c 單頁：寫入權晚到（開頁時還沒拿到），拿到後 reload 才把 v1 搬進新版", () => {
  const b = bank(["s1"]);
  const v1 = JSON.stringify({ v: 1, cards: { s1: { box: 1, streak: 1, due: "2026-10-21", seen: 1, right: 1, wrong: 0, retired: false } }, unit3: false, extra: [], prefs: { sound: true } });
  const disk = memStorage({ [C.LS_V1]: v1 }); let held = false;
  const S = C.createStore({ storage: disk, bank: b, clock: () => NOON(D), lock: { held: () => held } }); S.load();
  assert.equal(disk.raw[C.LS_KEY], undefined);
  held = true; S.reload();
  assert.equal(JSON.parse(disk.raw[C.LS_KEY]).cards.s1.seen, 1);
  assert.equal(disk.raw[C.LS_V1], v1, "v1 原文不動");
});

test("M10 補做進行中（今天、還有題、沒停輪、至少答過一題）不得被別的回合覆蓋——待存的作答也算（Codex 審 3704a12 B7）", () => {
  let s = doneToday(B12);
  s = run(s, B12, NOON(D), op("sessionStart", { kind: "makeup", day: MK }));
  const disk = memStorage({ [C.LS_KEY]: JSON.stringify(s) });
  const st = C.createStore({ storage: disk, bank: B12, clock: () => NOON(D) }); st.load();
  const first = st.get().state.session.queue[0];
  assert.equal(C.makeupInProgress(st.get().state, D), false, "一題都沒答＝不算進行中（被取代不會遺失）");
  disk.setFail(true);
  assert.equal(st.dispatch(op("answer", { cardId: first, ok: true })).ok, false, "首題寫入失敗、留在待存");
  disk.setFail(false);
  const r = st.dispatch(op("sessionStart", { kind: "review", ids: [B12.cards[0].id] }));
  assert.equal(r.error, "MAKEUP_IN_PROGRESS");
  const saved = JSON.parse(disk.raw[C.LS_KEY]).session;
  assert.deepEqual([saved.makeup, saved.answered], [MK, [first]], "待存作答補存了、補做回合與歸屬還在");
  assert.equal(C.makeupInProgress(JSON.parse(disk.raw[C.LS_KEY]), D), true);
  const halted = JSON.parse(disk.raw[C.LS_KEY]); halted.session.halted = true;
  assert.equal(C.makeupInProgress(halted, D), false, "停輪的走結算入口，不算進行中");
});


test("M11 待存的最後一題補存後補做變成待結算（或停輪）：新回合照樣不得覆寫，結算入口留著（Codex 審 6b45578／908ca98／07d638a F1）", () => {
  let s = doneToday(B12);
  s = run(s, B12, NOON(D), op("sessionStart", { kind: "makeup", day: MK }));
  while (s.session.queue.length > 1) s = run(s, B12, NOON(D), op("answer", { cardId: s.session.queue[0], ok: true }));
  const last = s.session.queue[0];
  const disk = memStorage({ [C.LS_KEY]: JSON.stringify(s) });
  const st = C.createStore({ storage: disk, bank: B12, clock: () => NOON(D) }); st.load();
  disk.setFail(true);
  assert.equal(st.dispatch(op("answer", { cardId: last, ok: true })).ok, false, "最後一題寫入失敗、留在待存");
  disk.setFail(false);
  const r = st.dispatch(op("sessionStart", { kind: "review", ids: [B12.cards[0].id] }));
  assert.equal(r.error, "MAKEUP_IN_PROGRESS");
  const saved = JSON.parse(disk.raw[C.LS_KEY]);
  assert.deepEqual([saved.session.makeup, saved.session.queue.length, saved.session.answered.includes(last)], [MK, 0, true]);
  assert.equal(C.view(saved, env(B12, NOON(D))).makeupPending, MK, "結算入口還在");
  const after = run(saved, B12, NOON(D), op("makeupClaim", { answerDay: D, day: MK, ids: saved.session.answered }));
  assert.ok(run(after, B12, NOON(D), op("sessionStart", { kind: "review", ids: B12.cards.map((c) => c.id) })).session, "結算後就能開新回合");   // 小考複習只出沒做過的（2026-10-19），用整份題庫才排得到
});

test("V15 補做回合不套小考複習「只出沒做過的」篩選：佇列裡練過的到期題續接時照留（突變自檢補測；補做規則另由 makeupCards 決定）", () => {
  let s = doneToday(BM6);
  s.session = { day: D, kind: "review", queue: [BM6.cards[0].id, BM6.cards[1].id], answered: [], wrong: [], kinds: {}, makeup: MK };
  assert.deepEqual(C.checkState(s, BM6), []);
  assert.deepEqual(C.view(s, env(BM6, NOON(D))).session.queue, [BM6.cards[0].id, BM6.cards[1].id]);
});

/* ---------- Codex 設計者 C 契約驗收矩陣（2026-10-19 審 f5d3498 連 2 輪 FAIL 後依升級階梯；先寫測試再實作）----------
 * 契約：allowedIn＝小考複習回合的共同資格上限（出題取子集、續接、補救換題都問它；variation 標記只管計分）；
 * retry 回報實際結果（真的寫一次，寫得進去才清提示）；開局失敗不留待存。O＝第 1 輪上線的核心（舊分頁／裝置的快取版）。 */
const O = require("./fixtures/core.round1.js");
const xrun = (Cx, st, bk, day, type, extra) => { const r = Cx.reduce(st, op(type, extra), env(bk, NOON(day))); assert.ok(!r.error, type + " " + r.error); return r.state; };
const viaJSON = (Cx, st, bk) => { const r = Cx.decode(JSON.stringify(st), bk); assert.ok(r.accepted, "decode " + JSON.stringify(r.detail)); return r.state; };
const cLab = (Cx, st, bk, id, wanted) => {   // 用指定版本的核心跑完一次「答錯→實驗→換一題確認」
  st = xrun(Cx, st, bk, D, "labStart", { runId: "r" + id, lab: "shadow", tasks: 1, answer: 0, from: "wrong", card: id });
  st = xrun(Cx, st, bk, D, "labPredict", { runId: "r" + id, choice: 0 });
  st = xrun(Cx, st, bk, D, "labTask", { runId: "r" + id, task: 0 });
  const r = Cx.reduce(st, op("labComplete", Object.assign({ runId: "r" + id }, wanted ? { variationId: wanted } : {})), env(bk, NOON(D)));
  assert.ok(!r.error, r.error); return r;
};
function countingStorage(init) {   // 寫入嘗試次數（成功與失敗都算）＋可注入讀寫故障
  const m = Object.assign({}, init || {}); let readFail = false, writeFail = false, attempts = 0;
  return { getItem: (k) => { if (readFail) throw new Error("read"); return k in m ? m[k] : null; },
           setItem: (k, v) => { attempts++; if (writeFail) throw new Error("QuotaExceeded"); m[k] = v; }, removeItem: (k) => { delete m[k]; },
           setRead: (f) => { readFail = f; }, setWrite: (f) => { writeFail = f; }, attempts: () => attempts, raw: m };
}

test("C01 跨模式已答（答對／答錯／提示／不確定 × 每日練習／闖關／再練答錯的）：單元、闖關預設回合都排除；沒按 weak／again 就是 fresh", () => {
  [{ ok: true }, { ok: false }, { ok: true, hint: true }, { ok: true, unsure: true }].forEach((how) => {
    ["plan", "go", "redo"].forEach((mode) => {
      const b = B6(); let s = C.blankState();
      if (mode === "plan") s = run(s, b, NOON(D), op("sessionStart", {}));
      if (mode === "go") s = run(s, b, NOON(D), op("sessionStart", { kind: "review", ids: ["a1", "a2", "a3"] }));
      if (mode === "redo") s = run(s, b, NOON(D), op("sessionStart", { kind: "redo", ids: ["a1"] }));
      s = run(s, b, NOON(D), op("answer", Object.assign({ cardId: "a1" }, how)));
      const u = run(s, b, NOON(D), op("sessionStart", { kind: "review", ids: ALL6 }));
      assert.deepEqual([u.session.queue.includes("a1"), u.session.pick], [false, "fresh"], mode + JSON.stringify(how));
    });
  });
});

test("C02 資格與計數：active 未做／停出未做／待加強／已學會／今天練過／查不到／未開放觀念 → 三種回合題集符合契約；計數＝切段前題數；weak 不混未做題", () => {
  const b = { cards: [card("a1"), card("a2"), card("a3"), card("a4"), card("a5"), card("c1", "3-1")], concepts: CONCEPTS, figs: FIGS, active: { a1: 1, a3: 1, a4: 1, a5: 1, c1: 1 } };
  let s = C.blankState();
  s = run(s, b, NOON("2026-10-15"), op("answer", { cardId: "a4", ok: true }));
  s = run(s, b, NOON("2026-10-18"), op("answer", { cardId: "a4", ok: true }));     // a4 學會（2 個答對日）
  s = run(s, b, NOON("2026-10-19"), op("answer", { cardId: "a3", ok: false }));    // a3 待加強
  s = run(s, b, NOON(D), op("answer", { cardId: "a5", ok: false }));               // a5 今天練過
  const ids = ["a1", "a2", "a3", "a4", "a5", "zz", "c1"];
  const pick = (p) => { const r = C.reduce(s, op("sessionStart", { kind: "review", ids, pick: p }), env(b, NOON(D))); return r.error ? [] : r.state.session.queue; };
  assert.deepEqual([pick("fresh"), pick("weak"), pick("again")], [["a1"], ["a3"], ["a1", "a4", "a3"]]);
  const c = C.reviewCounts(s, b, ids.filter((id) => !!C.cardById(s, b, id)), D);
  assert.deepEqual([c.fresh, c.weakNow, c.againNow], [1, 1, 3]);
  // C02b（Codex 審 c07244c F2）：27 題候選——三種計數都是 27（切段前），開一段才是 20
  const many = Array.from({ length: 27 }, (_, i) => "m" + i), bm = { cards: many.map((id) => card(id)), concepts: CONCEPTS, figs: FIGS };
  let sm = C.blankState();
  many.forEach((id) => { sm = run(sm, bm, NOON("2026-10-19"), op("answer", { cardId: id, ok: false })); });   // 全部做過、待加強、今天沒練
  const cm = C.reviewCounts(sm, bm, many, D), cf = C.reviewCounts(C.blankState(), bm, many, D);
  assert.deepEqual([cf.fresh, cm.weakNow, cm.againNow], [27, 27, 27]);
  assert.equal(run(sm, bm, NOON(D), op("sessionStart", { kind: "review", ids: many, pick: "weak", size: 20 })).session.queue.length, 20);
});

test("C03 空題：三種回合各自沒有合格題 → REVIEW_EMPTY，不建空回合、原回合不變、不自動換成別種", () => {
  const b = B6(); let s = C.blankState();
  ALL6.forEach((id) => { s = run(s, b, NOON(D), op("answer", { cardId: id, ok: id !== "a1" })); });   // 全部今天做過
  s = run(s, b, NOON(D), op("sessionStart", { kind: "redo", ids: ["a1"] }));
  const before = JSON.stringify(s);
  ["fresh", "weak", "again"].forEach((p) => {
    const r = C.reduce(s, op("sessionStart", { kind: "review", ids: ALL6, pick: p }), env(b, NOON(D)));
    assert.deepEqual([r.error, JSON.stringify(r.state) === before], ["REVIEW_EMPTY", true], p);
  });
});

test("C04 舊→新：舊核心補救插入做過的題、回合沒有 pick → 新核心載入後 view 與 tick 都排除它；作答歷史不變", () => {
  const b = { cards: [card("s1"), card("s2"), card("s3")], concepts: CONCEPTS, figs: FIGS };
  let o = O.blankState();
  o = xrun(O, o, b, "2026-10-19", "answer", { cardId: "s1", ok: true });
  o = xrun(O, o, b, D, "sessionStart", { kind: "review", ids: ["s1", "s2", "s3"] });
  o = xrun(O, o, b, D, "answer", { cardId: "s2", ok: false });
  o = cLab(O, o, b, "s2").state;
  assert.deepEqual([o.session.queue, o.session.kinds.s1], [["s1", "s3"], "variation"], "前置：舊核心確實插回做過的 s1");
  const n = viaJSON(C, o, b);
  assert.deepEqual(C.view(n, env(b, NOON(D))).session.queue, ["s3"]);
  const t = run(n, b, NOON(D), op("tick"));
  assert.deepEqual([t.session.queue, t.session.answered, t.session.wrong], [["s3"], ["s2"], ["s2"]]);
  assert.deepEqual([t.cards, t.log, t.days], [o.cards, o.log, o.days], "作答歷史整份不變（Codex 審 c07244c F2）");
});

test("C05 新→舊→新：新核心的 fresh 回合交給舊核心續接並補救插題，再交回 → pick 照用、做過的題排除；舊核心另開的回合（沒有 pick）新核心當 fresh", () => {
  const b = { cards: [card("s1"), card("s2"), card("s3")], concepts: CONCEPTS, figs: FIGS };
  let n = C.blankState();
  n = run(n, b, NOON("2026-10-19"), op("answer", { cardId: "s1", ok: true }));
  n = run(n, b, NOON(D), op("sessionStart", { kind: "review", ids: ["s1", "s2", "s3"] }));
  let o = viaJSON(O, n, b);
  o = xrun(O, o, b, D, "answer", { cardId: "s2", ok: false });
  o = cLab(O, o, b, "s2").state;
  assert.equal(o.session.kinds.s1, "variation");
  const back = viaJSON(C, o, b), v = C.view(back, env(b, NOON(D))).session;
  assert.deepEqual([v.pick, v.queue], ["fresh", ["s3"]]);
  const o2 = xrun(O, viaJSON(O, back, b), b, D, "sessionStart", { kind: "review", ids: ["s1", "s2", "s3"], pick: "again" });   // 舊核心開的「全部再練一遍」：存檔沒有 pick
  assert.ok(o2.session.queue.includes("s1") && o2.session.pick === undefined, "前置：舊核心的 again 回合含做過的 s1、沒有 pick");
  assert.deepEqual(C.view(viaJSON(C, o2, b), env(b, NOON(D))).session.queue.includes("s1"), false, "新核心當 fresh");
});

test("C06 標記不能豁免：同一份不合格候選標普通或 variation，續接結果相同；合格的變式照留且保有 variation 計分語意", () => {
  const b = B6(); let s = C.blankState();
  s = run(s, b, NOON("2026-10-19"), op("answer", { cardId: "a1", ok: true }));
  s = run(s, b, NOON("2026-10-19"), op("answer", { cardId: "a2", ok: false }));
  const mk = (kinds, pick, queue) => Object.assign(JSON.parse(JSON.stringify(s)), { session: { day: D, kind: "review", pick, queue, answered: [], wrong: [], kinds } });
  assert.deepEqual([C.view(mk({}, "fresh", ["a1", "a3"]), env(b, NOON(D))).session.queue, C.view(mk({ a1: "variation" }, "fresh", ["a1", "a3"]), env(b, NOON(D))).session.queue], [["a3"], ["a3"]]);
  const w = mk({ a3: "variation" }, "weak", ["a3", "a2"]);
  assert.deepEqual(C.checkState(w, b), []);
  const wv = C.view(w, env(b, NOON(D))).session;
  assert.deepEqual([wv.queue, wv.kinds.a3], [["a3", "a2"], "variation"]);
  const va = C.reduce(w, op("answer", { cardId: "a3", ok: true }), env(b, NOON(D)));
  assert.deepEqual([va.info.variation, va.state.cards.a3.goodDays, va.state.log[va.state.log.length - 1].variation], [true, [], true], "合格變式照 variation 計分：答對不記有效日（Codex 審 c07244c F2）");
});

test("C07 整份替換（同步換進別台的存檔）後續接：照新讀入的作答歷史重算題集與計數", () => {
  const b = B6(); let s1 = C.blankState();
  s1 = run(s1, b, NOON(D), op("sessionStart", { kind: "review", ids: ALL6 }));
  const mem = memStorage({ [C.LS_KEY]: JSON.stringify(s1) });
  const st = C.createStore({ storage: mem, bank: b, clock: () => NOON(D) }); st.load();
  let s2 = run(JSON.parse(JSON.stringify(s1)), b, NOON(D), op("answer", { cardId: "a2", ok: true }));   // 別台做過 a2
  s2.session = JSON.parse(JSON.stringify(s1.session));                                                 // 回合照舊（佇列還有 a2）
  mem.raw[C.LS_KEY] = JSON.stringify(s2);
  assert.ok(st.dispatch({ type: "tick" }).ok);
  assert.deepEqual([st.get().state.session.queue.includes("a2"), C.reviewCounts(st.get().state, b, ALL6, D).fresh], [false, 5]);
});

test("C08 fresh 補救：候選有做過、停出未做、active 未做，且指定不合格的 variationId → 只選合格未做題；已在佇列的移到前面不重複", () => {
  const b = { cards: [card("a1"), card("a2"), card("a3"), card("a4"), card("a5")], concepts: CONCEPTS, figs: FIGS, active: { a1: 1, a2: 1, a4: 1, a5: 1 } };
  let s = C.blankState();
  s = run(s, b, NOON("2026-10-19"), op("answer", { cardId: "a1", ok: true }));
  s = run(s, b, NOON(D), op("sessionStart", { kind: "review", ids: ["a2", "a5"] }));
  s = run(s, b, NOON(D), op("answer", { cardId: "a2", ok: false }));
  const r = cLab(C, s, b, "a2", "a1");
  assert.deepEqual([r.info.variation, r.state.session.queue], ["a5", ["a5"]]);
  let t = C.blankState();   // 佇列裡沒有候選：只能從目錄挑，停出的 a3 排在 a4 前面也不能選（Codex 審 c07244c F2）
  t = run(t, b, NOON("2026-10-19"), op("answer", { cardId: "a1", ok: true }));
  t = run(t, b, NOON("2026-10-19"), op("answer", { cardId: "a5", ok: true }));
  t = run(t, b, NOON(D), op("sessionStart", { kind: "review", ids: ["a2"] }));
  t = run(t, b, NOON(D), op("answer", { cardId: "a2", ok: false }));
  const r2 = cLab(C, t, b, "a2", "a3");
  assert.deepEqual([r2.info.variation, r2.state.session.queue], ["a4", ["a4"]]);
  let u = C.blankState();   // 同觀念全部做過或停出：不換題
  ["a1", "a4", "a5"].forEach((id) => { u = run(u, b, NOON("2026-10-19"), op("answer", { cardId: id, ok: true })); });
  u = run(u, b, NOON(D), op("sessionStart", { kind: "review", ids: ["a2"] }));
  u = run(u, b, NOON(D), op("answer", { cardId: "a2", ok: false }));
  const r3 = cLab(C, u, b, "a2");
  assert.deepEqual([r3.info.variation, r3.state.session.queue], [undefined, []]);
});

test("C09 weak／again 補救：今天練過的一律不選；weak 不取已學會的；可用合格的未做變式，續接後不會自己消失", () => {
  const b = { cards: [card("w1"), card("w2"), card("w3"), card("u1")], concepts: CONCEPTS, figs: FIGS };
  const base = () => {
    let s = C.blankState();
    s = run(s, b, NOON("2026-10-15"), op("answer", { cardId: "w3", ok: true }));
    s = run(s, b, NOON("2026-10-18"), op("answer", { cardId: "w3", ok: true }));   // w3 學會
    s = run(s, b, NOON("2026-10-19"), op("answer", { cardId: "w1", ok: false }));
    s = run(s, b, NOON("2026-10-19"), op("answer", { cardId: "w2", ok: false }));
    return run(s, b, NOON(D), op("answer", { cardId: "w2", ok: false }));            // w2 今天練過
  };
  const ids = ["w1", "w2", "w3", "u1"];
  let w = run(base(), b, NOON(D), op("sessionStart", { kind: "review", ids, pick: "weak" }));
  assert.deepEqual(w.session.queue, ["w1"]);
  w = run(w, b, NOON(D), op("answer", { cardId: "w1", ok: false }));
  let r = cLab(C, w, b, "w1");
  assert.equal(r.info.variation, "u1", "weak：不取今天練過的 w2、不取學會的 w3");
  assert.deepEqual(run(r.state, b, NOON(D), op("tick")).session.queue, ["u1"], "合格變式續接不消失");
  let g = run(base(), b, NOON(D), op("sessionStart", { kind: "review", ids, pick: "again", size: 1 }));
  assert.deepEqual(g.session.queue, ["u1"]);
  g = run(g, b, NOON(D), op("answer", { cardId: "u1", ok: false }));
  r = cLab(C, g, b, "u1");
  assert.equal(r.info.variation, "w1", "again：不取今天練過的 w2；最不熟的先");
  assert.deepEqual(run(r.state, b, NOON(D), op("tick")).session.queue, ["w1"]);
});

test("C10 開局存檔失敗（讀取失敗、寫入失敗各一）：不留待存；原回合與 pick 不變", () => {
  ["read", "write"].forEach((how) => {
    const b = B6(); const mem = flakyStorage();
    const S = C.createStore({ storage: mem, bank: b, clock: () => NOON(D) }); S.load();
    assert.ok(S.dispatch(op("sessionStart", { kind: "review", ids: ["a1", "a2"], pick: "again" })).ok);
    const before = JSON.stringify(S.get().state.session);
    if (how === "read") mem.setRead(true); else mem.setWrite(true);
    const r = S.dispatch(op("sessionStart", { kind: "review", ids: ["b1", "b2"] }));
    assert.deepEqual([r.ok, S.get().pendingAction, JSON.stringify(S.get().state.session) === before], [false, null, true], how);
  });
});

test("C11 持續寫壞時按「再存一次」：確實嘗試寫一次、回失敗、失敗提示不清", () => {
  const b = B6(); const mem = countingStorage();
  const S = C.createStore({ storage: mem, bank: b, clock: () => NOON(D) }); S.load();
  assert.ok(S.dispatch(op("sessionStart", { kind: "review", ids: ["a1"] })).ok);
  mem.setWrite(true);
  assert.equal(S.dispatch(op("sessionStart", { kind: "review", ids: ["b1"] })).ok, false);
  const n0 = mem.attempts(), r = S.retry();
  assert.deepEqual([r.ok, mem.attempts() - n0, S.get().saveStatus], [false, 1, "failed"]);
});

test("C12 沒有待存的失敗狀態、磁碟已被換成 S2 → 恢復後再存一次：寫入的是 S2、成功才清提示；不補開沒開成的回合", () => {
  const b = B6(); const mem = countingStorage();
  const S = C.createStore({ storage: mem, bank: b, clock: () => NOON(D) }); S.load();
  assert.ok(S.dispatch(op("sessionStart", { kind: "review", ids: ["a1"] })).ok);
  mem.setWrite(true);
  assert.equal(S.dispatch(op("sessionStart", { kind: "review", ids: ["b1", "b2"] })).ok, false);
  const s2 = run(JSON.parse(mem.raw[C.LS_KEY]), b, NOON(D), op("answer", { cardId: "a3", ok: true }));   // 同步換進來的新存檔
  mem.raw[C.LS_KEY] = JSON.stringify(s2);
  mem.setWrite(false);
  const n0 = mem.attempts(), r = S.retry();
  assert.deepEqual([r.ok, mem.attempts() - n0, S.get().saveStatus], [true, 1, "ok"]);
  assert.deepEqual([JSON.parse(mem.raw[C.LS_KEY]), S.get().state], [s2, s2], "寫進去的是整份 S2（Codex 審 c07244c F2）");
  assert.equal(S.get().state.session.queue.includes("b1"), false, "沒開成的回合不補開");
});

test("C13 再存一次在唯讀頁、封鎖（讀不懂存檔）、讀取拋錯、磁碟換成壞檔時：零次寫入、回失敗、不清提示、不拿舊記憶體蓋磁碟", () => {
  const b = B6();
  const failed = (lock) => {   // 先造出「沒有待存的失敗狀態」
    const mem = countingStorage();
    const S = C.createStore({ storage: mem, bank: b, clock: () => NOON(D), lock }); S.load();
    assert.ok(S.dispatch(op("sessionStart", { kind: "review", ids: ["a1"] })).ok);
    mem.setWrite(true); assert.equal(S.dispatch(op("sessionStart", { kind: "review", ids: ["b1"] })).ok, false); mem.setWrite(false);
    return { mem, S };
  };
  let held = true; const ro = failed({ held: () => held }); held = false;
  let n0 = ro.mem.attempts(); assert.deepEqual([ro.S.retry().ok, ro.mem.attempts() - n0, ro.S.get().saveStatus], [false, 0, "failed"], "唯讀頁");
  const bl = countingStorage({ [C.LS_KEY]: "{bad" });
  const SB = C.createStore({ storage: bl, bank: b, clock: () => NOON(D) }); SB.load();
  n0 = bl.attempts(); assert.deepEqual([SB.retry().ok, bl.attempts() - n0, SB.get().saveStatus], [false, 0, "blocked"], "封鎖");
  const rd = failed(null); rd.mem.setRead(true);
  n0 = rd.mem.attempts(); assert.deepEqual([rd.S.retry().ok, rd.mem.attempts() - n0, rd.S.get().saveStatus], [false, 0, "failed"], "讀取拋錯");
  const bad = failed(null); bad.mem.raw[C.LS_KEY] = "{bad";
  n0 = bad.mem.attempts(); assert.deepEqual([bad.S.retry().ok, bad.mem.attempts() - n0, bad.S.get().saveStatus, bad.mem.raw[C.LS_KEY]], [false, 0, "failed", "{bad"], "壞檔");
});

test("C14 作答寫入失敗：故障中再存一次仍保留原操作；恢復後只記一次、不重開回合；同 id 重送不重複記", () => {
  const b = B6(); const mem = countingStorage();
  const S = C.createStore({ storage: mem, bank: b, clock: () => NOON(D) }); S.load();
  assert.ok(S.dispatch(op("sessionStart", { kind: "review", ids: ["a1", "a2"] })).ok);
  mem.setWrite(true);
  const A = op("answer", { cardId: "a1", ok: true });
  assert.equal(S.dispatch(A).ok, false);
  assert.deepEqual([S.retry().ok, S.get().pendingAction.id], [false, A.id]);
  mem.setWrite(false);
  assert.ok(S.retry().ok);
  const st = S.get().state;
  assert.deepEqual([st.cards.a1.seen, st.log.filter((e) => e.op === A.id).length, st.ops.filter((x) => x === A.id).length, st.session.queue], [1, 1, 1, ["a2"]]);
  S.dispatch(A);
  assert.equal(S.get().state.cards.a1.seen, 1, "同 id 重送不再記一次");
});

test("C15 跨午夜與 LOG_KEEP：截掉作答紀錄後同日 weak／again 仍排除今天練過的；跨日回合照舊切成當日計畫；重按才重選，fresh 仍排除所有做過的；again 用 touched 排序", () => {
  const b = B6(); let s = C.blankState();
  s = run(s, b, NOON("2026-10-19"), op("answer", { cardId: "a1", ok: false }));
  s = run(s, b, NOON(D), op("answer", { cardId: "a2", ok: false }));
  s = run(s, b, NOON(D), op("answer", { cardId: "b1", ok: true }));
  s = run(s, b, NOON(D), op("sessionStart", { kind: "review", ids: ALL6, pick: "weak" }));
  s.log = [];
  assert.deepEqual(run(s, b, NOON(D), op("sessionStart", { kind: "review", ids: ALL6, pick: "weak" })).session.queue, ["a1"], "今天練過的 a2 不出");
  assert.deepEqual(run(s, b, NOON(D), op("sessionStart", { kind: "review", ids: ALL6, pick: "again" })).session.queue, ["a3", "b2", "b3", "a1"]);
  const D1 = "2026-10-21", n = run(s, b, NOON(D1), op("tick"));
  assert.equal(n.session.kind, "plan", "跨日照既有規則切為當日計畫");
  assert.deepEqual(run(n, b, NOON(D1), op("sessionStart", { kind: "review", ids: ALL6, pick: "weak" })).session.queue.slice().sort(), ["a1", "a2"]);
  assert.deepEqual(run(n, b, NOON(D1), op("sessionStart", { kind: "review", ids: ALL6 })).session.queue, ["a3", "b2", "b3"]);
  assert.deepEqual(run(n, b, NOON(D1), op("sessionStart", { kind: "review", ids: ALL6, pick: "again" })).session.queue, ["a3", "b2", "b3", "a1", "a2", "b1"]);
});

test("C16 補做隔離：未結算、已有作答的補做（佇列含練過的題）經舊新版往返與續接 → 不被小考複習的篩選刪題、不丟已答；結算前新回合被擋，結算後才能開", () => {
  let s = doneToday(B12);
  s = run(s, B12, NOON(D), op("sessionStart", { kind: "makeup", day: MK }));
  s = run(s, B12, NOON(D), op("answer", { cardId: s.session.queue[0], ok: true }));
  s.session.queue = s.session.queue.concat([B12.cards[0].id]);   // 佇列再放一張練過的題（補做的題由 makeupCards 決定，不歸小考複習管）
  const q0 = s.session.queue.slice(), a0 = s.session.answered.slice();
  const back = viaJSON(C, xrun(O, viaJSON(O, s, B12), B12, D, "tick"), B12);
  assert.deepEqual([C.view(back, env(B12, NOON(D))).session.queue, back.session.answered], [q0, a0]);
  const t = run(back, B12, NOON(D), op("tick"));
  assert.deepEqual([t.session.queue, t.session.answered], [q0, a0]);
  assert.equal(C.reduce(t, op("sessionStart", { kind: "review", ids: B12.cards.map((c) => c.id) }), env(B12, NOON(D))).error, "MAKEUP_IN_PROGRESS");
  const done = run(t, B12, NOON(D), op("makeupClaim", { answerDay: D, day: MK, ids: t.session.answered }));
  assert.deepEqual(done.days[MK].touched, a0);
  const nx = C.reduce(done, op("sessionStart", { kind: "review", ids: B12.cards.map((c) => c.id) }), env(B12, NOON(D)));
  assert.deepEqual([nx.error, nx.state.session.kind, nx.state.session.makeup, nx.state.session.pick], [undefined, "review", undefined, "fresh"], "結算後新回合真的開了（Codex 審 c07244c F2）");
});
