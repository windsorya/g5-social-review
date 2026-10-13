// 存檔在頁面開著時被別處改掉／刪掉（設計：g5-sci-review/docs/design-external-change-codex-20261013.md 方案 A，T01–T16 的 N 部分）。
// 四個同型站（自然、數學、國語、社會）這個檔逐字相同；存檔 key 一律用 C.LS_KEY／C.LS_V1，不寫死站名。
// 「重新載入」在這裡＝舊 store 呼叫 prepareReload()，再用同一份 storage／sessionStorage 建新的 store（頁面重載後就是這樣）。
// 執行：node --test tests/external.test.js
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const C = require("../src/core.js");

const D = "2026-10-20";
const NOON = (d) => Date.parse(d + "T12:00:00+08:00");
const CONCEPTS = { "1-1": { unit: "1" }, "1-2": { unit: "1" }, "3-1": { unit: "3" } };
function card(id) { return { id, concept: "1-1", type: "choice", q: "題目 " + id, opts: ["甲", "乙"], a: 0 }; }
function bank(ids) { return { cards: ids.map(card), concepts: CONCEPTS, figs: {} }; }
let opn = 0;
function op(type, extra) { return Object.assign({ type, id: "x" + (++opn) }, extra || {}); }

// localStorage 替身：記錄寫入次數；可以讓讀或寫丟錯；可以在寫入前插入別的動作（T16）
function disk(init) {
  const m = Object.assign({}, init || {}); const f = { read: false, write: false }; let writes = 0; let beforeWrite = null;
  return {
    getItem: (k) => { if (f.read) throw new Error("SecurityError"); return Object.prototype.hasOwnProperty.call(m, k) ? m[k] : null; },
    setItem: (k, v) => { if (f.write) throw new Error("QuotaExceededError"); if (beforeWrite) { const h = beforeWrite; beforeWrite = null; h(); } writes++; m[k] = String(v); },
    removeItem: (k) => { delete m[k]; }, clear: () => { Object.keys(m).forEach((k) => delete m[k]); },
    raw: m, f, writes: () => writes, onceBeforeWrite: (h) => { beforeWrite = h; }
  };
}
function sess() { const m = {}; return { getItem: (k) => (k in m ? m[k] : null), setItem: (k, v) => { m[k] = String(v); }, removeItem: (k) => { delete m[k]; }, raw: m }; }
function open(mem, b, ss) { const st = C.createStore({ storage: mem, bank: b, clock: () => NOON(D), session: ss || null }); st.load(); return st; }
function reload(old, mem, b, ss) { if (old) old.prepareReload(); return open(mem, b, ss); }
function cards(mem) { const raw = mem.raw[C.LS_KEY]; return raw === undefined ? null : Object.keys(JSON.parse(raw).cards).sort(); }
function external(mem, b, fn) { const other = open(mem, b); fn(other); return other; }   // 另一個分頁做完一件事
function isChanged(r) { return r && r.ok === false && r.error === "STATE_CHANGED"; }

test("T01 全新頁面：存檔與 lastRaw 都是 null，開始、作答、重新整理都正常，不誤判外部刪除、不重載循環", () => {
  const b = bank(["s1", "s2"]); const mem = disk(); const ss = sess();
  const A = open(mem, b, ss);
  assert.equal(A.check().error, null); assert.equal(A.get().stale, false);
  assert.ok(A.dispatch(op("sessionStart")).ok);
  assert.ok(A.dispatch(op("answer", { cardId: "s1", ok: true })).ok);
  const A2 = open(mem, b, ss);                                   // 一般重新整理（不是失效重載）
  assert.equal(A2.get().reloadNotice, false, "一般重新整理不該出現「紀錄已更新」");
  assert.deepEqual(Object.keys(A2.get().state.cards), ["s1"]);
  assert.equal(A2.check().error, null); assert.equal(A2.check().error, null);
  assert.ok(A2.dispatch(op("answer", { cardId: "s2", ok: true })).ok);
  assert.deepEqual(cards(mem), ["s1", "s2"]);
});

