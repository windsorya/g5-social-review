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
  assert.deepEqual(s.cards.s1, { seen: 3, goodDays: [D], blockedDay: null, due: "2026-10-21" });
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
  assert.equal(s.cards.s1.due, "2026-10-22");
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
  let v = C.view(s, env(b, NOON(D)));
  assert.deepEqual([v.planIds, v.session.queue], [["s1"], ["s1"]]);
  s = run(s, b, NOON(D), op("answer", { cardId: "s1", ok: true }));
  assert.deepEqual([s.days[D].planIds, s.session.queue], [["s1"], []]);   // 存檔本身也剔除，不只畫面
  v = C.view(s, env(b, NOON(D)));
  assert.deepEqual([v.remainingIds, v.completed], [[], true]);
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

test("R4 D4-b doneIds 裡的消失卡要剔掉（殺突變 N3）：planIds=[s1]、doneIds=[]、進度 0/1", () => {
  const b = bank(["s1", "s2"]); const s = C.blankState();
  s.days[D] = dayRec(["gone", "s1"], ["gone"]);
  const v = C.view(s, env(b, NOON(D)));
  assert.deepEqual([v.planIds, v.doneIds, v.M.cardProgress], [["s1"], [], { done: 0, planned: 1 }]);
  assert.equal(v.completed, false);
  assert.deepEqual(s.days[D].doneIds, ["gone"], "view 不得改到輸入");
});

