// ⛔ 律師對「孩子用的教學網站」的固定標準——不屬於任何科目，複製這個網站去做新站時這支要一起帶走、不可刪除、不可改成跳過。
// 由來（#1339）：2026-10-13 數學站複製自然站時，影片的強制檢查寫在自然科專用的 steps.test.js 裡，被當成「自然專用」整支刪掉，
// 數學站就在沒有影片的狀態宣稱上線（律師：「數學複習似乎都沒有加上影片」「為何會漏做」）。
// 標準來源：律師 2026-10-11（自然站）「白話易懂、圖多一些、有影片就附上」；2026-10-13（難題站）每步一圖、每篇有影片；
//           2026-10-13 白話用詞要附解釋（#1319）；2026-10-13 三站要能互相切換（#1333）；網站不放孩子個資、不被搜尋引擎收錄。
// 三站各有一支同名檔（g5-sci-review、g5-help、g5-math-review），清單相同、取資料的方式各自不同。
// 社會站 g5-social-review（2026-10-13 由數學站 fd585e3 複製）：①允許「查不到合格影片」時寫 noVideoReason（去空白 ≥20 字，說明查了什麼、為何不合格），
// 不是跳過——空白或太短的理由一樣紅；④改成五站（加國語、社會）。
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const B = require("../src/socbank.js");
const X = require("../src/socexplain.js");
const V = require("../src/socvideos.js");
const ROOT = path.join(__dirname, "..");
const MAX_SENTENCE = 40;   // 小五每句上限，與難題站 src/hard.js READING[5] 相同

const units = [...new Set(B.CARDS.map((c) => c.concept))];   // 會出題的每個觀念

// 2026-10-14 律師：「為何漏附影片……請日後避免再犯」⇒ 沒有影片只認律師核可（四站同一條）：
//   { noVideoReason: 理由（去空白 ≥20 字）, ownerApproved: "YYYY-MM-DD 律師原話：「…」" }；只寫理由一律不過
const videoOk = (v) => (Array.isArray(v) && v.length > 0 && v.every((x) => /^[A-Za-z0-9_-]{11}$/.test(x.id) && x.title && x.channel)) ||
    (!!v && !Array.isArray(v) && typeof v.noVideoReason === "string" && v.noVideoReason.replace(/\s/g, "").length >= 20 &&
     typeof v.ownerApproved === "string" && /^\d{4}-\d{2}-\d{2} 律師原話：「[^」]+」/.test(v.ownerApproved));
test("標準①影片：每個會出題的觀念至少一段驗證過的影片；沒有影片只認律師核可（理由＋ownerApproved 原話）", () => {
  const missing = units.filter((k) => !videoOk(V[k]));
  assert.deepEqual(missing, [], "沒有影片，也沒有律師核可：" + missing.join("、"));
});
// 2026-10-14 律師「請日後避免再犯」：例外口必須真的關住——突變自檢
test("標準①-自檢：沒有影片時，只寫理由不過、缺律師原話不過、理由＋律師原話才過", () => {
  const why = "這個觀念找不到合適的影片，先看圖解和例句練習就好。";
  assert.equal(videoOk({ noVideoReason: why }), false, "只寫理由卻放行");
  assert.equal(videoOk({ noVideoReason: why, ownerApproved: "律師說可以" }), false, "核可沒有日期與原話卻放行");
  assert.equal(videoOk({ noVideoReason: why, ownerApproved: "2026-10-14 律師原話：「這個觀念不用放影片」" }), true);
});

test("標準②圖：每個觀念的每一種說法都有圖", () => {
  units.forEach((k) => {
    assert.ok(Array.isArray(X.EXPLAIN[k]) && X.EXPLAIN[k].length >= 2, k + " 要有兩種說法");
    X.EXPLAIN[k].forEach((ex, i) => assert.ok(/^<svg[^>]*role="img"[^>]*aria-label="[^"]{4,}"/.test(ex.svg()), k + " 第 " + (i + 1) + " 種說法沒有圖或缺 aria-label"));
  });
});

test("標準③白話：解說每一句不超過小五句長上限", () => {
  const long = [];
  units.forEach((k) => X.EXPLAIN[k].forEach((ex) => ex.lines.concat([ex.task, ex.ask]).forEach((t) =>
    String(t).split(/[。！？]/).forEach((s) => { if (s.trim().length > MAX_SENTENCE) long.push(k + "：" + s.trim()); }))));
  assert.deepEqual(long, []);
});

const SITES = ["g5-sci-review", "g5-math-review", "g5-help", "g5-chinese-review", "g5-wrong-review"];   // 本站以外的五站；本站是 aria-current 的那一格
test("標準④五站切換列、⑤不被搜尋引擎收錄", () => {
  const html = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");
  const nav = (/<nav id="siteNav"[\s\S]*?<\/nav>/.exec(html) || [""])[0];
  const miss = SITES.filter((k) => nav.indexOf('href="https://windsorya.github.io/' + k + '/"') < 0);
  assert.deepEqual(miss, [], "切換列少了：" + miss.join("、"));
  assert.ok(/aria-current="page"[^>]*>五上社會複習</.test(nav), "切換列沒有標出本站");
  assert.ok(/<meta name="robots" content="noindex/.test(html), "缺 noindex");
  assert.ok(/Disallow: \//.test(fs.readFileSync(path.join(ROOT, "robots.txt"), "utf8")), "robots.txt 沒有 Disallow");
});
