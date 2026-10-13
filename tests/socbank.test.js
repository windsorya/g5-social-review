// 社會題庫檢查（src/socbank.js）。執行：node --test tests/socbank.test.js
// 題庫是手寫的事實題（不像數學站能由程式算答案），所以這支守的是「格式與可查證性」：
// 答案在選項內且唯一、每個錯誤選項都有錯在哪的白話解說、每題都有政府或教育機構的查證出處、句長、每個觀念題數。
// 事實本身的正確性另見 tests/FACTCHECK.md（出處網址＋原文摘錄，送 Codex 審）。
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const B = require("../src/socbank.js");
const X = require("../src/socexplain.js");
const C = require("../src/core.js");

const MAX_SENTENCE = 40;   // 小五每句上限（與 tests/standard.test.js 相同）
const sentences = (t) => String(t).split(/[。！？；]/).map((s) => s.trim()).filter(Boolean);
const OFFICIAL = /^https:\/\/([a-z0-9-]+\.)*(gov\.tw|edu\.tw)\//;   // 政府（gov.tw）或教育機構（edu.tw）網站
const CIDS = Object.keys(B.CONCEPTS);

test("①每題答案在選項內且唯一（ans 對到 a、選項不重複）", () => {
  const bad = [];
  B.CARDS.forEach((c) => {
    const norm = c.opts.map((o) => o.replace(/\s/g, ""));
    if (new Set(norm).size !== norm.length) bad.push(c.id + " 選項重複");
    if (!(Number.isInteger(c.a) && c.a >= 0 && c.a < c.opts.length)) bad.push(c.id + " a 超出範圍");
    if (norm.filter((o) => o === String(c.ans).replace(/\s/g, "")).length !== 1 || c.opts[c.a] !== c.ans) bad.push(c.id + " 正解不在選項內或不唯一");
    if (c.opts.length < 3) bad.push(c.id + " 選項少於 3 個");
  });
  assert.deepEqual(bad, []);
});

test("②每個錯誤選項都有 wrongWhy（非空），正解那格是空字串", () => {
  const bad = [];
  B.CARDS.forEach((c) => {
    if (!Array.isArray(c.wrongWhy) || c.wrongWhy.length !== c.opts.length) { bad.push(c.id + " wrongWhy 長度不對"); return; }
    c.wrongWhy.forEach((w, i) => {
      if (i === c.a && w !== "") bad.push(c.id + " 正解不該有 wrongWhy");
      if (i !== c.a && !(typeof w === "string" && w.trim().length >= 6)) bad.push(c.id + "「" + c.opts[i] + "」沒有錯在哪的解說");
    });
  });
  assert.deepEqual(bad, []);
});

test("③每題都有查證出處（src 對到 SOURCES，網址是 gov.tw／edu.tw），並標「自編題（未對課本）」", () => {
  const bad = [];
  Object.keys(B.SOURCES).forEach((k) => { const s = B.SOURCES[k]; if (!s.name || !OFFICIAL.test(s.url)) bad.push("SOURCES." + k + " 不是政府或教育機構網址：" + s.url); });
  B.CARDS.forEach((c) => {
    if (!c.src || !B.SOURCES[c.src]) bad.push(c.id + " 沒有 src 或對不到 SOURCES");
    if (c.page !== "自編題（未對課本）") bad.push(c.id + " page 不是「自編題（未對課本）」");
  });
  assert.deepEqual(bad, []);
});

test("④題目、解說、錯誤選項解說、提示：每句 ≤40 字", () => {
  const long = [];
  B.CARDS.forEach((c) => [c.q, c.why, c.hint].concat(c.wrongWhy).forEach((t) => sentences(t || "").forEach((s) => { if (s.length > MAX_SENTENCE) long.push(c.id + "：" + s); })));
  CIDS.forEach((k) => [B.CONCEPTS[k].exit, B.CONCEPTS[k].exitAns].forEach((t) => sentences(t).forEach((s) => { if (s.length > MAX_SENTENCE) long.push(k + " 出口題：" + s); })));
  Object.keys(X.PREDICT).forEach((k) => [X.PREDICT[k].q, X.PREDICT[k].why].forEach((t) => sentences(t).forEach((s) => { if (s.length > MAX_SENTENCE) long.push(k + " 先想想看：" + s); })));
  assert.deepEqual(long, []);
});