test("T02 清除全部紀錄：成功才公布；清除時寫入失敗可重試；之後新答案可存，不永久卡住", () => {
  const b = bank(["s1", "s2"]); const mem = disk(); const A = open(mem, b);
  assert.ok(A.dispatch(op("answer", { cardId: "s1", ok: true })).ok);
  mem.f.write = true;
  const r = A.dispatch(op("reset"));
  assert.equal(r.ok, false); assert.equal(r.error, "SAVE_FAILED");
  assert.deepEqual(cards(mem), ["s1"]); assert.deepEqual(Object.keys(A.get().state.cards), ["s1"], "清除還沒成功就公布了");
  mem.f.write = false;
  assert.ok(A.retry().ok); assert.deepEqual(cards(mem), []); assert.deepEqual(Object.keys(A.get().state.cards), []);
  assert.ok(A.dispatch(op("reset")).ok, "再清一次也可以");
  assert.ok(A.dispatch(op("sessionStart")).ok);
  assert.ok(A.dispatch(op("answer", { cardId: "s2", ok: true })).ok);
  assert.deepEqual(cards(mem), ["s2"]);
});

test("T03 兩個分頁：A 存好，B 再作答＝先失效（不寫）；B 重載後畫面是新的，再作答兩邊的作答都在", () => {
  const b = bank(["s1", "s2"]); const mem = disk(); const ss = sess();
  const A = open(mem, b), B = open(mem, b, ss);
  assert.ok(A.dispatch(op("answer", { cardId: "s1", ok: true })).ok);
  const w0 = mem.writes();
  const r = B.dispatch(op("answer", { cardId: "s2", ok: true }));
  assert.ok(isChanged(r), "B 應該先停下來：" + JSON.stringify(r.error));
  assert.equal(mem.writes(), w0, "B 失效後還寫了"); assert.equal(B.get().stale, true);
  assert.equal(r.pending, false, "這一步沒有待存操作");
  assert.deepEqual(cards(mem), ["s1"]);
  const B2 = reload(B, mem, b, ss);
  assert.equal(B2.get().reloadNotice, true); assert.deepEqual(Object.keys(B2.get().state.cards), ["s1"]);
  assert.ok(B2.dispatch(op("answer", { cardId: "s2", ok: true })).ok);
  assert.deepEqual(cards(mem), ["s1", "s2"]);
  assert.ok(isChanged(A.dispatch({ type: "tick" })), "換 A 看到 B 的新寫入也要失效");
});

test("T04 A 用站內「清除全部紀錄」（存檔仍是合法 JSON），B 正在練習：B 失效、舊紀錄不復活、新練習可存", () => {
  const b = bank(["s1", "s2"]); const mem = disk(); const ss = sess();
  const B = open(mem, b, ss);
  assert.ok(B.dispatch(op("sessionStart")).ok); assert.ok(B.dispatch(op("answer", { cardId: "s1", ok: true })).ok);
  external(mem, b, (A) => assert.ok(A.dispatch(op("reset")).ok));
  assert.equal(C.decode(mem.raw[C.LS_KEY], b).accepted, true, "清除後的存檔是合法 JSON");
  const w0 = mem.writes();
  assert.ok(isChanged(B.dispatch(op("answer", { cardId: "s2", ok: true }))));
  assert.equal(mem.writes(), w0); assert.deepEqual(cards(mem), []);
  const B2 = reload(B, mem, b, ss);
  assert.equal(B2.get().state.session, null); assert.deepEqual(Object.keys(B2.get().state.cards), []);
  assert.ok(B2.dispatch(op("sessionStart")).ok); assert.ok(B2.dispatch(op("answer", { cardId: "s2", ok: true })).ok);
  assert.deepEqual(cards(mem), ["s2"], "舊紀錄 s1 復活了");
});

