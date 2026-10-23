// 錯題站讀的 weak-export.js（交辦 #4027；介面＝錯題站 g5-wrong-review docs/app-weak-entry-design-20261019.md 第 2 節）。
// 守的事：錯題站顯示的「社會 app 待加強 N 題」＝這個網站「練待加強的」實際會出的那一群，不是另一份判定。
// 載的是網站根目錄 build 出來的 weak-export.js 本身（node:vm，替身 G5WeakExportRegister 接住註冊的物件），存檔全為合成資料。
// 對照組一律走 app 出題的同一條路：各單元 unitCards（poolCards＋觀念開放＋單元）→ reviewPick(..., "weak") ／ reduce sessionStart（kind:review, pick:weak）。
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const { execFileSync } = require("child_process");
const C = require("../src/core.js");
const MB = require("../src/socbank.js");
const ROOT = path.join(__dirname, "..");
const FILE = path.join(ROOT, "weak-export.js");
const SRC = fs.readFileSync(FILE, "utf8");
const BANK = MB.bank();
const FIELDS = ["answers", "seen", "weak", "weakToday", "challenge", "challengeToday", "out"];

const D = "2026-10-24";
const NOON = (d) => Date.parse(d + "T12:00:00+08:00");

// 載入 weak-export.js：回傳 {regs: 註冊呼叫的每個參數, ctx, added: 新增的全域名, touched: 碰到的敏感 API}
function load(opt) {
  opt = opt || {};
  const regs = [], touched = [];
  const g = {};
  const reg = function (o) { regs.push(o); };
  if (!opt.noRegister) g.G5WeakExportRegister = reg;
  // 讀寫 storage、連網：一碰就記下來（I1 唯讀、不連網）
  for (const k of ["localStorage", "sessionStorage", "fetch", "XMLHttpRequest", "navigator", "document", "indexedDB"]) {
    Object.defineProperty(g, k, { configurable: true, enumerable: true, get() { touched.push(k); return undefined; } });
  }
  g.window = g;
  const ctx = vm.createContext(g);
  const before = new Set(Object.getOwnPropertyNames(ctx));
  vm.runInContext(SRC, ctx, { filename: "weak-export.js" });
  const added = Object.getOwnPropertyNames(ctx).filter((k) => !before.has(k));
  return { regs, ctx, added, touched, reg };
}
// vm 另一個 realm 的物件原型不同，deepStrictEqual 會說不等：回傳值一律淺拷貝成本 realm 的物件再比（欄位與值不變）
const plain = (x) => (x && typeof x === "object" ? Object.assign({}, x) : x);
const LOADED = load().regs[0];
const EXP = { summarize: (r, n) => plain(LOADED.summarize(r, n)) };

// 合成存檔：卡片狀態直接寫（checkState 合法），今天練過＝days[D].touched
function cs(seen, goodDays, extra) { return Object.assign({ seen, goodDays, blockedDay: null, due: goodDays.length ? "2026-10-27" : "2026-10-25" }, extra || {}); }
function logOf(ids) { return ids.map((id, i) => ({ op: "o" + i, d: "2026-10-20", card: id, c: (C.cardById(C.blankState(), BANK, id) || { concept: "1a" }).concept, ok: false, hint: false, unsure: false, variation: false, first: true })); }
function day(touched) { return { planIds: [], doneIds: [], touched, extraDone: false, labRuns: 0, teach: 0, mood: null }; }
const X1 = { id: "x1", concept: "2a", type: "choice", q: "家長匯入的合成題", opts: ["甲", "乙"], a: 0 };   // 匯入題（state.extra）

