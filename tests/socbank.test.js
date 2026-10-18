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
  B.ALL_CARDS.forEach((c) => {
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
  B.ALL_CARDS.forEach((c) => {
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
  B.ALL_CARDS.forEach((c) => {
    if (!c.src || !B.SOURCES[c.src]) bad.push(c.id + " 沒有 src 或對不到 SOURCES");
    if (c.page !== "自編題（未對課本）") bad.push(c.id + " page 不是「自編題（未對課本）」");
  });
  assert.deepEqual(bad, []);
});

test("④題目、解說、錯誤選項解說、提示：每句 ≤40 字", () => {
  const long = [];
  B.ALL_CARDS.forEach((c) => [c.q, c.why, c.hint].concat(c.wrongWhy).forEach((t) => sentences(t || "").forEach((s) => { if (s.length > MAX_SENTENCE) long.push(c.id + "：" + s); })));
  CIDS.forEach((k) => [B.CONCEPTS[k].exit, B.CONCEPTS[k].exitAns].forEach((t) => sentences(t).forEach((s) => { if (s.length > MAX_SENTENCE) long.push(k + " 出口題：" + s); })));
  Object.keys(X.PREDICT).forEach((k) => [X.PREDICT[k].q, X.PREDICT[k].why].forEach((t) => sentences(t).forEach((s) => { if (s.length > MAX_SENTENCE) long.push(k + " 先想想看：" + s); })));
  assert.deepEqual(long, []);
});

test("⑤每個觀念都有題（8～15 題），總數約 100 題；每個觀念都有解說與先想想看", () => {
  const n = {}; CIDS.forEach((k) => { n[k] = 0; });
  B.ALL_CARDS.forEach((c) => { assert.ok(c.concept in n, c.id + " 的觀念不存在"); n[c.concept]++; });
  const off = CIDS.filter((k) => n[k] < 8 || n[k] > 15).map((k) => k + "=" + n[k]);
  assert.deepEqual(off, [], "題數不在 8～15：" + off.join("、"));
  assert.ok(B.ALL_CARDS.length >= 90 && B.ALL_CARDS.length <= 110, "總題數 " + B.ALL_CARDS.length);
  CIDS.forEach((k) => { assert.ok(X.EXPLAIN[k] && X.EXPLAIN[k].length >= 2, k + " 缺解說"); const p = X.PREDICT[k]; assert.ok(p && p.a >= 0 && p.a < p.opts.length, k + " 缺先想想看"); });
});

test("⑥題卡 id 唯一、都通過 core.js 的題卡檢查", () => {
  const ids = B.ALL_CARDS.map((c) => c.id);
  assert.equal(new Set(ids).size, ids.length, "id 重複");
  const bank = { cards: B.ALL_CARDS, concepts: {}, figs: {} };
  CIDS.forEach((k) => { bank.concepts[k] = { unit: B.CONCEPTS[k].unit }; });
  assert.deepEqual(B.ALL_CARDS.filter((c) => !C.validCard(c, bank)).map((c) => c.id), []);
  CIDS.forEach((k) => assert.ok(B.UNITS[B.CONCEPTS[k].unit], k + " 的單元不存在"));
});

test("⑦正解位置不固定（每個位置都有正解，沒有一個位置超過一半）", () => {
  const pos = [0, 0, 0, 0]; B.ALL_CARDS.forEach((c) => { pos[c.a]++; });
  assert.ok(pos.slice(0, 3).every((n) => n > 0), JSON.stringify(pos));
  assert.ok(Math.max.apply(null, pos) <= B.ALL_CARDS.length / 2, JSON.stringify(pos));
});

test("⑧ FACTCHECK.md 列出每一個出處（網址與原文摘錄），每題的 src 都查得到", () => {
  const md = fs.readFileSync(path.join(__dirname, "FACTCHECK.md"), "utf8");
  const miss = Object.keys(B.SOURCES).filter((k) => md.indexOf("`" + k + "`") < 0 || md.indexOf(B.SOURCES[k].url) < 0);
  assert.deepEqual(miss, [], "FACTCHECK.md 沒寫到：" + miss.join("、"));
  const used = new Set(B.ALL_CARDS.map((c) => c.src));
  const unused = Object.keys(B.SOURCES).filter((k) => !used.has(k));
  assert.deepEqual(unused, [], "SOURCES 有沒用到的出處：" + unused.join("、"));
  const noIds = B.ALL_CARDS.filter((c) => md.indexOf(c.id) < 0).map((c) => c.id);
  assert.deepEqual(noIds, [], "FACTCHECK.md 沒列到這些題：" + noIds.join("、"));
});

test("⑨出口題不和練習題重複（家長畫面說「這些題目在練習裡沒出現過」）", () => {
  const qs = new Set(B.ALL_CARDS.map((c) => c.q.replace(/\s/g, "")));
  assert.deepEqual(CIDS.filter((k) => qs.has(B.CONCEPTS[k].exit.replace(/\s/g, ""))), []);
});

test("⑩不寫具體條號（題目、選項、解說都不出現「第 N 條」）", () => {
  const bad = B.ALL_CARDS.filter((c) => /第\s*[0-9０-９一二三四五六七八九十百]+\s*條/.test([c.q, c.why, c.hint].concat(c.opts, c.wrongWhy).join(" "))).map((c) => c.id);
  assert.deepEqual(bad, []);
});

// ---------- 2026-10-13 Codex 審 ddd5a2e7 三項內容 FAIL（a06 經緯度、c04 法律與道德、g05 月均溫推極端）的守門 ----------
// 「說成真的」的文字：題目、正解、解說、提示、錯誤選項的解說、出口題與參考答案、觀念解說（含圖上文字）、先想想看的題目／正解／解說。
// 錯誤選項本身與先想想看的錯誤選項故意是錯的，不掃。
function claimTexts() {
  const out = [];
  const strip = (s) => String(s || "").replace(/<[^>]*>/g, " ").replace(/&[a-z#0-9]+;/g, " ");
  B.ALL_CARDS.forEach((c) => {
    [c.q, c.ans, c.why, c.hint].forEach((t) => out.push([c.id, t]));
    c.wrongWhy.forEach((w, i) => { if (i !== c.a) out.push([c.id + "「" + c.opts[i] + "」的解說", w]); });
  });
  CIDS.forEach((k) => {
    out.push([k + " 出口題", B.CONCEPTS[k].exit]); out.push([k + " 參考答案", B.CONCEPTS[k].exitAns]);
    X.EXPLAIN[k].forEach((ex, j) => {
      [ex.name, ex.task, ex.ask].concat(ex.lines).forEach((t) => out.push([k + " 說法" + (j + 1), t]));
      out.push([k + " 說法" + (j + 1) + " 圖", strip(ex.svg())]);
    });
    const p = X.PREDICT[k]; [p.q, p.opts[p.a], p.why].forEach((t) => out.push([k + " 先想想看", t]));
  });
  return out.filter((x) => typeof x[1] === "string" && x[1]);
}

// FACTCHECK.md 的 ey_extreme（內政部臺灣本島極點）＝經緯度數字的唯一依據
function extremes() {
  const md = fs.readFileSync(path.join(__dirname, "FACTCHECK.md"), "utf8");
  const g = (name) => {
    const m = new RegExp(name + "\\s*(\\d+)度(\\d+)分(\\d+)秒").exec(md);
    assert.ok(m, "FACTCHECK.md 找不到「" + name + "」");
    return +m[1] + +m[2] / 60 + +m[3] / 3600;
  };
  return { E: g("極東"), W: g("極西"), S: g("極南"), N: g("極北") };
}
// 不是在講臺灣本島範圍的固定緯度（出處：教育部辭典赤道 0 度、行政院北回歸線 23.5 度）
const REF_LAT = [0, 23.5];
const GEO = /(北緯|南緯|東經|西經)\s*(\d+(?:\.\d+)?)(?:\s*(?:～|~|到|至)\s*(\d+(?:\.\d+)?))?\s*度(以上|以下|以北|以南|以東|以西|多)?/g;

function geoProblems(text, X0) {
  const bad = [];
  let m; GEO.lastIndex = 0;
  while ((m = GEO.exec(text))) {
    const [all, kind, a0, b0, suf] = m, a = +a0, b = b0 === undefined ? null : +b0;
    const lat = kind === "北緯" || kind === "南緯";
    if (kind === "南緯" || kind === "西經") { bad.push(all + "（臺灣是北緯、東經）"); continue; }
    const lo = lat ? X0.S : X0.W, hi = lat ? X0.N : X0.E;
    if (b !== null) {   // 範圍：兩端要等於極點四捨五入後的整數
      if (a !== Math.round(lo) || b !== Math.round(hi)) bad.push(all + "（極點 " + lo.toFixed(3) + "～" + hi.toFixed(3) + "）");
    } else if (suf === "以上" || suf === "以北" || suf === "以東") {
      if (!(a <= lo)) bad.push(all + "（本島最" + (lat ? "南" : "西") + "只到 " + lo.toFixed(3) + " 度）");
    } else if (suf === "以下" || suf === "以南" || suf === "以西") {
      if (!(a >= hi)) bad.push(all + "（本島最" + (lat ? "北" : "東") + "到 " + hi.toFixed(3) + " 度）");
    } else if (suf === "多") {
      if (!(Math.floor(lo) >= a && hi < a + 10)) bad.push(all + "（極點 " + lo.toFixed(3) + "～" + hi.toFixed(3) + "）");
    } else if (!(lat && REF_LAT.indexOf(a) >= 0)) {   // 單一數字（如「最南約北緯 22 度」、圖上的格線「北緯 24 度」）：要落在本島範圍內（容許四捨五入 0.5 度）
      if (!(a >= lo - 0.5 && a <= hi + 0.5)) bad.push(all + "（本島範圍 " + lo.toFixed(3) + "～" + hi.toFixed(3) + "）");
    }
  }
  return bad;
}

test("⑪經緯度數字說法都和 FACTCHECK 內政部極點一致（a06「北緯 22 度以上」錯：極南 21°53′50″）", () => {
  const X0 = extremes();
  assert.ok(X0.S < 22 && X0.S > 21.8, "極南應約 21.897 度：" + X0.S);
  // 判準自檢：抓得到 Codex 的反例，合法說法不誤判
  assert.deepEqual(geoProblems("臺灣在北緯 22 度以上。", X0).length, 1);
  assert.deepEqual(geoProblems("臺灣大約在東經 120 到 122 度、北緯 22 到 25 度。最南約北緯 22 度，北回歸線約北緯 23.5 度。臺灣在東經 120 多度。", X0), []);
  assert.deepEqual(geoProblems("北緯 21 度以上", X0), []);
  assert.equal(geoProblems("北緯 32～35 度", X0).length, 1);
  assert.equal(geoProblems("北緯 30 度", X0).length, 1);
  const bad = [];
  claimTexts().forEach(([who, t]) => geoProblems(t, X0).forEach((p) => bad.push(who + "：" + p)));
  assert.deepEqual(bad, []);
});

test("⑫不把法律和道德切割（c04「交通規則…和良心無關」錯：同一件事可以同時是法律也是道德）", () => {
  const SPLIT = /(法律|交通規則|規則|法規)[^。；！？]*?(和|與|跟)(良心|道德)[^。；！？]*?(無關|沒有關係|沒關係|不相干)/;
  assert.ok(SPLIT.test("交通規則是法律的一部分，和良心無關。"), "判準自檢：要抓得到 c04 舊說法");
  assert.ok(!SPLIT.test("校規是學校訂的，和教義無關。"), "判準自檢：不誤判和法律道德無關的句子");
  const bad = claimTexts().filter(([, t]) => SPLIT.test(t)).map(([who, t]) => who + "：" + t);
  assert.deepEqual(bad, []);
});

test("⑬平均氣溫不拿來推極端天氣（g05「均溫 16.4 度，不會下大雪」錯：平均值推不出某天不會發生）", () => {
  const sent = (t) => String(t).split(/[。！？；]/);
  const MEAN_TO_EXTREME = /(均溫|平均氣溫|平均溫度)[^。！？；]*?(不會|一定|絕不|從來|永遠)/;
  const NEVER_SNOW = /不會下(大)?雪|從來不下雪|不可能下雪/;
  assert.ok(MEAN_TO_EXTREME.test("臺北 1 月均溫 16.4 度，不會下大雪"), "判準自檢：要抓得到 g05 舊說法");
  const bad = [];
  claimTexts().forEach(([who, t]) => sent(t).forEach((s) => { if (MEAN_TO_EXTREME.test(s) || NEVER_SNOW.test(s)) bad.push(who + "：" + s); }));
  assert.deepEqual(bad, []);
});

// ---------- 影片外開連結（Codex 審 ddd5a2e7：RKRvSGuU_cw 只取 76–236 秒，「在 YouTube 開啟」只帶 t=76，管不到結束） ----------
// 做法：有 end（只取一段）的影片不給外開連結，只留站內播放器（嵌入網址帶 start＋end，到 end 會停）。
// 不改用嵌入網址當外開連結：YouTube 嵌入頁直接開（不在 iframe 裡、沒有來源網址）會顯示「錯誤 153」，見 DevVault 2026-10-11 YouTube 錯誤 153。
test("⑭有截段（end）的影片不給「在 YouTube 開啟」；沒有截段的才給，且只帶開始秒數", () => {
  const html = fs.readFileSync(path.join(__dirname, "..", "src", "app.html"), "utf8");
  const m = /function mmss\(s\)\{[^\n]*\}\n/.exec(html), f = /function videoBlock\(tp\)\{[\s\S]*?\n\}\n/.exec(html);
  assert.ok(m && f, "src/app.html 找不到 mmss／videoBlock");
  const esc = (t) => String(t).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const V = require("../src/socvideos.js");
  const run = (vids) => new Function("window", "G5_VIDEOS", "esc", m[0] + f[0] + "return videoBlock('k');")({ G5_VIDEOS: { k: vids } }, { k: vids }, esc);
  const all = [];
  Object.keys(V).forEach((k) => (Array.isArray(V[k]) ? V[k] : []).forEach((v) => all.push(v)));
  assert.ok(all.some((v) => v.id === "RKRvSGuU_cw" && v.end === 236), "socvideos.js 應有 RKRvSGuU_cw 76–236");
  const bad = [];
  all.forEach((v) => {
    const h = run([v]), links = h.match(/href="[^"]*youtube\.com[^"]*"/g) || [];
    if (v.end && links.length) bad.push(v.id + " 有 end=" + v.end + " 卻有外開連結：" + links.join(" "));
    if (!/data-play="/.test(h) || (v.end && h.indexOf('data-end="' + v.end + '"') < 0)) bad.push(v.id + " 站內播放按鈕沒帶 end");
  });
  const h0 = run([{ id: "abcdefghijk", title: "t", channel: "c", start: 30 }]);
  if (!/href="https:\/\/www\.youtube\.com\/watch\?v=abcdefghijk&amp;t=30"|href="https:\/\/www\.youtube\.com\/watch\?v=abcdefghijk&t=30"/.test(h0)) bad.push("沒有 end 的影片應該保留外開連結（帶 t=開始秒）：" + h0);
  assert.deepEqual(bad, []);
});

// 2026-10-18 重複題只留一題（律師：「重複是指a題可以答對，也能夠答對b或c題，那b、c題就可能是重複觀念題」）
test("重複題合併表：被併的題存在、留下的題存在且沒被併（不接龍）、同一個觀念、寫了理由；出題＝全部扣掉被併的", () => {
  const byId = {}; B.ALL_CARDS.forEach((c) => { byId[c.id] = c; });
  const bad = [];
  Object.keys(B.MERGED).forEach((id) => {
    const m = B.MERGED[id], c = byId[id];
    if (!c) { bad.push(id + " 不在題庫"); return; }
    if (!Array.isArray(m.keep) || !m.keep.length || typeof m.why !== "string" || m.why.length < 8) bad.push(id + " 缺 keep／why");
    (m.keep || []).forEach((k) => {
      if (!byId[k]) bad.push(id + " → " + k + " 不在題庫");
      else if (B.MERGED[k]) bad.push(id + " → " + k + " 自己也被併掉了（不能接龍）");
      else if (byId[k].concept !== c.concept) bad.push(id + " → " + k + " 跨觀念");
    });
  });
  assert.deepEqual(bad, []);
  assert.deepEqual(B.CARDS.map((c) => c.id), B.ALL_CARDS.filter((c) => !B.MERGED[c.id]).map((c) => c.id));
  assert.equal(B.CARDS.length, 78);
  const n = {}; B.CARDS.forEach((c) => { n[c.concept] = (n[c.concept] || 0) + 1; });
  const thin = Object.keys(B.CONCEPTS).filter((k) => !(n[k] >= 4)).map((k) => k + "=" + (n[k] || 0));
  assert.deepEqual(thin, [], "每個觀念合併後至少 4 題");
});