["removeItem", "clear"].forEach((how) => {
  test("T05 別處用 " + how + "() 刪掉存檔：B 不重播舊操作、不誤顯成功；重載後可以從頭存", () => {
    const b = bank(["s1", "s2"]); const mem = disk({ "other.site": "keep" }); const ss = sess();
    const B = open(mem, b, ss);
    assert.ok(B.dispatch(op("answer", { cardId: "s1", ok: true })).ok);
    if (how === "removeItem") mem.removeItem(C.LS_KEY); else mem.clear();
    const w0 = mem.writes();
    const r = B.dispatch({ type: "tick" });
    assert.ok(isChanged(r), "刪掉後 tick 不能回成功：" + JSON.stringify([r.ok, r.error]));
    assert.ok(isChanged(B.dispatch(op("answer", { cardId: "s2", ok: true }))));
    assert.ok(isChanged(B.retry()));
    assert.equal(mem.writes(), w0); assert.equal(mem.raw[C.LS_KEY], undefined, "舊紀錄被寫回去了");
    const B2 = reload(B, mem, b, ss);
    assert.deepEqual(Object.keys(B2.get().state.cards), []);
    assert.ok(B2.dispatch(op("answer", { cardId: "s2", ok: true })).ok);
    assert.deepEqual(cards(mem), ["s2"]);
  });
});

test("T06 同時留有舊版 v1 與新版存檔：新版被刪、失效重載後不搬回 v1；再整理一次也不搬；v1 原文不動；新作答建立新紀錄", () => {
  const b = bank(["s1", "s2"]);
  const v1 = JSON.stringify({ v: 1, cards: { s1: { box: 1, streak: 1, due: "2026-10-21", seen: 2, right: 2, wrong: 0, retired: false } } });
  const mem = disk({ [C.LS_V1]: v1 }); const ss = sess();
  const B = open(mem, b, ss);
  assert.equal(B.get().migrated, true, "前提：第一次開頁照常把 v1 搬進來");
  assert.deepEqual(cards(mem), ["s1"]);
  mem.removeItem(C.LS_KEY);
  assert.ok(isChanged(B.dispatch({ type: "tick" })));
  const B2 = reload(B, mem, b, ss);
  assert.equal(B2.get().migrated, false, "失效重載把 v1 搬回來了"); assert.deepEqual(Object.keys(B2.get().state.cards), []);
  assert.equal(mem.raw[C.LS_KEY], undefined); assert.equal(mem.raw[C.LS_V1], v1);
  const B3 = open(mem, b, ss);                                    // 新作答前再整理一次（同一個分頁）
  assert.equal(B3.get().migrated, false, "再整理一次又搬回來了"); assert.equal(mem.raw[C.LS_KEY], undefined);
  assert.ok(B3.dispatch(op("answer", { cardId: "s2", ok: true })).ok);
  assert.deepEqual(cards(mem), ["s2"]); assert.equal(mem.raw[C.LS_V1], v1);
  const B4 = open(mem, b, ss);
  assert.deepEqual(Object.keys(B4.get().state.cards), ["s2"]);
});

// Codex 審 812ca9b／c10c0f9 T06：分頁暫存不能用（null）或寫不進去時，「不搬舊版」標記改記在本機存檔，重載後仍不搬 v1
[["沒有分頁暫存", () => null], ["分頁暫存寫入丟錯", () => ({ getItem: () => null, setItem: () => { throw new Error("QuotaExceededError"); }, removeItem: () => {} })],
 ["分頁暫存默默沒存", () => ({ getItem: () => null, setItem: () => {}, removeItem: () => {} })]].forEach(([how, mk]) => {
  test("T06b " + how + "：新版被刪、失效重載後仍不搬回 v1、不寫存檔；之後新作答建立新紀錄並清掉標記", () => {
    const b = bank(["s1", "s2"]);
    const v1 = JSON.stringify({ v: 1, cards: { s1: { box: 1, streak: 1, due: "2026-10-21", seen: 7, right: 2, wrong: 0, retired: false } } });
    const mem = disk({ [C.LS_V1]: v1 });
    const B = open(mem, b, mk());
    assert.equal(B.get().migrated, true, "前提：第一次開頁照常把 v1 搬進來");
    mem.removeItem(C.LS_KEY);
    assert.ok(isChanged(B.check()));
    assert.equal(B.prepareReload(), true, "標記沒記住卻照樣重載");
    const B2 = open(mem, b, mk());
    assert.equal(B2.get().migrated, false, "失效重載把 v1 搬回來了"); assert.deepEqual(Object.keys(B2.get().state.cards), []);
    assert.equal(mem.raw[C.LS_KEY], undefined); assert.equal(mem.raw[C.LS_V1], v1);
    const B3 = open(mem, b, mk());
    assert.equal(B3.get().migrated, false, "再整理一次又搬回來了");
    assert.ok(B3.dispatch(op("answer", { cardId: "s2", ok: true })).ok);
    assert.deepEqual(cards(mem), ["s2"]); assert.equal(mem.raw[C.LS_V1], v1);
    assert.equal(mem.raw[C.LS_KEY + ".noMigrate"], undefined, "新存檔成功後標記沒清");
  });
});

