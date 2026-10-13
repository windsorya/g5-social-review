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

test("T06（修訂）自然站：完成 S2 後刪 V、失效重載、再整理：V 不補回、O 不存在、A 原文完整；可從新紀錄開始", { skip: !SCI && NO_LEGACY }, () => {
  const b = bank(["s1", "s2"]); const mem = disk2({ [O]: V1 }); const ss = sess();
  const B = finishS2(mem, b, ss);
  mem.removeItem(C.LS_KEY);
  assert.ok(isChanged(B.dispatch({ type: "tick" })));
  const m0 = mem.muts();
  const B2 = reload(B, mem, b, ss);
  assert.equal(B2.get().loadError, null, "只剩 A 時不該擋作答"); assert.equal(B2.get().migrated, false);
  assert.deepEqual(keys(B2), []); assert.equal(mem.muts(), m0, "重載時寫了東西");
  assert.equal(mem.raw[C.LS_KEY], undefined); assert.equal(mem.raw[O], undefined); assert.equal(mem.raw[A], V1);
  const B3 = open2(mem, b, ss);
  assert.equal(mem.raw[C.LS_KEY], undefined, "再整理一次補回了 V"); assert.equal(mem.muts(), m0);
  assert.ok(B3.dispatch(op("answer", { cardId: "s2", ok: true })).ok);
  assert.deepEqual(cards(mem), ["s2"]); assert.equal(mem.raw[A], V1); assert.equal(mem.raw[O], undefined);
});

