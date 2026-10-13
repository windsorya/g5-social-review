// 存檔在頁面開著時被別處改掉／刪掉（設計：g5-sci-review/docs/design-external-change-codex-20261013.md 方案 A，T01–T16 的 N 部分）。
// 四個同型站（自然、數學、國語、社會）這個檔逐字相同；存檔 key 一律用 C.LS_KEY，不寫死站名（自然站專屬的舊版 key 只在 SCI 區塊用）。
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

/* ---------- 舊版紀錄（設計 task-mv6srlue-pujdyl：S0 三站沒有舊版、S1/S2 自然站封存＋家長選擇恢復、S3 READ 不前進） ----------
   站別能力不同：自然站（g5sci.v3）有真的舊版 g5sci.v1；數學、國語、社會沒有。用 LS_KEY 認站（不用 LS_V1：舊碼三站的 LS_V1 是假 key，認不出站）。
   原 T06 依設計「原 T06 修訂兩處」改寫：三站改驗「完全不碰舊版與標記 key」（T17）；自然站改驗「O 封存進 A、O 刪除；第一次恢復由家長明確選擇」。 */
const SCI = C.LS_KEY === "g5sci.v3";
const NO_LEGACY = "本站沒有舊版存檔（設計 S0）";
const ONLY_THREE = "自然站有舊版存檔，改驗 S1/S2";
const O = "g5sci.v1", A = "g5sci.v1.archived";
const V1 = JSON.stringify({ v: 1, cards: { s1: { box: 1, streak: 1, due: "2026-10-21", seen: 7, right: 2, wrong: 0, retired: false } } });
const has = (m, k) => Object.prototype.hasOwnProperty.call(m, k);
// F1 故障模型的替身：每個 getItem／setItem／removeItem 都能注入單次或持續故障；fail 可以等某個操作發生後才生效（「寫成功、緊接的回讀拋錯」）
function disk2(init) {
  const m = Object.assign({}, init || {}); const touched = []; const faults = []; let muts = 0; const seen = [];
  function hit(op, k) {
    seen.push(op + ":" + k);
    for (let i = 0; i < faults.length; i++) {
      const f = faults[i];
      if (f.op !== op || (f.key !== undefined && f.key !== k)) continue;
      if (f.after && seen.slice(0, -1).indexOf(f.after) < 0) continue;
      if (f.skip) { f.skip--; continue; }                      // 同一操作＋key 先放行 skip 次（定位到流程中的第幾次讀寫）
      if (f.once) faults.splice(i, 1);
      throw new Error(op === "get" ? "SecurityError" : "QuotaExceededError");
    }
  }
  return {
    getItem: (k) => { k = String(k); touched.push(k); hit("get", k); return has(m, k) ? m[k] : null; },
    setItem: (k, v) => { k = String(k); touched.push(k); hit("set", k); muts++; m[k] = String(v); },
    removeItem: (k) => { k = String(k); touched.push(k); hit("rm", k); muts++; delete m[k]; },
    clear: () => { Object.keys(m).forEach((k) => delete m[k]); },
    raw: m, touched, muts: () => muts,
    fail: (op, key, opt) => { faults.push(Object.assign({ op, key }, opt || {})); },
    heal: () => { faults.length = 0; }
  };
}
function open2(mem, b, ss) { return open(mem, b, ss === undefined ? null : ss); }
function keys(st) { return Object.keys(st.get().state.cards).sort(); }
function restored(mem) { return mem.raw[C.LS_KEY] !== undefined && JSON.parse(mem.raw[C.LS_KEY]).cards.s1 && JSON.parse(mem.raw[C.LS_KEY]).cards.s1.seen === 7; }
// 走完 S2：只剩 O → 家長按「恢復舊版紀錄」→ V 建好、A＝O 原文、O 刪除
function finishS2(mem, b, ss) {
  const P = open2(mem, b, ss);
  assert.equal(P.get().loadError, "LEGACY", "前提：只剩 O 時要等家長選擇");
  const r = P.restoreLegacy("restore");
  assert.ok(r.ok, "恢復失敗：" + JSON.stringify(r.error)); assert.equal(r.archive, "done");
  assert.ok(restored(mem)); assert.equal(mem.raw[A], V1); assert.equal(mem.raw[O], undefined);
  return P;
}


test("T17 三站：舊版／標記 key 放合法或壞的 v1，而且一碰就拋錯——load 與一般使用完全不碰它們、不碰 \"null\"，照常用現行存檔", { skip: C.LS_V1 !== null && ONLY_THREE }, () => {
  const b = bank(["s1", "s2"]); const pre = C.LS_KEY.split(".")[0];
  const legacy = [pre + ".none", pre + ".v1", C.LS_KEY + ".fromV1", C.LS_KEY + ".noMigrate", "null"].filter((k) => k !== C.LS_KEY);
  for (const v of [V1, "{壞掉"]) {
    const init = {}; legacy.forEach((k) => { init[k] = k.endsWith(".fromV1") || k.endsWith(".noMigrate") ? "1" : v; });
    const mem = disk2(init); legacy.forEach((k) => { mem.fail("get", k); mem.fail("set", k); mem.fail("rm", k); });
    const st = open2(mem, b, sess());
    assert.equal(st.get().loadError, null, "碰了舊版 key：" + v); assert.equal(st.get().migrated, false);
    assert.deepEqual(keys(st), []);
    assert.ok(st.dispatch(op("answer", { cardId: "s1", ok: true })).ok);
    assert.ok(st.retry().ok); assert.equal(st.check().error, null); st.prepareReload();
    const st2 = open2(mem, b, sess()); assert.deepEqual(keys(st2), ["s1"]);
    const bad = mem.touched.filter((k) => k !== C.LS_KEY);
    assert.deepEqual(bad, [], "碰了不該碰的 key：" + JSON.stringify(bad));
    legacy.forEach((k) => assert.equal(mem.raw[k], init[k], k + " 被改了"));
  }
});