test("T06b 分頁暫存與本機存檔都寫不進標記：prepareReload 回 false（不假裝記住了）", () => {
  const b = bank(["s1"]); const mem = disk(); const B = open(mem, b, null);
  assert.ok(B.dispatch(op("answer", { cardId: "s1", ok: true })).ok);
  mem.removeItem(C.LS_KEY); assert.ok(isChanged(B.check()));
  mem.f.write = true;
  assert.equal(B.prepareReload(), false);
});

// Codex 審 1dc3ded T06：分頁暫存與本機存檔在重載前都寫不進、重載時儲存又恢復——靠搬移當下記的永久標記（.fromV1），舊紀錄仍不復活
test("T06c 兩種儲存在重載前都寫不進、重載時恢復：仍不搬回 v1、不寫存檔", () => {
  const b = bank(["s1", "s2"]);
  const v1 = JSON.stringify({ v: 1, cards: { s1: { box: 1, streak: 1, due: "2026-10-21", seen: 7, right: 2, wrong: 0, retired: false } } });
  const mem = disk({ [C.LS_V1]: v1 });
  const B = open(mem, b, null);
  assert.equal(B.get().migrated, true);
  assert.equal(mem.raw[C.LS_KEY + ".fromV1"], "1", "搬移時沒記永久標記");
  mem.removeItem(C.LS_KEY); assert.ok(isChanged(B.check()));
  mem.f.write = true; assert.equal(B.prepareReload(), false); mem.f.write = false;   // 重載前兩邊都寫不進，重載時恢復
  const w0 = mem.writes();
  const B2 = open(mem, b, null);
  assert.equal(B2.get().migrated, false, "舊紀錄復活了"); assert.deepEqual(Object.keys(B2.get().state.cards), []);
  assert.equal(mem.raw[C.LS_KEY], undefined); assert.equal(mem.writes(), w0, "重載時寫了存檔");
});
test("T06c 標記上線前就搬過（新版、舊版都在、沒有標記）：開頁補記標記；之後新版被刪也不搬", () => {
  const b = bank(["s1", "s2"]);
  const v1 = JSON.stringify({ v: 1, cards: { s1: { box: 1, streak: 1, due: "2026-10-21", seen: 7, right: 2, wrong: 0, retired: false } } });
  const mem = disk({ [C.LS_V1]: v1 });
  open(mem, b, null); delete mem.raw[C.LS_KEY + ".fromV1"];   // 模擬舊版程式搬過、沒有標記
  const A = open(mem, b, null);
  assert.equal(mem.raw[C.LS_KEY + ".fromV1"], "1", "沒補記標記");
  mem.removeItem(C.LS_KEY); assert.ok(isChanged(A.check()));
  const A2 = open(mem, b, null);
  assert.equal(A2.get().migrated, false, "補記後仍搬回 v1"); assert.equal(mem.raw[C.LS_KEY], undefined);
});
test("T06c 搬移時標記寫不進：撤回這次搬移（不留下沒標記的新版）、封鎖；下次開頁再搬", () => {
  const b = bank(["s1", "s2"]);
  const v1 = JSON.stringify({ v: 1, cards: { s1: { box: 1, streak: 1, due: "2026-10-21", seen: 7, right: 2, wrong: 0, retired: false } } });
  const mem = disk({ [C.LS_V1]: v1 });
  const set = mem.setItem; mem.setItem = (k, v) => { if (k === C.LS_KEY + ".fromV1") throw new Error("QuotaExceededError"); return set(k, v); };
  const A = open(mem, b, null);
  assert.equal(A.get().migrated, false); assert.equal(A.get().loadError, "MIGRATE"); assert.equal(A.get().migrateReason, "WRITE");
  assert.equal(mem.raw[C.LS_KEY], undefined, "留下了沒有標記的新版"); assert.equal(mem.raw[C.LS_V1], v1);
  mem.setItem = set;
  const A2 = open(mem, b, null);
  assert.equal(A2.get().migrated, true); assert.deepEqual(cards(mem), ["s1"]); assert.equal(mem.raw[C.LS_KEY + ".fromV1"], "1");
});