test("T17 三站：舊版／標記 key 放合法或壞的 v1，而且一碰就拋錯——load 與一般使用完全不碰它們、不碰 \"null\"，照常用現行存檔", { skip: SCI && ONLY_THREE }, () => {
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

test("T18 自然站：封存完成後，分頁暫存 null／寫入拋錯／靜默未寫，以及分頁暫存與本機存檔同時寫不進——刪 V 後重載：O 仍不存在、A 保留、V 不補回、重載零寫入", { skip: !SCI && NO_LEGACY }, () => {
  const sessions = [["null", () => null], ["寫入拋錯", () => ({ getItem: () => null, setItem: () => { throw new Error("QuotaExceededError"); }, removeItem: () => {} })],
    ["靜默未寫", () => ({ getItem: () => null, setItem: () => {}, removeItem: () => {} })]];
  for (const [how, mk] of sessions) for (const both of [false, true]) {
    const b = bank(["s1", "s2"]); const mem = disk2({ [O]: V1 });
    const B = finishS2(mem, b, mk());
    mem.removeItem(C.LS_KEY); assert.ok(isChanged(B.check()), how);
    if (both) mem.fail("set");
    B.prepareReload(); mem.heal();
    const m0 = mem.muts();
    const B2 = open2(mem, b, mk());
    assert.equal(mem.raw[O], undefined, how); assert.equal(mem.raw[A], V1, how); assert.equal(mem.raw[C.LS_KEY], undefined, how + "：V 被補回");
    assert.equal(mem.muts(), m0, how + "：重載時寫了"); assert.deepEqual(keys(B2), [], how);
    assert.notEqual(B2.get().loadError, "LEGACY", how + "：O 不在了，不該再問");
  }
  // 讀取失敗則顯示 READ（不當成不存在）
  const b = bank(["s1"]); const mem = disk2({ [O]: V1 }); finishS2(mem, b, null); mem.removeItem(C.LS_KEY);
  mem.fail("get", A, { once: true }); const R = open2(mem, b, null);
  assert.equal(R.get().loadError, "READ"); assert.equal(mem.raw[C.LS_KEY], undefined);
});

test("T19 自然站：舊安裝 V、O 並存（無標記）、封存寫不進，接著外部刪 V、強制重開：O 保留、V 不重建、顯示家長選擇，不呈現舊進度已恢復", { skip: !SCI && NO_LEGACY }, () => {
  const b = bank(["s1", "s2"]); const v3 = C.blankState(); v3.cards.s2 = { seen: 1, goodDays: [], blockedDay: null, due: "2026-10-21" };
  const mem = disk2({ [C.LS_KEY]: JSON.stringify(v3), [O]: V1 }); mem.fail("set");
  const B = open2(mem, b, null);
  assert.equal(B.get().loadError, null); assert.equal(B.get().archive, "pending", "封存失敗要看得見");
  assert.deepEqual(keys(B), ["s2"]); assert.equal(mem.raw[O], V1); assert.equal(mem.raw[A], undefined);
  mem.removeItem(C.LS_KEY); assert.ok(isChanged(B.check())); B.prepareReload(); mem.heal();
  const m0 = mem.muts();
  const B2 = open2(mem, b, null);
  assert.equal(mem.muts(), m0, "重開時寫了"); assert.equal(mem.raw[C.LS_KEY], undefined, "V 被重建"); assert.equal(mem.raw[O], V1);
  assert.equal(B2.get().loadError, "LEGACY"); assert.equal(B2.get().migrated, false); assert.deepEqual(keys(B2), []);
  assert.equal(B2.dispatch(op("answer", { cardId: "s1", ok: true })).ok, false, "家長選擇前不能存作答");
  assert.equal(mem.raw[C.LS_KEY], undefined);
});

test("T20 自然站：A 寫成功、緊接的回讀拋錯一次：不刪 V、O、A 都留著；不重新搬移；顯示封存未完成，恢復後續做完成", { skip: !SCI && NO_LEGACY }, () => {
  const b = bank(["s1"]); const v3 = JSON.stringify(C.blankState());
  const mem = disk2({ [C.LS_KEY]: v3, [O]: V1 }); mem.fail("get", A, { once: true, after: "set:" + A });
  const B = open2(mem, b, null);
  assert.equal(B.get().archive, "pending"); assert.equal(B.get().loadError, null);
  assert.equal(mem.raw[C.LS_KEY], v3, "V 被動了"); assert.equal(mem.raw[O], V1); assert.equal(mem.raw[A], V1);
  const r = B.retryArchive();
  assert.ok(r.ok); assert.equal(r.archive, "done"); assert.equal(mem.raw[O], undefined); assert.equal(mem.raw[A], V1); assert.equal(mem.raw[C.LS_KEY], v3);
});

test("T21 自然站：O 與舊 .fromV1=1 存在、V 不存在，舊標記一讀就拋錯：不讀舊標記、不寫 V、顯示恢復選擇；必要的 A 讀取失敗一次就停（READ）", { skip: !SCI && NO_LEGACY }, () => {
  const b = bank(["s1"]);
  const mk = () => { const m = disk2({ [O]: V1, [C.LS_KEY + ".fromV1"]: "1", [C.LS_KEY + ".noMigrate"]: "1" });
    [".fromV1", ".noMigrate"].forEach((x) => { m.fail("get", C.LS_KEY + x); m.fail("set", C.LS_KEY + x); }); return m; };
  const mem = mk(); const st = open2(mem, b, sess());
  assert.equal(st.get().loadError, "LEGACY"); assert.equal(mem.muts(), 0); assert.equal(mem.raw[C.LS_KEY], undefined);
  assert.deepEqual(mem.touched.filter((k) => k.endsWith(".fromV1") || k.endsWith(".noMigrate")), [], "讀了舊標記");
  const mem2 = mk(); mem2.fail("get", A, { once: true });
  const st2 = open2(mem2, b, null);
  assert.equal(st2.get().loadError, "READ"); assert.equal(mem2.muts(), 0);
});

test("T22 自然站：家長選恢復——V 寫入失敗／V 寫後回讀失敗一次：O 原文保留；未確認時不刪 V、不宣稱完成；重試先讀現況", { skip: !SCI && NO_LEGACY }, () => {
  const b = bank(["s1"]);
  // (a) V 寫入失敗
  let mem = disk2({ [O]: V1 }); let st = open2(mem, b, null); mem.fail("set", C.LS_KEY, { once: true });
  let r = st.restoreLegacy("restore");
  assert.equal(r.ok, false); assert.equal(r.error, "SAVE_FAILED"); assert.equal(mem.raw[C.LS_KEY], undefined); assert.equal(mem.raw[O], V1); assert.equal(mem.raw[A], undefined);
  assert.equal(st.get().loadError, "LEGACY", "沒成功不能公布");
  r = st.restoreLegacy("restore"); assert.ok(r.ok); assert.ok(restored(mem)); assert.equal(mem.raw[O], undefined); assert.equal(mem.raw[A], V1);
  // (b) V 寫後回讀失敗一次
  mem = disk2({ [O]: V1 }); st = open2(mem, b, null); mem.fail("get", C.LS_KEY, { once: true, after: "set:" + C.LS_KEY });
  r = st.restoreLegacy("restore");
  assert.equal(r.ok, false); assert.equal(r.error, "UNCONFIRMED");
  assert.ok(restored(mem), "結果未確認時刪了 V"); assert.equal(mem.raw[O], V1, "結果未確認時刪了 O"); assert.equal(st.get().loadError, "LEGACY");
  const m0 = mem.muts();
  r = st.restoreLegacy("restore");
  assert.ok(r.ok); assert.equal(r.archive, "done");
  assert.equal(mem.raw[O], undefined); assert.equal(mem.raw[A], V1); assert.ok(restored(mem));
  assert.equal(mem.muts(), m0 + 2, "重試應先讀現況、承認已寫好的 V（只補 A 寫入＋O 刪除），不重寫 V");
  assert.ok(st.dispatch(op("answer", { cardId: "s1", ok: true })).ok);
});

test("T23 自然站：A 寫入／O 刪除／刪後回讀各失敗一次：V 不回滾、尚存副本不刪、不重新搬移；顯示未完成，恢復後冪等續做", { skip: !SCI && NO_LEGACY }, () => {
  const b = bank(["s1"]);
  for (const [how, f] of [["A 寫入", ["set", A, {}]], ["O 刪除", ["rm", O, {}]], ["刪後回讀", ["get", O, { after: "rm:" + O }]]]) {
    const mem = disk2({ [O]: V1 }); const st = open2(mem, b, null); mem.fail(f[0], f[1], Object.assign({ once: true }, f[2]));
    const r = st.restoreLegacy("restore");
    assert.ok(r.ok, how + "：進度已存就要公布"); assert.equal(r.archive, "pending", how);
    assert.equal(st.get().archive, "pending"); assert.ok(restored(mem), how + "：V 被回滾");
    if (how === "A 寫入") { assert.equal(mem.raw[O], V1); assert.equal(mem.raw[A], undefined); }
    if (how === "O 刪除") { assert.equal(mem.raw[O], V1); assert.equal(mem.raw[A], V1); }
    const v = mem.raw[C.LS_KEY];
    const r2 = st.retryArchive(); assert.ok(r2.ok, how); assert.equal(r2.archive, "done", how);
    assert.equal(mem.raw[O], undefined, how); assert.equal(mem.raw[A], V1, how); assert.equal(mem.raw[C.LS_KEY], v, how + "：重做時改了 V");
    const r3 = st.retryArchive(); assert.ok(r3.ok, how + "：冪等"); assert.equal(mem.raw[A], V1);
  }
});

test("T24 自然站：A 已存在而且和 O 不同：三個 key 都不覆蓋、不刪除；不搬移；顯示封存衝突", { skip: !SCI && NO_LEGACY }, () => {
  const b = bank(["s1"]); const other = JSON.stringify({ v: 1, cards: {} });
  const mem = disk2({ [O]: V1, [A]: other }); const st = open2(mem, b, null);
  assert.equal(st.get().loadError, "LEGACY"); assert.equal(st.get().legacy.conflict, true);
  const r = st.restoreLegacy("restore");
  assert.equal(r.ok, false); assert.equal(r.error, "CONFLICT"); assert.equal(mem.muts(), 0);
  assert.equal(mem.raw[O], V1); assert.equal(mem.raw[A], other); assert.equal(mem.raw[C.LS_KEY], undefined);
  // 既有 V＋O＋不同的 A：開頁只回報衝突，不動任何 key
  const v3 = JSON.stringify(C.blankState()); const mem2 = disk2({ [C.LS_KEY]: v3, [O]: V1, [A]: other }); const st2 = open2(mem2, b, null);
  assert.equal(st2.get().archive, "conflict"); assert.equal(mem2.muts(), 0); assert.equal(mem2.raw[O], V1); assert.equal(mem2.raw[A], other);
});

test("T25 自然站：S2 每一步完成後中斷、重開：V 在就以 V 為主只補封存；V 被外部刪就不補建、回到家長選擇；沒有靜默空白成功", { skip: !SCI && NO_LEGACY }, () => {
  const b = bank(["s1"]);
  const built = (() => { const mem = disk2({ [O]: V1 }); open2(mem, b, null).restoreLegacy("restore"); return mem.raw[C.LS_KEY]; })();
  // 步驟 3 後中斷（V 寫好、A 沒寫、O 還在）／步驟 4 後中斷（V、A 都寫好、O 還在）／步驟 5 後（O 已刪）
  for (const [how, init] of [["步驟 3 後", { [C.LS_KEY]: built, [O]: V1 }], ["步驟 4 後", { [C.LS_KEY]: built, [O]: V1, [A]: V1 }], ["步驟 5 後", { [C.LS_KEY]: built, [A]: V1 }]]) {
    const mem = disk2(init); const st = open2(mem, b, null);
    assert.equal(st.get().loadError, null, how); assert.equal(mem.raw[C.LS_KEY], built, how + "：V 被改");
    assert.equal(mem.raw[O], undefined, how); assert.equal(mem.raw[A], V1, how);
    assert.deepEqual(keys(st), ["s1"], how);
  }
  // 步驟 3 後 V 被外部刪：不補建，回到家長選擇
  const mem = disk2({ [O]: V1 }); const st = open2(mem, b, null);
  const st2 = open2(mem, b, null);
  assert.equal(st2.get().loadError, "LEGACY"); assert.equal(mem.raw[C.LS_KEY], undefined); assert.equal(mem.muts(), 0);
  void st;
});

test("T26 自然站：V 缺而 O 或 A 在——單純重載零搬移；只有明確「恢復」或「從頭開始」才建立 V，成功才公布；封存原文不被暗中覆蓋", { skip: !SCI && NO_LEGACY }, () => {
  const b = bank(["s1"]);
  // 只剩 O：重載兩次零寫入；按「從頭開始」→ 空白 V、A＝O 原文、O 刪除
  let mem = disk2({ [O]: V1 });
  open2(mem, b, null); open2(mem, b, sess()); assert.equal(mem.muts(), 0);
  let st = open2(mem, b, null); let r = st.restoreLegacy("fresh");
  assert.ok(r.ok); assert.deepEqual(cards(mem), []); assert.equal(mem.raw[A], V1); assert.equal(mem.raw[O], undefined); assert.equal(st.get().migrated, false);
  // 只剩 A：重載零寫入、不擋作答；家長另有「恢復封存的舊版紀錄」入口，明確按了才建立 V；A 不變
  mem = disk2({ [A]: V1 });
  st = open2(mem, b, null); open2(mem, b, null);
  assert.equal(mem.muts(), 0); assert.equal(st.get().loadError, null); assert.equal(st.get().legacy.src, "A");
  r = st.restoreLegacy("restore"); assert.ok(r.ok); assert.ok(restored(mem)); assert.equal(mem.raw[A], V1); assert.equal(st.get().legacy, null);
  // 只剩 A、已經開始新紀錄：入口消失，恢復不得覆蓋新紀錄
  mem = disk2({ [A]: V1 }); st = open2(mem, b, null);
  assert.ok(st.dispatch(op("answer", { cardId: "s1", ok: true })).ok); assert.equal(st.get().legacy, null);
  const v = mem.raw[C.LS_KEY]; r = st.restoreLegacy("restore"); assert.equal(r.ok, false); assert.equal(mem.raw[C.LS_KEY], v);
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

test("T30【不支援，X1】封存的讀／寫／刪之間插入別的寫入者：不保證原子；但已偵測到 O 被換掉就停，不刪、不假成功", { skip: !SCI && NO_LEGACY }, () => {
  const b = bank(["s1"]); const other = JSON.stringify({ v: 1, cards: {} });
  const mem = disk2({ [O]: V1 }); const st = open2(mem, b, null);
  const set = mem.setItem; mem.setItem = (k, v) => { set(k, v); if (k === A) mem.raw[O] = other; };   // A 寫好的那一刻，別的寫入者換掉 O
  const r = st.restoreLegacy("restore");
  assert.ok(r.ok); assert.notEqual(r.archive, "done", "O 被換掉還宣稱封存完成"); assert.equal(mem.raw[O], other, "刪了別人寫的 O");
  assert.equal(mem.raw[A], V1);
});

test("T31【不支援自動完成，X2】連續讀寫刪故障加反覆重開：維持可見暫停，零自動舊版恢復（F2）", { skip: !SCI && NO_LEGACY }, () => {
  const b = bank(["s1"]); const mem = disk2({ [O]: V1 });
  for (let i = 0; i < 4; i++) {
    mem.fail("set"); mem.fail("rm");
    const st = open2(mem, b, i % 2 ? sess() : null);
    assert.equal(st.get().loadError, "LEGACY"); assert.equal(st.restoreLegacy("restore").ok, false);
    mem.heal(); mem.fail("get", undefined, { once: true });
    const st2 = open2(mem, b, null); assert.equal(st2.get().loadError, "READ");
    mem.heal();
  }
  assert.equal(mem.raw[C.LS_KEY], undefined); assert.equal(mem.raw[O], V1); assert.equal(mem.raw[A], undefined);
});

test("T32【不支援，X3／X4】封存完成後舊程式又寫回 O、全站 clear：完整持久性與 clear 後保有封存都不保證；新頁仍不自動匯入 O", { skip: !SCI && NO_LEGACY }, () => {
  const b = bank(["s1", "s2"]); const mem = disk2({ [O]: V1 }); finishS2(mem, b, null);
  const v = mem.raw[C.LS_KEY], V1b = JSON.stringify({ v: 1, cards: { s2: { seen: 3 } } }); mem.raw[O] = V1b;   // 舊程式又寫了一份 O
  const st = open2(mem, b, null);
  assert.equal(mem.raw[C.LS_KEY], v, "V 被 O 蓋掉"); assert.deepEqual(keys(st), ["s1"]); assert.equal(st.get().archive, "conflict");
  assert.equal(mem.raw[O], V1b); assert.equal(mem.raw[A], V1);
  mem.removeItem(C.LS_KEY);                                              // 再刪 V：O 又在 → 家長選擇，不自動匯入
  const st2 = open2(mem, b, null); assert.equal(st2.get().loadError, "LEGACY"); assert.equal(mem.raw[C.LS_KEY], undefined);
  mem.clear();                                                           // X4：clear 連 A 一起刪，不保證
  const st3 = open2(mem, b, null); assert.equal(st3.get().loadError, null); assert.equal(st3.get().legacy, null);
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