// 固定案例（每一格的期待值手算）：
//   範圍內待加強：a04 a12 a13（a13 今天練過）、b01（學會過但 needsRecheck）、a06（合併表裁掉、做過照常）、x1（匯入題）
//   學會的：b02（不算）；沒做過：b03（不算）
//   考不到（out）：a01 待加強、a02 學會 ⇒ out＝1，不進 weak
//   挑戰（challenge）：a05 待加強、f02 待加強但今天練過、f06 學會 ⇒ challenge＝2、challengeToday＝1
function fixed() {
  const s = C.blankState();
  s.cards = {
    a04: cs(1, []), a12: cs(2, []), a13: cs(1, []), b01: cs(3, ["2026-10-20"], { needsRecheck: true }),
    a06: cs(1, []), x1: cs(1, []), b02: cs(2, ["2026-10-20"]),
    a01: cs(1, []), a02: cs(2, ["2026-10-20"]),
    a05: cs(1, []), f02: cs(1, []), f06: cs(1, ["2026-10-21"])
  };
  s.extra = [X1];
  s.days[D] = day(["a13", "f02"]);
  s.log = logOf(["a04", "a12", "a12", "a13", "b01", "a01", "a05"]);
  return s;
}
const raw = (s) => JSON.stringify(s);
const sumOf = (s, now) => EXP.summarize(raw(s), now === undefined ? NOON(D) : now);

// app 出題的同一條路（src/app.html unitCards／startReview）：各單元的題、按「練待加強的」會出的題
function unitIds(s, u, d) { return C.poolCards(s, BANK, d).filter((c) => BANK.concepts[c.concept].unit === u && C.conceptOn(s, BANK, c.concept)).map((c) => c.id); }
function servedWeak(s, d, anyDay) {   // anyDay＝不管今天練過沒（touched 換成空：day 帶 null）
  const out = new Set();
  for (const u of Object.keys(MB.UNITS)) for (const id of C.reviewPick(s, BANK, unitIds(s, u, d), "weak", anyDay ? null : d)) out.add(id);
  return out;
}
function oracle(s, d) {
  const all = servedWeak(s, d, true), today = servedWeak(s, d, false), ch = (id) => !!BANK.challenge[id];
  const pool = C.poolCards(s, BANK, d).map((c) => c.id);
  return {
    weakSet: [...all].filter((id) => !ch(id)).sort(), weakTodaySet: [...today].filter((id) => !ch(id)).sort(),
    chSet: [...all].filter(ch).sort(), chTodaySet: [...today].filter(ch).sort(),
    outN: pool.filter((id) => BANK.out[id] && C.weakCard(C.cardState(s, id))).length
  };
}