["predict", "task", "complete"].forEach((stage) => {
  test("T07 實驗／解說停在「" + stage + "」階段，別處刪掉存檔後按原按鈕：回 STATE_CHANGED（不是無提示的 NO_RUN）、不寫入", () => {
    const b = bank(["s1"]); const mem = disk(); const B = open(mem, b);
    const R = "r" + stage;
    assert.ok(B.dispatch(op("labStart", { runId: R, lab: "x", tasks: 2, answer: 0, from: "menu" })).ok);
    if (stage !== "predict") assert.ok(B.dispatch(op("labPredict", { runId: R, choice: 0 })).ok);
    if (stage === "complete") { assert.ok(B.dispatch(op("labTask", { runId: R, task: 0 })).ok); assert.ok(B.dispatch(op("labTask", { runId: R, task: 1 })).ok); }
    mem.removeItem(C.LS_KEY);
    const w0 = mem.writes();
    const a = stage === "predict" ? op("labPredict", { runId: R, choice: 0 }) : stage === "task" ? op("labTask", { runId: R, task: 0 }) : op("labComplete", { runId: R });
    const r = B.dispatch(a);
    assert.ok(isChanged(r), "得到 " + r.error); assert.notEqual(r.error, "NO_RUN");
    assert.equal(mem.writes(), w0); assert.equal(B.get().pendingAction, null);
    assert.ok(B.get().state.labRuns[R], "舊畫面還在用的快照不能被換成空白");
  });
});

test("T09 結束畫面留著「再練答錯的」、別處清除：tick 與舊按鈕都停下，不以舊 wrong 清單開新回合、不拋 TypeError", () => {
  const b = bank(["s1", "s2"]); const mem = disk(); const B = open(mem, b);
  assert.ok(B.dispatch(op("sessionStart")).ok); assert.ok(B.dispatch(op("answer", { cardId: "s1", ok: false })).ok);
  external(mem, b, (A) => assert.ok(A.dispatch(op("reset")).ok));
  assert.ok(isChanged(B.dispatch({ type: "tick" })));
  const w = B.view().session.wrong.slice();                       // 舊按鈕 handler：V().session.wrong.slice()
  assert.deepEqual(w, ["s1"]);
  const w0 = mem.writes();
  assert.ok(isChanged(B.dispatch(op("sessionStart", { kind: "redo", ids: w }))));
  assert.equal(mem.writes(), w0); assert.equal(JSON.parse(mem.raw[C.LS_KEY]).session, null);
});

[["answer", (B) => op("answer", { cardId: "s1", ok: true })], ["labTask", () => op("labTask", { runId: "r1", task: 0 })]].forEach(([name, mk]) => {
  test("T10 存檔沒變、只是寫入失敗：待存的 " + name + " 恢復後重試只接受一次，畫面與存檔一致", () => {
    const b = bank(["s1"]); const mem = disk(); const B = open(mem, b);
    if (name === "labTask") { assert.ok(B.dispatch(op("labStart", { runId: "r1", lab: "x", tasks: 2, answer: 0, from: "menu" })).ok); assert.ok(B.dispatch(op("labPredict", { runId: "r1", choice: 0 })).ok); }
    const a = mk(B);
    mem.f.write = true;
    const r = B.dispatch(a); assert.equal(r.ok, false); assert.equal(r.error, "SAVE_FAILED"); assert.equal(B.get().pendingAction.id, a.id);
    assert.equal(B.dispatch({ type: "tick" }).error, "SAVE_PENDING"); assert.equal(B.accepted(a.id), false);
    mem.f.write = false;
    const w0 = mem.writes();
    assert.ok(B.retry().ok); assert.equal(B.accepted(a.id), true); assert.equal(mem.writes(), w0 + 1);
    assert.equal(B.retry().nothing, true);
    assert.ok(B.dispatch(a).dup, "同一個操作 ID 再送只算一次");
    const onDisk = JSON.parse(mem.raw[C.LS_KEY]);
    assert.deepEqual(onDisk.ops, B.get().state.ops);
    if (name === "answer") assert.equal(onDisk.cards.s1.seen, 1); else assert.deepEqual(onDisk.labRuns.r1.tasksDone, [0]);
  });
});