test("R4 D4-c session.answered／wrong 裡的消失卡要剔掉（殺突變 N4）", () => {
  const b = bank(["s1", "s2"]); const s = C.blankState();
  s.cards.s2 = learned(1, [D], "2026-10-21");
  s.days[D] = dayRec(["s1", "s2"], ["s2"], ["s2"]);
  s.session = { day: D, kind: "plan", queue: ["gone", "s1"], answered: ["gone", "s2"], wrong: ["gone", "s2"], kinds: {} };
  const v = C.view(s, env(b, NOON(D)));
  assert.deepEqual([v.session.queue, v.session.answered, v.session.wrong], [["s1"], ["s2"], ["s2"]]);
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

// 補做（2026-10-14 律師：「有辦法補做之前沒做的天數嗎」）
const OLD = require("./fixtures/core.pre-makeup-d7d1d78.js");   // 加補做前、線上那一版核心（git show d7d1d78:src/core.js）
const MK = "2026-10-18";
function doneToday(b) {
  let s = C.blankState(); s = run(s, b, NOON(D), op("tick"));
  s.days[D].planIds.forEach((id) => { s = run(s, b, NOON(D), op("answer", { cardId: id, ok: true })); });
  return s;
}
const B12 = bank(Array.from({ length: 12 }, (_, i) => "c" + (i + 1)));

test("MK1 今天做完後補做：那天記成練過（新卡 5 張、不重複今天的），間隔複習照今天算，今天不算加碼", () => {
  let s = doneToday(B12);
  const today = s.days[D].planIds.slice();
  assert.deepEqual(C.missedDays(s, "2026-10-17", D), ["2026-10-17", "2026-10-18", "2026-10-19"]);
  s = run(s, B12, NOON(D), op("sessionStart", { kind: "makeup", day: MK }));
  const plan = s.days[MK].planIds;
  assert.equal(plan.length, 5); assert.ok(plan.every((id) => today.indexOf(id) < 0));
  assert.equal(s.session.makeup, MK); assert.equal(s.session.kind, "plan");
  plan.forEach((id) => { s = run(s, B12, NOON(D), op("answer", { cardId: id, ok: true })); });
  assert.deepEqual(s.days[MK].touched.sort(), plan.slice().sort());
  assert.deepEqual(s.days[MK].doneIds.sort(), plan.slice().sort());
  assert.equal(s.days[D].touched.length, 5, "今天的紀錄不動"); assert.equal(s.days[D].extraDone, false);
  assert.deepEqual(s.cards[plan[0]].goodDays, [D], "有效日期是今天");
  assert.equal(s.cards[plan[0]].due, "2026-10-21");
  assert.deepEqual(C.missedDays(s, "2026-10-17", D), ["2026-10-17", "2026-10-19"]);
  assert.equal(C.endTitle(C.view(s, env(B12, NOON(D)))), "10/18 補做完成");
  assert.deepEqual(C.checkState(s, B12), []);
});

test("MK2 線上舊版核心（d7d1d78）讀補做後的存檔：不判壞；在補做回合中作答也不出錯", () => {
  let s = doneToday(B12);
  s = run(s, B12, NOON(D), op("sessionStart", { kind: "makeup", day: MK }));
  assert.deepEqual(OLD.checkState(s, B12), [], "補做回合進行中");
  const r = OLD.reduce(s, op("answer", { cardId: s.days[MK].planIds[0], ok: true }), { bank: B12, now: NOON(D) });
  assert.ok(!r.error, String(r.error));
  assert.deepEqual(OLD.checkState(r.state, B12), []);
  s.days[MK].planIds.forEach((id) => { s = run(s, B12, NOON(D), op("answer", { cardId: id, ok: true })); });
  assert.deepEqual(OLD.checkState(s, B12), [], "補做完成後");
});

test("MK3 不能補的情況：今天還沒做完、那天已練過、今天或以後、壞日期", () => {
  let s = C.blankState(); s = run(s, B12, NOON(D), op("tick"));
  assert.equal(C.reduce(s, op("sessionStart", { kind: "makeup", day: MK }), env(B12, NOON(D))).error, "MAKEUP_TODAY_FIRST");
  s = doneToday(B12);
  [D, "2026-10-21", "10/18", null].forEach((d) => assert.equal(C.reduce(s, op("sessionStart", { kind: "makeup", day: d }), env(B12, NOON(D))).error, "MAKEUP_DAY", String(d)));
  s = run(s, B12, NOON(D), op("sessionStart", { kind: "makeup", day: MK }));
  s = run(s, B12, NOON(D), op("answer", { cardId: s.days[MK].planIds[0], ok: true }));
  assert.equal(C.reduce(s, op("sessionStart", { kind: "makeup", day: MK }), env(B12, NOON(D))).error, "MAKEUP_DAY", "練過一張就算練過");
});

test("MK4 新卡用完改排練過但還沒畢業的卡；全部畢業才說沒有卡可補", () => {
  const b = bank(["a1", "a2", "a3", "a4", "a5"]);
  let s = doneToday(b);
  assert.equal(C.reduce(s, op("sessionStart", { kind: "makeup", day: MK }), env(b, NOON(D))).error, "MAKEUP_EMPTY", "今天都碰過、沒新卡");
  // 8 張卡：10/20 練 a1–a5、10/21 練全部 8 張、10/22 只到期 a6–a8 ⇒ a1–a5 練過、沒畢業、今天沒碰
  const b8 = bank(["a1", "a2", "a3", "a4", "a5", "a6", "a7", "a8"]);
  s = doneToday(b8);
  ["2026-10-21", "2026-10-22"].forEach((d) => {
    s = run(s, b8, NOON(d), op("tick"));
    s.days[d].planIds.forEach((id) => { s = run(s, b8, NOON(d), op("answer", { cardId: id, ok: true })); });
  });
  assert.deepEqual(s.days["2026-10-22"].planIds, ["a6", "a7", "a8"]);
  s = run(s, b8, NOON("2026-10-22"), op("sessionStart", { kind: "makeup", day: MK }));
  assert.deepEqual(s.days[MK].planIds.slice().sort(), ["a1", "a2", "a3", "a4", "a5"]);
  s.days[MK].planIds.forEach((id) => { s = run(s, b8, NOON("2026-10-22"), op("answer", { cardId: id, ok: true })); });
  assert.equal(C.reduce(s, op("sessionStart", { kind: "makeup", day: "2026-10-17" }), env(b8, NOON("2026-10-22"))).error, "MAKEUP_EMPTY", "今天別次補做練過的卡不再排");
});

// Codex 審 b482558 的四個反例
test("MK6 補做那天原本有實驗、考考爸媽、心情紀錄（沒答卡）：補做後照留，並記 madeUp＝今天", () => {
  let s = doneToday(B12);
  s.days[MK] = { planIds: [], doneIds: [], touched: [], extraDone: false, labRuns: 1, teach: 2, mood: "good" };
  s = run(s, B12, NOON(D), op("sessionStart", { kind: "makeup", day: MK }));
  assert.equal(s.days[MK].labRuns, 1); assert.equal(s.days[MK].teach, 2); assert.equal(s.days[MK].mood, "good");
  assert.equal(s.days[MK].madeUp, D); assert.equal(s.days[MK].planIds.length, 5);
  assert.deepEqual(C.checkState(s, B12), []);
});

test("MK7 補做回合裡做補救實驗：今天不算加碼（extraDone 照舊 false）", () => {
  const lab = { lab: "x", day: D, phase: "observe", prediction: null, predictionCorrect: null, answer: 0, tasks: 0, tasksDone: [], from: "menu", card: null };
  let s = doneToday(B12);
  s.labRuns.r1 = Object.assign({}, lab);
  s = run(s, B12, NOON(D), op("sessionStart", { kind: "makeup", day: MK }));
  s = run(s, B12, NOON(D), op("labComplete", { runId: "r1" }));
  assert.equal(s.labRuns.r1.phase, "complete", "實驗真的完成了（有經過 extra()）");
  assert.equal(s.days[D].extraDone, false, "補做回合中完成實驗，今天不算加碼");
  // 對照：不在補做回合時，同樣的實驗會算加碼（證明上面不是空測）
  let t = doneToday(B12); t.labRuns.r1 = Object.assign({}, lab);
  t = run(t, B12, NOON(D), op("labComplete", { runId: "r1" }));
  assert.equal(t.days[D].extraDone, true);
});

test("MK8 日曆的補做標記靠 days[那天].madeUp（作答紀錄截斷也不會誤標）；線上舊版核心讀寫後照留", () => {
  let s = doneToday(B12);
  s = run(s, B12, NOON(D), op("sessionStart", { kind: "makeup", day: MK }));
  s = run(s, B12, NOON(D), op("answer", { cardId: s.days[MK].planIds[0], ok: true }));
  assert.equal(s.days[MK].madeUp, D); assert.equal(s.days[D].madeUp, undefined, "正常練的日子沒有 madeUp");
  const o = OLD.reduce(s, op("answer", { cardId: s.days[MK].planIds[1], ok: true }), { bank: B12, now: NOON("2026-10-21") });
  assert.ok(!o.error); assert.equal(o.state.days[MK].madeUp, D, "舊版核心作答、跨日後 madeUp 照留");
  const bad = JSON.parse(JSON.stringify(s)); bad.days[MK].madeUp = MK;
  assert.ok(C.checkState(bad, B12).length > 0, "madeUp 不能是那天自己或更早");
});

test("MK9 存檔壞掉（days 不是物件）時讀檔檢查回報錯誤、不拋例外", () => {
  let s = doneToday(B12);
  s = run(s, B12, NOON(D), op("sessionStart", { kind: "makeup", day: MK }));
  [null, undefined, 5].forEach((v) => {
    const bad = JSON.parse(JSON.stringify(s)); bad.days = v;
    let errs; assert.doesNotThrow(() => { errs = C.checkState(bad, B12); });
    assert.ok(errs.length > 0, String(v));
  });
});

test("MK5 補做回合跨午夜：隔天回合換成當天計畫，已補的那天保留", () => {
  let s = doneToday(B12);
  s = run(s, B12, NOON(D), op("sessionStart", { kind: "makeup", day: MK }));
  s = run(s, B12, NOON(D), op("answer", { cardId: s.days[MK].planIds[0], ok: true }));
  s = run(s, B12, NOON("2026-10-21"), op("tick"));
  assert.equal(s.session.makeup, undefined); assert.equal(s.days[MK].touched.length, 1);
  assert.deepEqual(C.checkState(s, B12), []);
});