test("介面：classic script 執行期間同步註冊一次，物件合乎錯題站 okExport（api 1、key g5soc.v1、summarize 函式、links 本站或 null）", () => {
  const r = load();
  assert.equal(r.regs.length, 1);
  const e = r.regs[0];
  assert.equal(e.api, 1);
  assert.equal(e.key, "g5soc.v1");
  assert.equal(e.key, C.LS_KEY);
  assert.equal(typeof e.summarize, "function");
  assert.deepEqual(plain(e.links), { weak: null, challenge: null });
  assert.doesNotMatch(SRC, /\btype\s*=\s*["']?module|^\s*(import|export)\s/m, "必須是 classic script");
});

test("⑥ 不新增任何全域、不碰 localStorage／sessionStorage／fetch／XHR／navigator／document（含 summarize 執行時）", () => {
  const r = load();
  assert.deepEqual(r.added, []);
  assert.deepEqual(r.touched, []);
  const e = r.regs[0];
  const before = Object.getOwnPropertyNames(r.ctx).sort();
  e.summarize(raw(fixed()), NOON(D)); e.summarize("壞掉", NOON(D)); e.summarize(raw(C.blankState()), NOON(D));
  assert.deepEqual(Object.getOwnPropertyNames(r.ctx).sort(), before);
  assert.deepEqual(r.touched, []);
  assert.equal(r.ctx.G5WeakExportRegister, r.reg, "註冊函式沒有被換掉");
});

test("沒有註冊函式（直接開這個檔）＝什麼都不做、不丟錯、不留全域", () => {
  const r = load({ noRegister: true });
  assert.deepEqual(r.regs, []);
  assert.deepEqual(r.added, []);
  assert.deepEqual(r.touched, []);
});

test("weak-export.js 就是 build.py 從目前 src 產生的那一份（改了 core／題庫沒重 build 就紅）", () => {
  const built = execFileSync("python3", ["-c", "import sys, build; sys.stdout.write(build.weak_export())"], { cwd: ROOT, encoding: "utf8" });
  assert.equal(SRC, built);
  for (const f of ["src/socbank.js", "src/core.js"]) assert.ok(SRC.includes(fs.readFileSync(path.join(ROOT, f), "utf8")), f + " 原文整份內嵌");
});

test("① 固定案例：weak／weakToday 集合與 app「練待加強的」逐題相同，數字照手算", () => {
  const s = fixed(), o = oracle(s, D);
  assert.deepEqual(o.weakSet, ["a04", "a06", "a12", "a13", "b01", "x1"]);
  assert.deepEqual(o.weakTodaySet, ["a04", "a06", "a12", "b01", "x1"]);
  assert.deepEqual(o.chSet, ["a05", "f02"]);
  assert.deepEqual(o.chTodaySet, ["a05"]);
  assert.equal(o.outN, 1);
  assert.deepEqual(sumOf(s), { ok: true, answers: 7, seen: 17, weak: 6, weakToday: 5, challenge: 2, challengeToday: 1, out: 1 });
});

test("① 真的按下去：每個單元 reduce sessionStart（kind:review, pick:weak）開出的題＝export 今天可練的那一群", () => {
  const s = fixed(), served = new Set();
  for (const u of Object.keys(MB.UNITS)) {
    const ids = unitIds(s, u, D);
    const r = C.reduce(s, { type: "sessionStart", id: "op-" + u, kind: "review", pick: "weak", ids }, { bank: BANK, now: NOON(D) });
    if (r.error === "REVIEW_EMPTY") continue;
    assert.ok(!r.error, u + " " + r.error);
    r.state.session.queue.forEach((id) => served.add(id));
  }
  const e = sumOf(s), ch = [...served].filter((id) => BANK.challenge[id]);
  assert.equal(served.size - ch.length, e.weakToday);
  assert.equal(ch.length, e.challengeToday);
  assert.deepEqual([...served].sort(), ["a04", "a05", "a06", "a12", "b01", "x1"]);
});

test("② out 不進 weak、challenge 不進 weak；把它們從停出表拿掉才會算進 weak（對照組）", () => {
  const s = fixed(), e = sumOf(s);
  assert.equal(e.out, 1);
  assert.equal(e.challenge, 2);
  // 只留 out／challenge 的待加強題：weak 一定是 0
  const s2 = C.blankState();
  s2.cards = { a01: cs(1, []), a03: cs(2, []), a05: cs(1, []), f02: cs(1, []) };
  assert.deepEqual(sumOf(s2), { ok: true, answers: 0, seen: 5, weak: 0, weakToday: 0, challenge: 2, challengeToday: 2, out: 2 });
  // 對照：同樣的卡換成範圍內的題，就算進 weak（證明上面的 0 是排除造成的，不是什麼都算 0）
  const s3 = C.blankState();
  s3.cards = { a04: cs(1, []), a12: cs(2, []), a13: cs(1, []), a14: cs(1, []) };
  assert.equal(sumOf(s3).weak, 4);
});

test("③ 今天練過的不算 weakToday（仍算 weak）；隔天就算回來", () => {
  const s = fixed();
  assert.equal(sumOf(s).weakToday, sumOf(s).weak - 1);
  s.days[D].touched = ["a04", "a12", "a13", "b01", "a06", "x1", "a05", "f02"];
  const e = sumOf(s);
  assert.equal(e.weak, 6); assert.equal(e.weakToday, 0); assert.equal(e.challenge, 2); assert.equal(e.challengeToday, 0);
  const next = sumOf(s, NOON("2026-10-25"));
  assert.equal(next.weakToday, 6); assert.equal(next.challengeToday, 2);
  // 時區：台北 10/25 00:30（UTC 還是 10/24）已是隔天
  assert.equal(sumOf(s, Date.parse("2026-10-25T00:30:00+08:00")).weakToday, 6);
  assert.equal(sumOf(s, Date.parse("2026-10-24T23:59:00+08:00")).weakToday, 0);
});

test("④ 讀不懂的一律回 {ok:false}，不丟例外", () => {
  const badState = fixed(); badState.cards.a04.seen = -1;
  const v2 = fixed(); v2.v = 2;
  const noLog = fixed(); delete noLog.log;
  const cases = ["", "壞掉", "{", "null", "[]", "0", "\"g5\"", "{}", raw(v2), raw(badState), raw(noLog), "{\"v\":4}"];
  for (const c of cases) assert.deepEqual(EXP.summarize(c, NOON(D)), { ok: false }, JSON.stringify(c).slice(0, 40));
  for (const c of [null, undefined, 3, {}, []]) assert.deepEqual(EXP.summarize(c, NOON(D)), { ok: false });
  for (const n of [NaN, Infinity, undefined, "1"]) assert.deepEqual(EXP.summarize(raw(fixed()), n), { ok: false });
});

test("讀法與 app 開頁相同：舊版 v3 存檔照樣讀得懂（decode 升 v4）", () => {
  const s = fixed(); s.v = 3;
  assert.equal(sumOf(s).weak, 6);
});

// 亂數產生合成存檔（固定種子）：每一份都要 ⑤ 欄位是非負整數、不等式成立，且 ① 數字＝oracle 集合大小
function rng(seed) { let x = seed >>> 0; return () => { x ^= x << 13; x >>>= 0; x ^= x >>> 17; x ^= x << 5; x >>>= 0; return x / 4294967296; }; }
const DAYS = ["2026-10-20", "2026-10-21", "2026-10-22", "2026-10-23", "2026-10-24"];
function randomState(r) {
  const s = C.blankState(), ids = MB.ALL_CARDS.map((c) => c.id), touched = [];
  for (const id of ids) {
    const p = r();
    if (p < 0.35) continue;
    const g = p < 0.6 ? [] : p < 0.8 ? [DAYS[Math.floor(r() * 3)]] : [DAYS[0], DAYS[2]];
    s.cards[id] = cs(1 + Math.floor(r() * 4), g, r() < 0.15 && g.length ? { needsRecheck: true } : undefined);
    if (g.length >= 2) s.cards[id].due = null;
    if (r() < 0.3) touched.push(id);
  }
  if (r() < 0.8) s.days[D] = day(touched);
  if (r() < 0.5) s.days["2026-10-23"] = day(touched.slice(0, 3));
  s.log = logOf(Object.keys(s.cards).filter(() => r() < 0.5));
  return s;
}
test("⑤＋① 300 份亂數合成存檔：七欄非負整數、weakToday≤weak、challengeToday≤challenge，四個數字＝app 出題集合大小", () => {
  const r = rng(4027);
  let nonzero = 0;
  for (let i = 0; i < 300; i++) {
    const s = randomState(r);
    assert.deepEqual(C.checkState(s, BANK), [], "合成存檔本身要合法 #" + i);
    const e = sumOf(s), o = oracle(s, D);
    assert.equal(e.ok, true);
    for (const f of FIELDS) assert.ok(Number.isInteger(e[f]) && e[f] >= 0, f + "=" + e[f]);
    assert.ok(e.weakToday <= e.weak && e.challengeToday <= e.challenge);
    assert.deepEqual([e.weak, e.weakToday, e.challenge, e.challengeToday, e.out],
      [o.weakSet.length, o.weakTodaySet.length, o.chSet.length, o.chTodaySet.length, o.outN], "#" + i);
    assert.equal(e.answers, s.log.length);
    assert.equal(e.seen, Object.values(s.cards).reduce((a, c) => a + c.seen, 0));
    if (e.weak && e.weakToday < e.weak && e.out && e.challenge) nonzero++;
  }
  assert.ok(nonzero > 30, "亂數案例要真的走到各分支：" + nonzero);
});

test("題庫物件只有一份：app.html 用 MB.bank()，不再自己組 out／active", () => {
  const app = fs.readFileSync(path.join(ROOT, "src/app.html"), "utf8");
  assert.match(app, /var BANK = MB\.bank\(\);/);
  assert.doesNotMatch(app, /kind==="out"/);
  const tpl = fs.readFileSync(path.join(ROOT, "src/weakexport.js"), "utf8");
  assert.match(tpl, /R\.G5SocBank\.bank\(\)/);
  assert.match(tpl, /C\.weakTally\(/);
});