const CHANGES = {
  "一般更新": (mem, b) => external(mem, b, (A) => assert.ok(A.dispatch(op("answer", { cardId: "s2", ok: true })).ok)),
  "清除全部紀錄": (mem, b) => external(mem, b, (A) => assert.ok(A.dispatch(op("reset")).ok)),
  "整個刪掉": (mem) => mem.removeItem(C.LS_KEY)
};
Object.keys(CHANGES).forEach((how) => {
  ["answer", "labTask"].forEach((kind) => {
    ["retry", "tick", "新操作"].forEach((trigger) => {
      test("T11 待重試的 " + kind + " 遇到別處「" + how + "」，再觸發 " + trigger + "：先進衝突、不偷偷補寫、不靜默丟掉、不回假成功；確認重載後可重新操作", () => {
        const b = bank(["s1", "s2"]); const mem = disk(); const ss = sess(); const B = open(mem, b, ss);
        assert.ok(B.dispatch(op("labStart", { runId: "r1", lab: "x", tasks: 2, answer: 0, from: "menu" })).ok);
        assert.ok(B.dispatch(op("labPredict", { runId: "r1", choice: 0 })).ok);
        const a = kind === "answer" ? op("answer", { cardId: "s1", ok: true }) : op("labTask", { runId: "r1", task: 0 });
        mem.f.write = true; assert.equal(B.dispatch(a).ok, false); mem.f.write = false;
        CHANGES[how](mem, b);
        const before = mem.raw[C.LS_KEY], w0 = mem.writes();
        const r = trigger === "retry" ? B.retry() : trigger === "tick" ? B.dispatch({ type: "tick" }) : B.dispatch(op("answer", { cardId: "s2", ok: false }));
        assert.ok(isChanged(r), "得到 " + JSON.stringify([r.ok, r.error]));
        assert.equal(r.pending, true, "要告訴畫面「有一步需要重做」"); assert.equal(B.get().pendingAction.id, a.id, "待存操作被靜默丟掉了");
        assert.equal(mem.writes(), w0, "偷偷補寫了"); assert.equal(mem.raw[C.LS_KEY], before);
        assert.ok(isChanged(B.retry())); assert.equal(mem.writes(), w0);
        const B2 = reload(B, mem, b, ss);                               // 孩子按「載入最新紀錄」
        assert.equal(B.get().pendingAction, null, "確認後舊的待存操作要明確取消");
        assert.equal(B2.get().pendingAction, null); assert.equal(B2.accepted(a.id), false);
        assert.ok(B2.dispatch(op("answer", { cardId: "s1", ok: true })).ok, "重載後要能重新操作");
      });
    });
  });
});

test("T12 還沒收到 storage 事件、同頁程式直接改存檔：dispatch／retry（沒有待存也查）／tick 都被 refresh() 擋下，寫入數為零", () => {
  const b = bank(["s1", "s2"]); const mem = disk(); const B = open(mem, b);
  assert.ok(B.dispatch(op("answer", { cardId: "s1", ok: true })).ok);
  const other = JSON.parse(mem.raw[C.LS_KEY]); other.settings.unit3 = !other.settings.unit3;
  mem.raw[C.LS_KEY] = JSON.stringify(other);                       // 直接改（不經過任何 store，也沒有事件）
  const w0 = mem.writes();
  assert.ok(isChanged(B.retry()), "沒有待存的 retry 也要檢查失效");
  const C2 = open(mem, b); mem.raw[C.LS_KEY] = mem.raw[C.LS_KEY] + " ";   // 另一個 store：dispatch 與 tick 也擋
  assert.ok(isChanged(C2.dispatch(op("answer", { cardId: "s2", ok: true }))));
  const C3 = open(mem, b); mem.raw[C.LS_KEY] = mem.raw[C.LS_KEY].trim();
  assert.ok(isChanged(C3.dispatch({ type: "tick" })));
  assert.equal(mem.writes(), w0);
});