test("⑤每個觀念都有題（8～15 題），總數約 100 題；每個觀念都有解說與先想想看", () => {
  const n = {}; CIDS.forEach((k) => { n[k] = 0; });
  B.CARDS.forEach((c) => { assert.ok(c.concept in n, c.id + " 的觀念不存在"); n[c.concept]++; });
  const off = CIDS.filter((k) => n[k] < 8 || n[k] > 15).map((k) => k + "=" + n[k]);
  assert.deepEqual(off, [], "題數不在 8～15：" + off.join("、"));
  assert.ok(B.CARDS.length >= 90 && B.CARDS.length <= 110, "總題數 " + B.CARDS.length);
  CIDS.forEach((k) => { assert.ok(X.EXPLAIN[k] && X.EXPLAIN[k].length >= 2, k + " 缺解說"); const p = X.PREDICT[k]; assert.ok(p && p.a >= 0 && p.a < p.opts.length, k + " 缺先想想看"); });
});

test("⑥題卡 id 唯一、都通過 core.js 的題卡檢查", () => {
  const ids = B.CARDS.map((c) => c.id);
  assert.equal(new Set(ids).size, ids.length, "id 重複");
  const bank = { cards: B.CARDS, concepts: {}, figs: {} };
  CIDS.forEach((k) => { bank.concepts[k] = { unit: B.CONCEPTS[k].unit }; });
  assert.deepEqual(B.CARDS.filter((c) => !C.validCard(c, bank)).map((c) => c.id), []);
  CIDS.forEach((k) => assert.ok(B.UNITS[B.CONCEPTS[k].unit], k + " 的單元不存在"));
});

test("⑦正解位置不固定（每個位置都有正解，沒有一個位置超過一半）", () => {
  const pos = [0, 0, 0, 0]; B.CARDS.forEach((c) => { pos[c.a]++; });
  assert.ok(pos.slice(0, 3).every((n) => n > 0), JSON.stringify(pos));
  assert.ok(Math.max.apply(null, pos) <= B.CARDS.length / 2, JSON.stringify(pos));
});

test("⑧ FACTCHECK.md 列出每一個出處（網址與原文摘錄），每題的 src 都查得到", () => {
  const md = fs.readFileSync(path.join(__dirname, "FACTCHECK.md"), "utf8");
  const miss = Object.keys(B.SOURCES).filter((k) => md.indexOf("`" + k + "`") < 0 || md.indexOf(B.SOURCES[k].url) < 0);
  assert.deepEqual(miss, [], "FACTCHECK.md 沒寫到：" + miss.join("、"));
  const used = new Set(B.CARDS.map((c) => c.src));
  const unused = Object.keys(B.SOURCES).filter((k) => !used.has(k));
  assert.deepEqual(unused, [], "SOURCES 有沒用到的出處：" + unused.join("、"));
  const noIds = B.CARDS.filter((c) => md.indexOf(c.id) < 0).map((c) => c.id);
  assert.deepEqual(noIds, [], "FACTCHECK.md 沒列到這些題：" + noIds.join("、"));
});

test("⑨出口題不和練習題重複（家長畫面說「這些題目在練習裡沒出現過」）", () => {
  const qs = new Set(B.CARDS.map((c) => c.q.replace(/\s/g, "")));
  assert.deepEqual(CIDS.filter((k) => qs.has(B.CONCEPTS[k].exit.replace(/\s/g, ""))), []);
});

test("⑩不寫具體條號（題目、選項、解說都不出現「第 N 條」）", () => {
  const bad = B.CARDS.filter((c) => /第\s*[0-9０-９一二三四五六七八九十百]+\s*條/.test([c.q, c.why, c.hint].concat(c.opts, c.wrongWhy).join(" "))).map((c) => c.id);
  assert.deepEqual(bad, []);
});