test("T28 四站：沒有待存時 retry 讀取失敗——不回成功、V 不變、不搬移；恢復後重查", () => {
  const b = bank(["s1"]); const mem = disk(); const B = open(mem, b);
  assert.ok(B.dispatch(op("answer", { cardId: "s1", ok: true })).ok);
  const before = mem.raw[C.LS_KEY], w0 = mem.writes();
  mem.f.read = true;
  const r = B.retry();
  assert.equal(r.ok, false, "讀不到卻回成功"); assert.equal(r.error, "READ"); assert.equal(B.check().ok, false); assert.equal(B.check().error, "READ");
  assert.equal(mem.writes(), w0); assert.equal(mem.raw[C.LS_KEY], before);
  mem.f.read = false;
  assert.ok(B.retry().ok); assert.equal(B.retry().nothing, true);
  mem.removeItem(C.LS_KEY); mem.f.read = true; assert.equal(B.retry().error, "READ", "讀不到時不能當成存檔不存在"); mem.f.read = false;
  assert.ok(isChanged(B.retry()), "恢復後重查：已被刪就失效");
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
    assert.equal(B.dispatch({ type: "tick" }).error, "BLOCKED"); assert.equal(B.accepted(a.id), false);   // 4agent 方案 (a)：有待存時一律拒收
    mem.f.write = false;
    const w0 = mem.writes();
    assert.ok(B.retry().ok); assert.equal(B.accepted(a.id), true); assert.equal(mem.writes(), w0 + 2);   // 4agent 方案 (a)：resume＝補寫這一筆＋tick
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
        // 4agent 方案 (a)：有待存時 tick／新操作一律拒收（BLOCKED、零讀零寫，不靜默丟待存）；之後的 retry 才發現換代
        const r0 = trigger === "retry" ? null : trigger === "tick" ? B.dispatch({ type: "tick" }) : B.dispatch(op("answer", { cardId: "s2", ok: false }));
        if (r0) { assert.equal(r0.error, "BLOCKED", "得到 " + JSON.stringify([r0.ok, r0.error])); assert.equal(mem.writes(), w0); }
        const r = B.retry();
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
  ["g5math.v2", "g5sci.v3", "g5chi.v1", "g5soc.v1", "g5wrong.v1", "g5sync.meta", "g5sci.probe", "g5math.probe", "g5sci.v1", "g5sci.v1.archived", C.LS_KEY + ".fromV1", C.LS_KEY + ".x", ""].filter((k) => k !== C.LS_KEY)
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
  // 補充設計 C2：讀不到就回 READ（原本期待 SAVE_FAILED 是錯誤契約，已校正）
  assert.equal(r.error, "READ"); assert.equal(r.storageStatus, "readFailed"); assert.equal(B.get().stale, false); assert.equal(B.get().pendingAction.id, a.id);
  assert.equal(B.retry().ok, false); assert.equal(B.retry().error, "READ"); assert.equal(B.check().error, "READ");
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

/* ---------- 補充設計 task-mv6ujb6v-51m58n（docs/design-storage-resume-20261013.md）：單一存檔狀態 storageStatus＋共同 resume() ----------
   補充矩陣編號以 R 開頭（R01＝補充 T01），避免和原設計 T01–T33 混淆。故障一律以「操作＋key＋第幾次」定位（disk2 的 skip），不靠全域讀取次數。 */
const RESUME_SHA = "0c4586ff0fe28e4020fe3c4f0cbae37279c73ac1b8ba533f83759e774fa0b3fc";   // docs/design-storage-resume-20261013.md（補充設計全文）
const SS = (r) => r && r.storageStatus;
function okStore(b, init) { const mem = disk2(init); const st = open2(mem, b, sess()); return { mem, st }; }

test("R09 讀取失敗一律回 READ（C2）；4agent 方案 (a)：已有待存時新操作被拒收（BLOCKED、零讀寫、待存 id 不換）；retry／resume 讀失敗回 READ", () => {
  const b = bank(["s1", "s2"]);
  let { mem, st } = okStore(b); const a = op("answer", { cardId: "s1", ok: true });
  mem.fail("get", C.LS_KEY, { once: true });
  let r = st.dispatch(a);
  assert.deepEqual([r.ok, r.error, SS(r), r.pendingId], [false, "READ", "readFailed", a.id]); assert.equal(mem.muts(), 0);
  ({ mem, st } = okStore(b)); const A1 = op("answer", { cardId: "s1", ok: true }), B1 = op("answer", { cardId: "s2", ok: true });
  mem.fail("set", C.LS_KEY, { once: true }); assert.equal(st.dispatch(A1).error, "SAVE_FAILED"); assert.equal(st.get().storageStatus, "saveFailed");
  const m0 = mem.muts(), t0 = mem.touched.length;
  r = st.dispatch(B1);
  assert.deepEqual([r.ok, r.error, SS(r), r.pendingId], [false, "BLOCKED", "saveFailed", A1.id]); assert.equal(mem.muts(), m0); assert.equal(mem.touched.length, t0, "拒收時還讀了");
  mem.fail("get", C.LS_KEY, { once: true }); r = st.retry();
  assert.deepEqual([r.ok, r.error, SS(r), r.pendingId], [false, "READ", "readFailed", A1.id]); assert.equal(mem.muts(), m0);
  assert.ok(st.retry().ok); assert.ok(st.accepted(A1.id)); assert.equal(st.get().storageStatus, "ok");
  mem.fail("get", C.LS_KEY, { once: true }); r = st.retry();
  assert.deepEqual([r.ok, r.error, SS(r)], [false, "READ", "readFailed"]);
});

test("R10 真正寫入失敗後單獨 check() 成功不清「沒存」；無 id 的 tick 寫失敗也留「維護未完成」；resume 成功才解除", () => {
  const b = bank(["s1"]); let { mem, st } = okStore(b); const a = op("answer", { cardId: "s1", ok: true });
  mem.fail("set", C.LS_KEY, { once: true }); st.dispatch(a);
  let c = st.check(); assert.equal(c.ok, true); assert.equal(SS(c), "saveFailed", "check 讀成功不能清掉待存");
  assert.equal(st.get().pendingAction.id, a.id);
  let r = st.resume(); assert.ok(r.ok); assert.equal(SS(r), "ok"); assert.ok(st.accepted(a.id));
  ({ mem, st } = okStore(b));
  mem.fail("set", C.LS_KEY, { once: true }); r = st.dispatch({ type: "tick" });
  assert.deepEqual([r.ok, r.error, SS(r)], [false, "SAVE_FAILED", "saveFailed"]);
  assert.equal(SS(st.check()), "saveFailed", "tick 沒做完也是未完成");
  r = st.resume(); assert.ok(r.ok); assert.equal(SS(r), "ok");
});

test("R03（4agent 方案 (a)）答案寫失敗成為待存後，設定操作被拒收（不補寫答案、不收設定）；讀不到時 retry 回 READ；恢復後 resume 補寫答案", () => {
  const b = bank(["s1"]); const { mem, st } = okStore(b);
  const ans = op("answer", { cardId: "s1", ok: true }), set = op("settings", { sound: false });
  mem.fail("set", C.LS_KEY, { once: true }); st.dispatch(ans);
  const m0 = mem.muts();
  const rs = st.dispatch(set);
  assert.deepEqual([rs.ok, rs.error, rs.pendingId], [false, "BLOCKED", ans.id]); assert.equal(mem.muts(), m0); assert.equal(st.accepted(ans.id), false);
  mem.fail("get", C.LS_KEY, { once: true });
  const r = st.retry();
  assert.deepEqual([r.ok, r.error, SS(r), r.pendingId], [false, "READ", "readFailed", ans.id]); assert.equal(mem.muts(), m0);
  const r2 = st.resume(); assert.ok(r2.ok); assert.equal(SS(r2), "ok"); assert.equal(r2.acceptedId, ans.id); assert.equal(st.accepted(set.id), false, "被拒收的設定不該被偷偷補上");
});

test("R04／R05 resume：前置檢查成功、tick 讀 V 失敗——回 READ、不算成功；待存答案已補存的不回滾，下次 resume 同 id 不重複", () => {
  const b = bank(["s1"]);
  let { mem, st } = okStore(b);
  assert.ok(st.dispatch(op("answer", { cardId: "s1", ok: true })).ok);
  const v0 = mem.raw[C.LS_KEY];
  mem.fail("get", C.LS_KEY, { once: true, skip: 1 });          // resume 自己的前置讀取成功，tick 那次讀失敗
  let r = st.resume();
  assert.deepEqual([r.ok, r.error, SS(r)], [false, "READ", "readFailed"]); assert.equal(mem.raw[C.LS_KEY], v0);
  // R05：待存答案在 resume 中補存成功，後面的 tick 讀失敗
  ({ mem, st } = okStore(b)); const a = op("answer", { cardId: "s1", ok: true });
  mem.fail("set", C.LS_KEY, { once: true }); st.dispatch(a);
  mem.fail("get", C.LS_KEY, { once: true, skip: 2 });          // 前置讀、補寫前讀都成功；tick 讀失敗
  r = st.resume();
  assert.deepEqual([r.ok, r.error, SS(r)], [false, "READ", "readFailed"]);
  assert.equal(st.accepted(a.id), true, "已補存的答案被回滾"); assert.equal(JSON.parse(mem.raw[C.LS_KEY]).log.length, 1);
  r = st.resume(); assert.ok(r.ok); assert.equal(SS(r), "ok");
  assert.equal(JSON.parse(mem.raw[C.LS_KEY]).log.length, 1, "同一題記了兩次"); assert.ok(r.state.ops.indexOf(a.id) >= 0);
});

test("R06 READ 解除後：V 沒變才續接；被換掉或刪掉＝失效，舊待存不覆寫外部資料", () => {
  const b = bank(["s1", "s2"]);
  for (const how of ["沒變", "換掉", "刪掉"]) {
    const { mem, st } = okStore(b); assert.ok(st.dispatch(op("answer", { cardId: "s1", ok: true })).ok);
    const a = op("answer", { cardId: "s2", ok: true });
    mem.fail("get", C.LS_KEY, { once: true }); assert.equal(st.dispatch(a).error, "READ");
    if (how === "換掉") { const o = JSON.parse(mem.raw[C.LS_KEY]); o.settings.sound = !o.settings.sound; mem.raw[C.LS_KEY] = JSON.stringify(o); }
    if (how === "刪掉") delete mem.raw[C.LS_KEY];
    const before = mem.raw[C.LS_KEY], m0 = mem.muts();
    const r = st.resume();
    if (how === "沒變") { assert.ok(r.ok, how); assert.ok(st.accepted(a.id)); }
    else { assert.deepEqual([r.ok, r.error, SS(r)], [false, "STATE_CHANGED", "stale"], how); assert.equal(mem.muts(), m0, how); assert.equal(mem.raw[C.LS_KEY], before, how); }
  }
});

test("R11 失效後連點重試、重複通知：零寫入、狀態一直是 stale，同一 store 不會自己回 ok", () => {
  const b = bank(["s1"]); const { mem, st } = okStore(b); assert.ok(st.dispatch(op("answer", { cardId: "s1", ok: true })).ok);
  delete mem.raw[C.LS_KEY]; const m0 = mem.muts();
  for (let i = 0; i < 3; i++) { assert.equal(SS(st.resume()), "stale"); assert.equal(SS(st.retry()), "stale"); assert.equal(SS(st.check()), "stale"); }
  assert.equal(st.get().storageStatus, "stale"); assert.equal(mem.muts(), m0);
});

test("R22 本站 docs/ 有兩份設計全文（原設計＋補充設計），受 Git 追蹤、內容與四站一致（SHA-256）、不是連結", () => {
  const fs = require("fs"), path = require("path"), cp = require("child_process"), crypto = require("crypto");
  const root = path.join(__dirname, "..");
  const want = { "docs/design-storage-base-20261013.md": "46f8cca9d044122a01b8244228018c0e2634566c8cb9d36dbcc0fd16ad6b4c73",
                 "docs/design-storage-resume-20261013.md": RESUME_SHA };
  for (const [f, sha] of Object.entries(want)) {
    const p = path.join(root, f);
    assert.ok(fs.existsSync(p), f + " 不存在"); assert.equal(fs.lstatSync(p).isSymbolicLink(), false, f + " 是連結");
    assert.equal(crypto.createHash("sha256").update(fs.readFileSync(p)).digest("hex"), sha, f + " 內容和其他站不一致");
    assert.equal(cp.execFileSync("git", ["ls-files", "--error-unmatch", f], { cwd: root }).toString().trim(), f, f + " 沒有受 Git 追蹤");
  }
});

test("R25 交付產物與來源一致：依 build.py 的組裝規則在記憶體重建，與 index.html 逐字相同（自然站另核 v3/index.html）", () => {
  const fs = require("fs"), path = require("path"); const root = path.join(__dirname, "..");
  const body = fs.readFileSync(path.join(root, "src/app.html"), "utf8").replace(/<!--@INLINE (src\/[A-Za-z0-9_.-]+\.js)-->/g,
    (m, f) => "<script>\n" + fs.readFileSync(path.join(root, f), "utf8") + "\n</script>");
  const idx = fs.readFileSync(path.join(root, "index.html"), "utf8");
  assert.ok(idx.endsWith(body + "</body></html>"), "index.html 不是由目前的 src 建出來的");
  if (fs.existsSync(path.join(root, "v3/index.html"))) assert.equal(fs.readFileSync(path.join(root, "v3/index.html"), "utf8"), idx, "v3/index.html 與 index.html 不同");
});

/* ---------- 自然站（C4／C5）：家長選擇每次重驗 V/O/A、首次選擇綁定候選、封存 pending 由現況解除 ---------- */









/* ---------- 第 3 輪（Codex 審 9b88c94／1e51dc0／47486df／55509eb）四站共同：待存 ID 分離、tick 未完成不前進 ---------- */
test("R27（4agent 方案 (a)）待存 ID 不再分離：核心另有待存（設定）時，作答被拒收（BLOCKED、零讀寫、待存仍是設定）；resume 只補寫那唯一一筆，作答由畫面在恢復後重做", () => {
  const b = bank(["s1"]); const { mem, st } = okStore(b);
  const set = op("settings", { sound: false }), ans = op("answer", { cardId: "s1", ok: true });
  mem.fail("set", C.LS_KEY, { once: true }); assert.equal(st.dispatch(set).error, "SAVE_FAILED");
  const t0 = mem.touched.length;
  const r = st.dispatch(ans);
  assert.deepEqual([r.ok, r.error, r.pendingId], [false, "BLOCKED", set.id]); assert.equal(mem.touched.length, t0); assert.equal(st.accepted(ans.id), false);
  const z = st.resume();
  assert.ok(z.ok); assert.equal(z.storageStatus, "ok"); assert.equal(z.acceptedId, set.id);
  const s = JSON.parse(mem.raw[C.LS_KEY]); assert.equal(s.settings.sound, false); assert.equal(s.log.length, 0, "被拒收的作答不該被補上");
  assert.ok(st.dispatch(ans).ok); assert.equal(JSON.parse(mem.raw[C.LS_KEY]).log.length, 1);
});

test("R28（4agent 方案 (a)）tick 沒做完（tickDue）時其他操作被拒收（BLOCKED、零寫入）；resume 補完 tick 才回 ok，之後才收新操作", () => {
  const b = bank(["s1"]); const { mem, st } = okStore(b);
  mem.fail("set", C.LS_KEY, { once: true }); assert.equal(st.dispatch({ type: "tick" }).error, "SAVE_FAILED");
  const m0 = mem.muts();
  const r = st.dispatch(op("answer", { cardId: "s1", ok: true }));
  assert.equal(r.error, "BLOCKED"); assert.equal(r.storageStatus, "saveFailed"); assert.equal(st.get().tickDue, true); assert.equal(mem.muts(), m0);
  const z = st.resume(); assert.ok(z.ok); assert.equal(z.storageStatus, "ok"); assert.equal(st.get().tickDue, false);
  assert.ok(st.dispatch(op("answer", { cardId: "s1", ok: true })).ok);
});

/* ---------- 自然站舊版功能縮範圍（4agent 最終方案 (a)，docs/design-storage-scopecut-20261014.md）：L01–L16 ----------
   自然站也設 LS_V1＝null：完全不讀、不寫、不刪舊版 g5sci.v1（O）、封存 g5sci.v1.archived（A）與舊標記；只剩 O／A 的裝置從空白開始，原文不動。
   L01–L11 由會診原型 accept_core.js 移植；L14 在 tests/e2e_v3.py（真實瀏覽器跑原始畫面）。 */
const LO = "g5sci.v1", LA = "g5sci.v1.archived";
const L_OLD = [LO, LA, C.LS_KEY + ".fromV1", C.LS_KEY + ".noMigrate", "null", "undefined"];
const LV1 = JSON.stringify({ v: 1, cards: { s1: { box: 1, streak: 1, due: "2026-10-21", seen: 7, right: 2, wrong: 0, retired: false } } });
const LA2 = JSON.stringify({ v: 1, cards: { s2: { box: 2, streak: 2, due: "2026-10-22", seen: 3, right: 3, wrong: 0, retired: false } } });
function ldisk(init, throwOld) {
  const m = Object.assign({}, init || {}); const touched = []; let writes = 0;
  const chk = (k) => { touched.push(k); if (throwOld && L_OLD.indexOf(k) >= 0) throw new Error("SecurityError"); };
  return { getItem: (k) => { k = String(k); chk(k); return has(m, k) ? m[k] : null; },
    setItem: (k, v) => { k = String(k); chk(k); writes++; m[k] = String(v); },
    removeItem: (k) => { k = String(k); chk(k); writes++; delete m[k]; }, raw: m, touched, writes: () => writes };
}
function lsess(fail) { const m = {}; return fail ? { getItem: () => { throw new Error("x"); }, setItem: () => { throw new Error("x"); }, removeItem: () => { throw new Error("x"); } }
  : { getItem: (k) => (k in m ? m[k] : null), setItem: (k, v) => { m[k] = String(v); }, removeItem: (k) => { delete m[k]; } }; }
const LB = bank(["s1", "s2"]);
function lopen(mem, ss) { const s = C.createStore({ storage: mem, bank: LB, clock: () => NOON(D), session: ss || null }); s.load(); return s; }
const oldTouched = (mem) => mem.touched.filter((k) => L_OLD.indexOf(k) >= 0);
function validV() { const s = lopen(ldisk()); s.dispatch(op("answer", { cardId: "s2", ok: true })); return JSON.stringify(s.get().state); }

test("L01 只有合法 O：開頁不封鎖、可作答寫 V 一次、O 原文不動、零碰舊 key", () => {
  const mem = ldisk({ [LO]: LV1 }); const s = lopen(mem); assert.equal(s.get().loadError, null); assert.equal(s.get().migrated, false);
  assert.ok(s.dispatch(op("answer", { cardId: "s1", ok: true })).ok); assert.equal(mem.raw[LO], LV1); assert.equal(mem.writes(), 1); assert.deepEqual(oldTouched(mem), []);
});
test("L02 只有壞 O：同 L01（不因壞 O 卡住）", () => {
  const mem = ldisk({ [LO]: "{壞" }); const s = lopen(mem); assert.equal(s.get().loadError, null);
  assert.ok(s.dispatch(op("answer", { cardId: "s1", ok: true })).ok); assert.equal(mem.raw[LO], "{壞"); assert.deepEqual(oldTouched(mem), []);
});
test("L03 只有 A：空白、可作答、A 不動、零碰舊 key、沒有恢復入口（legacy 為 null）", () => {
  const mem = ldisk({ [LA]: LV1 }); const s = lopen(mem); assert.equal(s.get().loadError, null); assert.equal(s.get().legacy || null, null);
  assert.ok(s.dispatch(op("answer", { cardId: "s1", ok: true })).ok); assert.equal(mem.raw[LA], LV1); assert.deepEqual(oldTouched(mem), []);
});
test("L04 O、A 都在且不同：沒有衝突狀態、O／A 都不動、正常作答", () => {
  const mem = ldisk({ [LO]: LV1, [LA]: LA2 }); const s = lopen(mem); assert.equal(s.get().loadError, null);
  assert.ok(s.dispatch(op("answer", { cardId: "s1", ok: true })).ok); assert.deepEqual([mem.raw[LO], mem.raw[LA]], [LV1, LA2]); assert.deepEqual(oldTouched(mem), []);
});
test("L05 V＋O（線上搬過的裝置）：用 V、開頁零寫入、不建 A、O 原文不動", () => {
  const V = validV(); const mem = ldisk({ [C.LS_KEY]: V, [LO]: LV1 }); const s = lopen(mem); assert.deepEqual(Object.keys(s.get().state.cards), ["s2"]);
  assert.equal(mem.writes(), 0); assert.equal(has(mem.raw, LA), false); assert.equal(mem.raw[LO], LV1); assert.deepEqual(oldTouched(mem), []);
});
test("L06 V＋O，外部刪 V（分頁暫存正常／拋錯）：先失效，重載後空白、migrated=false、O 原文在、重載零寫入", () => {
  for (const sf of [false, true]) {
    const V = validV(); const mem = ldisk({ [C.LS_KEY]: V, [LO]: LV1 }); const ss = lsess(sf); const s = lopen(mem, ss);
    delete mem.raw[C.LS_KEY]; assert.equal(s.check().error, "STATE_CHANGED"); s.prepareReload(); const w0 = mem.writes(); const s2 = lopen(mem, ss);
    assert.deepEqual(Object.keys(s2.get().state.cards), []); assert.equal(s2.get().migrated, false); assert.equal(mem.raw[LO], LV1);
    assert.equal(has(mem.raw, C.LS_KEY), false); assert.equal(mem.writes(), w0);
  }
});
test("L07 舊 key（O、A、.fromV1、.noMigrate、\"null\"、\"undefined\"）一碰就拋錯：load／dispatch／retry／check／resume 不拋、不 READ、零碰", () => {
  const init = {}; L_OLD.forEach((k) => { init[k] = LV1; }); const mem = ldisk(init, true); const s = lopen(mem);
  assert.equal(s.get().loadError, null); assert.ok(s.dispatch(op("answer", { cardId: "s1", ok: true })).ok);
  assert.ok(s.retry().ok); assert.equal(s.check().error, null); assert.ok(s.resume().ok); assert.deepEqual(oldTouched(mem), []);
});
test("L08 V＋O 按清除全部：V 變空白、O 原文不動、重載仍空白", () => {
  const V = validV(); const mem = ldisk({ [C.LS_KEY]: V, [LO]: LV1 }); const s = lopen(mem); assert.ok(s.dispatch(op("reset")).ok);
  assert.deepEqual(Object.keys(JSON.parse(mem.raw[C.LS_KEY]).cards), []); assert.equal(mem.raw[LO], LV1); s.prepareReload();
  assert.deepEqual(Object.keys(lopen(mem).get().state.cards), []); assert.deepEqual(oldTouched(mem), []);
});
test("L09 已移除的家長選擇／封存入口：呼叫一律回 NOTHING、零 I/O、不建 V", () => {
  const mem = ldisk({ [LO]: LV1, [LA]: LV1 }); const s = lopen(mem); const before = mem.touched.length;
  for (const f of ["restoreLegacy", "retryArchive"]) { if (typeof s[f] !== "function") continue;
    for (const a of ["restore", "fresh", "recheck"]) { const r = s[f](a); assert.deepEqual([r.ok, r.error], [false, "NOTHING"], f + "(" + a + ")"); } }
  assert.equal(mem.touched.length, before, "入口仍有 I/O"); assert.equal(has(mem.raw, C.LS_KEY), false);
});
test("L10 只有 O，作答／retry／resume 都不寫 A；archive 為 null（無鑑別力，回歸防護）", () => {
  const mem = ldisk({ [LO]: LV1 }); const s = lopen(mem); s.dispatch(op("answer", { cardId: "s1", ok: true })); s.retry(); s.resume();
  assert.equal(has(mem.raw, LA), false); assert.equal(s.get().archive === null || s.get().archive === undefined, true);
});
test("L11 只有 V＋O、讀 O 會拋錯：開頁 loadError=null、storageStatus=ok、archive=null", () => {
  const V = validV(); const mem = ldisk({ [C.LS_KEY]: V, [LO]: LV1 }, true); const s = lopen(mem);
  assert.equal(s.get().loadError, null); assert.equal(s.get().storageStatus, "ok"); assert.equal(s.get().archive || null, null);
});
test("L12 建置產物不含舊版畫面元件（legacyBox／legacyRestore／legacyFresh／legacyRecheck／archiveNote／restoreArchived／archiveRetry），也不讀 C.LS_V1", () => {
  const fs = require("fs"), path = require("path"); const root = path.join(__dirname, "..");
  for (const f of ["src/app.html", "index.html", "v3/index.html"]) {
    if (!fs.existsSync(path.join(root, f))) continue;
    const t = fs.readFileSync(path.join(root, f), "utf8");
    const hit = t.match(/legacyBox|legacyRestore|legacyFresh|legacyRecheck|archiveNote|restoreArchived|archiveRetry|getItem\(C\.LS_V1\)|getItem\(C\.LS_ARC\)/g);
    assert.equal(hit, null, f + " 還有舊版元件：" + JSON.stringify(hit));
  }
});
test("L13 原始 makeStorage（vm 執行）：probe 寫不進時只讀新版 key；V 在或讀 V 拋錯＝真實儲存，V 確認不存在才用記憶體", () => {
  const fs = require("fs"), path = require("path"), vm = require("vm");
  const src = fs.readFileSync(path.join(__dirname, "..", "src/app.html"), "utf8"); const fn = src.match(/function makeStorage\(\)\{[\s\S]*?\n\}\n/);
  assert.ok(fn, "找不到 makeStorage");
  const probe = C.LS_KEY.split(".")[0] + ".probe";
  for (const [how, init, readThrows] of [["只有 O", { [LO]: LV1 }, false], ["只有 A", { [LA]: LV1 }, false], ["V 在", { [C.LS_KEY]: "{}" }, false], ["讀 V 拋錯", {}, true]]) {
    const touched = []; const ls = { getItem: (k) => { k = String(k); touched.push(k); if (readThrows) throw new Error("SecurityError"); return has(init, k) ? init[k] : null; },
      setItem: (k) => { touched.push(String(k)); throw new Error("QuotaExceededError"); }, removeItem: (k) => { touched.push(String(k)); } };
    const ctx = { window: { localStorage: ls }, C: C, out: null, mo: null };
    vm.runInNewContext("var memoryOnly=false;" + fn[0] + "out=makeStorage();mo=memoryOnly;", ctx);
    assert.deepEqual(touched.filter((k) => k !== C.LS_KEY && k !== probe), [], how + "：讀了舊版 key");
    const real = how === "V 在" || how === "讀 V 拋錯";
    assert.equal(ctx.out === ls, real, how + "：回傳的儲存不對"); assert.equal(ctx.mo, !real, how + "：memoryOnly 不對");
  }
});
test("L15 自然站也跑 T17（不碰舊版與標記 key）：T17 的 skip 條件在本站為 false", () => {
  assert.equal(C.LS_V1, null); assert.equal(C.LS_V1 !== null && ONLY_THREE, false);
});
test("L16 設計文件：原兩份 SHA 不變；縮範圍文件受 Git 追蹤，含 29 條處置表與 owner 決定", { skip: !SCI && "自然站專屬（縮範圍文件只在自然站）" }, () => {
  const fs = require("fs"), path = require("path"), cp = require("child_process"), crypto = require("crypto"); const root = path.join(__dirname, "..");
  const sha = (f) => crypto.createHash("sha256").update(fs.readFileSync(path.join(root, f))).digest("hex");
  assert.equal(sha("docs/design-storage-base-20261013.md"), "46f8cca9d044122a01b8244228018c0e2634566c8cb9d36dbcc0fd16ad6b4c73");
  assert.equal(sha("docs/design-storage-resume-20261013.md"), RESUME_SHA);
  const f = "docs/design-storage-scopecut-20261014.md";
  assert.ok(fs.existsSync(path.join(root, f)), f + " 不存在");
  assert.equal(cp.execFileSync("git", ["ls-files", "--error-unmatch", f], { cwd: root }).toString().trim(), f);
  const t = fs.readFileSync(path.join(root, f), "utf8");
  assert.ok(/owner 決定/.test(t) && /只剩 O／A 的裝置從空白開始/.test(t), "缺 owner 決定");
  assert.equal((t.match(/^\| D\d{2} /gm) || []).length, 29, "處置表不是 29 條");
});

/* ---------- 4agent 最終方案 (a)「存檔一不正常就整頁暫停，核心只留一筆」（docs/design-storage-pause-20261014.md）：A 列（核心） ----------
   狀態不是 ok（有待存、tick 沒做完、讀不到、開頁封鎖、已失效）時，核心拒收任何新操作（BLOCKED、零讀零寫）；只有 resume() 能補存唯一那一筆。 */
function pdisk(init) {   // 計次替身：讀、寫分開數；f.read／f.write 持續故障；failNth(op, n) 讓第 n 次（從 0 起）讀或寫失敗一次
  const m = Object.assign({}, init || {}); const f = { read: false, write: false }; let reads = 0, writes = 0; const nth = { get: -1, set: -1 };
  return {
    getItem: (k) => { k = String(k); if (k === C.LS_KEY) { if (nth.get === 0) { nth.get = -1; reads++; throw new Error("SecurityError"); } if (nth.get > 0) nth.get--; } reads++; if (f.read) throw new Error("SecurityError"); return has(m, k) ? m[k] : null; },
    setItem: (k, v) => { k = String(k); if (k === C.LS_KEY) { if (nth.set === 0) { nth.set = -1; throw new Error("QuotaExceededError"); } if (nth.set > 0) nth.set--; } if (f.write) throw new Error("QuotaExceededError"); writes++; m[k] = String(v); },
    removeItem: (k) => { writes++; delete m[k]; }, raw: m, f, reads: () => reads, writes: () => writes,
    failNth: (o, n) => { nth[o] = n; }
  };
}
const ALL_OPS = () => [op("answer", { cardId: "s1", ok: true }), op("settings", { sound: false }), { type: "tick" }, op("sessionStart"), op("labStart", { runId: "rz", lab: "x", tasks: 2, answer: 0, from: "menu" }),
  op("labPredict", { runId: "rz", choice: 0 }), op("labTask", { runId: "rz", task: 0 }), op("labComplete", { runId: "rz" }), op("help", { cid: "1-1", ways: 2 }), op("mood", { value: "good" }),
  op("teach", { cardId: "s1" }), op("exit", { cid: "1-1", result: "pass" }), op("exitRetest", { cid: "1-1" }), op("helped", { cid: "1-1" }), op("reset"), op("import", { cards: [] })];

test("A01 設定寫失敗成為待存後：直接送作答、tick、任何操作都 BLOCKED，零讀零寫、待存仍是設定", () => {
  const b = bank(["s1"]); const mem = pdisk(); const st = open(mem, b, sess());
  const set = op("settings", { sound: false }); mem.f.write = true; assert.equal(st.dispatch(set).error, "SAVE_FAILED"); mem.f.write = false;
  const r0 = mem.reads(), w0 = mem.writes();
  const r = st.dispatch(op("answer", { cardId: "s1", ok: true }));
  assert.deepEqual([r.ok, r.error, r.pendingId, r.storageStatus], [false, "BLOCKED", set.id, "saveFailed"]);
  assert.equal(st.dispatch({ type: "tick" }).error, "BLOCKED");
  assert.deepEqual([mem.reads() - r0, mem.writes() - w0], [0, 0], "拒收時還讀寫了");
});

test("A17 讀取失敗一律回 READ：狀態 ok 時 dispatch 讀失敗；resume 的前置讀、補存讀、tick 讀各自失敗——都是 READ、待存 id 不變、不改報 SAVE_*", () => {
  const b = bank(["s1"]);
  let mem = pdisk(); let st = open(mem, b, sess()); const a = op("answer", { cardId: "s1", ok: true });
  mem.failNth("get", 0); let r = st.dispatch(a);
  assert.deepEqual([r.ok, r.error, r.pendingId, r.storageStatus], [false, "READ", a.id, "readFailed"]);
  for (const k of [0, 1, 2]) {   // resume：0＝前置讀、1＝補存前讀、2＝tick 前讀
    mem = pdisk(); st = open(mem, b, sess()); const x = op("answer", { cardId: "s1", ok: true });
    mem.f.write = true; st.dispatch(x); mem.f.write = false;
    mem.failNth("get", k); r = st.resume();
    assert.deepEqual([r.ok, r.error, r.storageStatus], [false, "READ", "readFailed"], "第 " + k + " 次讀");
    assert.equal(st.get().pendingAction ? st.get().pendingAction.id : null, k < 2 ? x.id : null, "待存被換掉");
  }
});

test("A18 讀不到之後單獨 check() 讀成功：storageStatus 仍是 readFailed，只有 resume() 整條成功才解除", () => {
  const b = bank(["s1"]); const mem = pdisk(); const st = open(mem, b, sess());
  mem.failNth("get", 0); st.dispatch(op("answer", { cardId: "s1", ok: true }));
  const c = st.check(); assert.equal(c.storageStatus, "readFailed"); assert.equal(st.get().storageStatus, "readFailed");
  const r = st.resume(); assert.ok(r.ok); assert.equal(r.storageStatus, "ok");
});

test("A14／A15 開頁就讀不到：狀態是 blocked、resume 回 RELOAD_REQUIRED（不回 ok）、零寫入；重載後照常載入原文", () => {
  const b = bank(["s1"]);
  for (const init of [{}, null]) {
    const seed = pdisk(); if (init === null) { const s0 = open(seed, b); assert.ok(s0.dispatch(op("answer", { cardId: "s1", ok: true })).ok); }
    const mem = pdisk(seed.raw); mem.f.read = true; const st = open(mem, b, sess()); mem.f.read = false;
    assert.equal(st.get().storageStatus, "blocked"); const w0 = mem.writes();
    const r = st.resume(); assert.equal(r.ok, false); assert.equal(r.error, "RELOAD_REQUIRED");
    assert.equal(st.dispatch(op("answer", { cardId: "s1", ok: true })).error, "BLOCKED"); assert.equal(mem.writes(), w0);
    st.prepareReload(); const st2 = open(mem, b, sess()); assert.equal(st2.get().storageStatus, "ok");
    assert.deepEqual(Object.keys(st2.get().state.cards), init === null ? ["s1"] : []);
  }
});

test("A16 壞檔（SCHEMA）：狀態是 blocked、作答 BLOCKED；家長清除寫空白一次、狀態回 ok", () => {
  const b = bank(["s1"]); const mem = pdisk({ [C.LS_KEY]: "{壞" }); const st = open(mem, b, sess());
  assert.equal(st.get().storageStatus, "blocked"); assert.equal(st.dispatch(op("answer", { cardId: "s1", ok: true })).error, "BLOCKED"); assert.equal(mem.writes(), 0);
  assert.equal(st.discardBroken(), true); assert.equal(mem.writes(), 1); assert.equal(st.get().storageStatus, "ok");
  assert.ok(st.dispatch(op("answer", { cardId: "s1", ok: true })).ok);
});

test("A16b 壞檔＋先讀失敗一次（readFailed 殘留）：恢復儲存後家長清除成功，狀態直接回 ok、作答照收（審 Codex 1e929cd）", () => {
  const b = bank(["s1"]); const mem = pdisk({ [C.LS_KEY]: "{壞" }); const st = open(mem, b, sess());
  mem.failNth("get", 0); st.check(); mem.failNth("get", -1);
  assert.equal(st.discardBroken(), true);
  assert.equal(st.get().storageStatus, "ok");
  assert.ok(st.dispatch(op("answer", { cardId: "s1", ok: true })).ok);
});

test("A07 待存答案在 resume 中補存成功、接著 tick 讀失敗：答案已存但不算成功；回饋資訊留在核心，下次 resume 成功後 takeInfo 取得一次（畢業）", () => {
  const b = bank(["s1"]); const mem = pdisk(); const st = open(mem, b, sess());
  const s = JSON.parse(JSON.stringify(C.blankState())); s.cards.s1 = { seen: 2, goodDays: ["2026-10-17", "2026-10-18"], blockedDay: null, due: D };
  mem.raw[C.LS_KEY] = JSON.stringify(s); const st2 = open(mem, b, sess()); void st;
  const a = op("answer", { cardId: "s1", ok: true });
  mem.f.write = true; st2.dispatch(a); mem.f.write = false;
  mem.failNth("get", 2); const r = st2.resume();
  assert.equal(r.error, "READ"); assert.equal(st2.accepted(a.id), true, "答案被回滾");
  const r2 = st2.resume(); assert.ok(r2.ok);
  const info = st2.takeInfo(a.id); assert.ok(info && info.graduated, "畢業資訊遺失：" + JSON.stringify(info)); assert.equal(st2.takeInfo(a.id), null, "取了兩次");
});

test("A19 狀態不是 ok 時，16 種操作逐一送進核心：全部 BLOCKED、零讀零寫、磁碟原文不變", () => {
  const b = bank(["s1"]);
  for (const how of ["saveFailed", "readFailed", "tickDue"]) {
    const mem = pdisk(); const st = open(mem, b, sess()); assert.ok(st.dispatch(op("sessionStart")).ok);
    if (how === "saveFailed") { mem.f.write = true; st.dispatch(op("answer", { cardId: "s1", ok: true })); mem.f.write = false; }
    if (how === "readFailed") { mem.failNth("get", 0); st.dispatch(op("answer", { cardId: "s1", ok: true })); }
    if (how === "tickDue") { mem.f.write = true; st.dispatch({ type: "tick" }); mem.f.write = false; }
    const d0 = mem.raw[C.LS_KEY], r0 = mem.reads(), w0 = mem.writes();
    for (const a of ALL_OPS()) assert.equal(st.dispatch(a).error, "BLOCKED", how + " " + a.type);
    assert.deepEqual([mem.reads() - r0, mem.writes() - w0, mem.raw[C.LS_KEY] === d0], [0, 0, true], how);
  }
});

test("A20 列舉：長度 ≤4 的操作序列（作答／設定／tick／離開題目）× 每步故障（無／讀／寫），恢復後 resume 兩次——沒有任何作答默默遺失、狀態組合 ≤7", () => {
  const b = { cards: ["s1", "s2", "s3"].map(card), concepts: CONCEPTS, figs: {} };
  const STEPS = ["A", "S", "T", "N"], FAULTS = ["none", "read", "write"]; const states = new Set(); let seqs = 0, lost = 0;
  const all = []; const rec = (pre, d) => { if (pre.length) all.push(pre); if (!d) return; for (const s of STEPS) for (const f of FAULTS) rec(pre.concat([[s, f]]), d - 1); }; rec([], 4);
  for (const seq of all) {
    seqs++; const mem = pdisk(); const st = open(mem, b); st.dispatch(op("sessionStart")); const submitted = [], rejected = new Set();
    for (const [s, f] of seq) {
      mem.f.read = f === "read"; mem.f.write = f === "write";
      if (s === "T") st.dispatch({ type: "tick" });
      else if (s !== "N") { const a = op(s === "A" ? "answer" : "settings", s === "A" ? { cardId: "s1", ok: true } : { sound: false }); if (s === "A") submitted.push(a.id);
        const r = st.dispatch(a); if (r.error === "BLOCKED") rejected.add(a.id); }
      const g = st.get(); states.add([g.pendingAction ? g.pendingAction.type : "-", g.tickDue ? 1 : 0, g.readFailed ? 1 : 0, g.storageStatus].join("|"));
    }
    mem.f.read = false; mem.f.write = false; st.resume(); st.resume();
    const saved = mem.raw[C.LS_KEY] ? JSON.parse(mem.raw[C.LS_KEY]).ops : [];
    if (submitted.some((id) => !saved.includes(id) && !rejected.has(id))) lost++;
    assert.equal(st.get().storageStatus, "ok", "恢復後卡住：" + JSON.stringify(seq));
  }
  assert.equal(seqs, 22620); assert.equal(lost, 0, "有作答默默遺失"); assert.ok(states.size <= 7, "狀態組合 " + states.size + "：" + JSON.stringify([...states]));
});

test("A21 恢復後連按兩次再試一次：答案只記一次、回饋資訊只給一次", () => {
  const b = bank(["s1"]); const mem = pdisk(); const st = open(mem, b, sess()); const a = op("answer", { cardId: "s1", ok: true });
  mem.f.write = true; st.dispatch(a); mem.f.write = false;
  const r1 = st.resume(), r2 = st.resume(); assert.ok(r1.ok && r2.ok); assert.equal(r1.acceptedId, a.id);
  assert.equal(JSON.parse(mem.raw[C.LS_KEY]).log.length, 1); assert.ok(st.takeInfo(a.id)); assert.equal(st.takeInfo(a.id), null);
});

test("N24 四站 createStore 逐字相同（SHA-256）；本站 docs 有暫停規格全文（四站相同）", () => {
  const fs = require("fs"), path = require("path"), crypto = require("crypto"), cp = require("child_process"); const root = path.join(__dirname, "..");
  const src = fs.readFileSync(path.join(root, "src/core.js"), "utf8");
  const a = src.indexOf("  function createStore(opt) {"), b = src.indexOf("  /* ---------- 溶解帳本");
  assert.ok(a > 0 && b > a, "找不到 createStore");
  assert.equal(crypto.createHash("sha256").update(src.slice(a, b)).digest("hex"), "cff42ed04be2e207d127e93d8d25983479518034362219b8bc046c36d9e3bc9f", "本站 createStore 和四站共同版本不同");
  const f = "docs/design-storage-pause-20261014.md";
  assert.equal(crypto.createHash("sha256").update(fs.readFileSync(path.join(root, f))).digest("hex"), "e94b2a92632bb7a1a699b512ac2dd99480c2a9792b314c714858e993a91405cf", f + " 和四站不一致");
  assert.equal(cp.execFileSync("git", ["ls-files", "--error-unmatch", f], { cwd: root }).toString().trim(), f);
});