test("T13 只看本站存檔：自己的寫入、別站 key、probe、sessionStorage、延遲送到的舊事件都不誤判；以當下原文比對", () => {
  const b = bank(["s1", "s2"]); const mem = disk(); const ss = sess(); const A = open(mem, b, ss);
  assert.ok(A.dispatch(op("answer", { cardId: "s1", ok: true })).ok);
  assert.equal(A.check().error, null, "自己的寫入不能讓自己失效");
  assert.equal(A.watches(C.LS_KEY), true); assert.equal(A.watches(null), true, "clear() 的事件 key 是 null，要看");
  ["g5math.v2", "g5sci.v3", "g5chi.v1", "g5soc.v1", "g5wrong.v1", "g5sync.meta", "g5sci.probe", "g5math.probe", C.LS_V1, C.LS_KEY + ".x", ""].filter((k) => k !== C.LS_KEY)
    .forEach((k) => assert.equal(A.watches(k), false, "不該理會 " + k));
  mem.raw["g5other.v1"] = "{}"; mem.raw[C.LS_KEY.split(".")[0] + ".probe"] = "1"; ss.setItem("whatever", "1");
  assert.equal(A.check().error, null); assert.equal(A.get().stale, false);
  // 延遲送到的舊事件：B 寫入 → A 失效重載成 A2 → 事件這時才到，A2 以當下原文比對，不該再重載
  external(mem, b, (B) => assert.ok(B.dispatch(op("answer", { cardId: "s2", ok: true })).ok));
  assert.ok(isChanged(A.check()));
  const A2 = reload(A, mem, b, ss);
  assert.equal(A2.check().error, null); assert.equal(A2.get().stale, false);
  assert.ok(A2.dispatch(op("tick")).ok);
});

test("T14 開頁後存檔被改壞：不覆寫原文、不當空白；重載後封鎖寫入、有清除出口、不重載循環；恢復可讀後一切照常", () => {
  const b = bank(["s1", "s2"]); const mem = disk(); const ss = sess(); const B = open(mem, b, ss);
  assert.ok(B.dispatch(op("answer", { cardId: "s1", ok: true })).ok);
  const good = mem.raw[C.LS_KEY];
  mem.raw[C.LS_KEY] = "{壞掉";
  const w0 = mem.writes();
  assert.ok(isChanged(B.dispatch(op("answer", { cardId: "s2", ok: true }))));
  assert.ok(isChanged(B.retry())); assert.equal(mem.writes(), w0); assert.equal(mem.raw[C.LS_KEY], "{壞掉");
  const B2 = reload(B, mem, b, ss);
  assert.equal(B2.get().loadError, "SCHEMA", "要看得見問題（壞存檔），不是當成空白");
  const r = B2.dispatch(op("answer", { cardId: "s2", ok: true }));
  assert.equal(r.ok, false); assert.notEqual(r.error, "STATE_CHANGED", "壞存檔沒再變，不能一直要求重載");
  assert.equal(B2.check().error, null); assert.equal(B2.get().stale, false); assert.equal(mem.raw[C.LS_KEY], "{壞掉");
  // 恢復可讀（例如別頁把它修好）：這頁失效一次 → 重載後照常
  mem.raw[C.LS_KEY] = good;
  assert.ok(isChanged(B2.check()));
  const B3 = reload(B2, mem, b, ss);
  assert.equal(B3.get().loadError, null); assert.ok(B3.dispatch(op("answer", { cardId: "s2", ok: true })).ok);
  // 另一條出口：家長按「清除壞掉的存檔」
  mem.raw[C.LS_KEY] = "{又壞了"; const B4 = open(mem, b, ss);
  assert.equal(B4.get().loadError, "SCHEMA"); assert.equal(B4.discardBroken(), true); assert.ok(B4.dispatch(op("answer", { cardId: "s1", ok: true })).ok);
});

test("T14b 開頁後讀取拋錯：不當空白、不失效重載；待存留著，恢復可讀後重試成功一次", () => {
  const b = bank(["s1", "s2"]); const mem = disk(); const B = open(mem, b);
  assert.ok(B.dispatch(op("answer", { cardId: "s1", ok: true })).ok);
  mem.f.read = true;
  const a = op("answer", { cardId: "s2", ok: true });
  const r = B.dispatch(a);
  assert.equal(r.error, "SAVE_FAILED"); assert.equal(B.get().stale, false); assert.equal(B.get().pendingAction.id, a.id);
  assert.equal(B.retry().ok, false); assert.equal(B.check().error, "READ");
  assert.deepEqual(cards({ raw: mem.raw }), ["s1"]);
  mem.f.read = false;
  assert.ok(B.retry().ok); assert.ok(B.accepted(a.id)); assert.deepEqual(cards(mem), ["s1", "s2"]);
});

test("T15 已偵測失效：連點舊按鈕、同步 onReplaced（invalidate）同時抵達都不再寫入；新頁讀到當下最新版", () => {
  const b = bank(["s1", "s2", "s3"]); const mem = disk(); const ss = sess(); const B = open(mem, b, ss);
  assert.ok(B.dispatch(op("answer", { cardId: "s1", ok: true })).ok);
  external(mem, b, (A) => assert.ok(A.dispatch(op("answer", { cardId: "s2", ok: true })).ok));
  assert.ok(isChanged(B.check()));
  const w0 = mem.writes();
  for (let i = 0; i < 5; i++) assert.ok(isChanged(B.dispatch(op("answer", { cardId: "s3", ok: true }))));
  assert.ok(isChanged(B.invalidate())); assert.ok(isChanged(B.invalidate())); assert.ok(isChanged(B.retry()));
  assert.equal(mem.writes(), w0);
  external(mem, b, (A) => assert.ok(A.dispatch(op("answer", { cardId: "s3", ok: false })).ok));   // 重載前另一頁又寫了新版
  const B2 = reload(B, mem, b, ss);
  assert.deepEqual(Object.keys(B2.get().state.cards).sort(), ["s1", "s2", "s3"]);
  // invalidate 不比對原文也直接失效（同步程式已經換掉存檔）
  const B3 = open(mem, b); assert.ok(isChanged(B3.invalidate())); assert.ok(isChanged(B3.dispatch({ type: "tick" })));
});

test("T16【已知限制，不修】兩個 store 讀到同一份舊原文後交錯「A讀→B讀→A寫→B寫」：A 的作答會遺失（可重現；不是多分頁完整保證）", () => {
  const b = bank(["s1", "s2"]); const mem = disk();
  const A = open(mem, b), B = open(mem, b);
  // A 讀完、準備寫的那一刻，插入 B 的整個操作；B 的寫入延到 A 寫完之後才落地
  const queued = [];
  const bDisk = { getItem: (k) => mem.getItem(k), setItem: (k, v) => { queued.push([k, v]); } };
  const Bx = C.createStore({ storage: bDisk, bank: b, clock: () => NOON(D) }); Bx.load();
  mem.onceBeforeWrite(() => { assert.ok(Bx.dispatch(op("answer", { cardId: "s2", ok: true })).ok); });   // B 讀（A 還沒寫）
  assert.ok(A.dispatch(op("answer", { cardId: "s1", ok: true })).ok);                                        // A 寫
  queued.forEach(([k, v]) => mem.setItem(k, v));                                                            // B 寫
  assert.deepEqual(cards(mem), ["s2"], "已知限制：A 的 s1 被 B 蓋掉（讀與寫之間交錯，非原子）");
  assert.ok(isChanged(A.dispatch({ type: "tick" })), "交錯之後 A 下一次操作仍會發現存檔變了（但 s1 已經遺失）");
  void B;
});
