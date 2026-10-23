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
  B.CARDS.forEach((c) => { assert.ok(c.concept in n, c.id + " 的觀念不存在"); n[c.concept]++; });   // 2026-10-18：上限管的是實際出題量（被併的題不出題）
  const off = CIDS.filter((k) => n[k] < 4 || n[k] > 15).map((k) => k + "=" + n[k]);
  CIDS.forEach((k) => assert.ok(B.ALL_CARDS.filter((c) => c.concept === k).length >= 8, k + " 全部題少於 8"));
  assert.deepEqual(off, [], "出題數不在 4～15：" + off.join("、"));
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
  // 2026-10-19：RKRvSGuU_cw（國中地科經緯度）已因範圍稽核拿掉；判準不綁特定影片，只要求真的有截段影片可測
  assert.ok(all.some((v) => v.end), "socvideos.js 應至少有一段有 end 的影片（否則這條測不到東西）");
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
  assert.deepEqual(B.CARDS.map((c) => c.id), B.ALL_CARDS.filter((c) => !B.MERGED[c.id] && !(B.RETIRED || {})[c.id]).map((c) => c.id));
  assert.equal(B.CARDS.length, 77);   // 2026-10-23：102 題－併題 10（c12、g02、c11、g01、e11 改回保留，#2709）－停出 21（f04 #3034 補停）＋1-1 補題 6（a12～a17）
  const n = {}; B.CARDS.forEach((c) => { n[c.concept] = (n[c.concept] || 0) + 1; });
  const thin = Object.keys(B.CONCEPTS).filter((k) => !(n[k] >= 4)).map((k) => k + "=" + (n[k] || 0));
  assert.deepEqual(thin, [], "每個觀念合併後至少 4 題");
});

// 2026-10-22（#2709）：被併題的錯誤選項若是保留題沒考到的另一個誤解，就不算重複（socbank.js 合併表檔頭的判準）。
// 下列題目是 Codex 審查逐題判過「保留題考不到它的誤解」的；再被併掉，她就練不到那個誤解。
const NOT_DUPLICATE = {
  d13: "法律全國都要遵守、由總統公布的誤解（Codex 審 51496e7）",
  f10: "暴雨時河水很快流入大海（Codex 審 51496e7）",
  g11: "離太陽比較遠、雨比較少的誤解（Codex 審 51496e7）",
  c12: "c01 沒考「讓大家都一樣有錢」「只用來處罰小孩」（Codex 審 7b9e5fe）",
  g02: "g04 沒考「沙漠氣候」／臺灣雨量多（Codex 審 7b9e5fe）",
  c11: "c03 沒考「法律只管家裡的事」（Codex 審 e61beae）",
  g01: "g03 沒考「寒帶」「溫帶」（Codex 審 e61beae）",
  e11: "e02＋e03 沒建立臺地和平原誰比較高，排除不了「平原比臺地高」（Codex 審 d9be678）"
};
test("重複題合併表：審查判定保留題考不到它的誤解的題，不得再併、照常出題", () => {
  const inCards = new Set(B.CARDS.map((c) => c.id));
  const bad = [];
  Object.keys(NOT_DUPLICATE).forEach((id) => {
    if (B.MERGED[id]) bad.push(id + " 又被併到 " + B.MERGED[id].keep.join("、") + "：" + NOT_DUPLICATE[id]);
    else if (!inCards.has(id) && !(B.RETIRED || {})[id]) bad.push(id + " 不在出題集合");
  });
  assert.deepEqual(bad, []);
});

// covers：被併題的每一個錯誤選項都要有人負責排除（why 只講正解，三輪審查各抓到漏網後補的對帳欄）
test("重複題合併表 covers：被併題的每個錯誤選項都寫了由哪一題（列在 keep、同觀念、沒被併）怎麼排除，不多不少", () => {
  const byId = {}; B.ALL_CARDS.forEach((c) => { byId[c.id] = c; });
  const bad = [];
  Object.keys(B.MERGED).forEach((id) => {
    const m = B.MERGED[id], c = byId[id];
    if (!c) return;   // 不在題庫由上一條測試報
    const wrong = c.opts.filter((_, i) => i !== c.a).slice().sort();
    const cv = m.covers || {};
    const keys = Object.keys(cv).sort();
    if (JSON.stringify(keys) !== JSON.stringify(wrong)) bad.push(id + " covers 的選項 " + JSON.stringify(keys) + " ≠ 錯誤選項 " + JSON.stringify(wrong));
    keys.forEach((o) => {
      const v = cv[o] || {};
      if (!Array.isArray(v.by) || !v.by.length) { bad.push(id + "「" + o + "」沒寫 by"); return; }
      v.by.forEach((k) => {
        if (!byId[k]) bad.push(id + "「" + o + "」by " + k + " 不在題庫");
        else if ((m.keep || []).indexOf(k) < 0) bad.push(id + "「" + o + "」by " + k + " 沒列在 keep");
        else if (B.MERGED[k]) bad.push(id + "「" + o + "」by " + k + " 自己也被併掉了");
        else if (byId[k].concept !== c.concept) bad.push(id + "「" + o + "」by " + k + " 跨觀念");
      });
      if (typeof v.how !== "string" || v.how.replace(/\s/g, "").length < 8) bad.push(id + "「" + o + "」沒寫怎麼排除（how）");
    });
  });
  assert.deepEqual(bad, []);
});

// ---------- 2026-10-19 範圍稽核（目標：小考／期中考考高分——考不到的不練，課本教的要練得到） ----------
// 依據：學校教學重點①（臺灣在世界地圖上的位置，利用相對位置表達周邊海域和鄰國）、康軒新版 1-1～2-2 公開教案、康軒 113 期中卷 3 份
// （經緯度、北回歸線度數、五大山脈、憲法皆 0 題）。北回歸線本身在 2-2（熱帶／副熱帶），可以出現。
const OUT_OF_SCOPE = /經度|緯度|東經|北緯|西經|南緯|半球|絕對位置|憲法|經線|緯線|分水嶺/;   // 分水嶺：國中七上用語（f07 停出）
const RETIRE_OUT = ["a01", "a02", "a08", "a09", "a10", "a11", "a03", "d08", "d09", "d10", "d12", "d02", "f04", "f05", "f07", "h13", "b07", "b08"];   // f04：2026-10-23 #3034 補（和 f05 同一個排序理由）
const RETIRE_CHALLENGE = ["a05", "f02", "f06"];

test("範圍①停出表：RETIRED 的題不排成新卡（不在 CARDS），仍在 ALL_CARDS 照常複習；out／challenge 各有理由", () => {
  const R = B.RETIRED;
  assert.ok(R && typeof R === "object", "socbank.js 沒有匯出 RETIRED");
  const byId = {}; B.ALL_CARDS.forEach((c) => { byId[c.id] = c; });
  const inCards = new Set(B.CARDS.map((c) => c.id));
  const bad = [];
  Object.keys(R).forEach((id) => {
    const r = R[id];
    if (!byId[id]) bad.push(id + " 不在 ALL_CARDS（停出不是刪題：練過的要能照常複習）");
    if (inCards.has(id)) bad.push(id + " 停出了卻還在 CARDS（會排成新卡）");
    if (!(r && (r.kind === "out" || r.kind === "challenge"))) bad.push(id + " kind 不是 out／challenge");
    if (!(r && typeof r.why === "string" && r.why.replace(/\s/g, "").length >= 8)) bad.push(id + " 沒寫停出理由");
    if (B.MERGED[id]) bad.push(id + " 同時在 MERGED 和 RETIRED");
  });
  assert.deepEqual(bad, []);
  assert.deepEqual(Object.keys(R).filter((id) => R[id].kind === "out").sort(), RETIRE_OUT.slice().sort(), "out 清單和稽核結論不同");
  assert.deepEqual(Object.keys(R).filter((id) => R[id].kind === "challenge").sort(), RETIRE_CHALLENGE.slice().sort(), "challenge 清單和稽核結論不同");
});

test("範圍②孩子看得到的文字不出現國中／別冊名詞（經緯度、半球、絕對位置、憲法、分水嶺）", () => {
  // 判準自檢：抓得到舊說法、北回歸線不誤判
  assert.ok(OUT_OF_SCOPE.test("臺灣大約在東經 120 到 122 度") && OUT_OF_SCOPE.test("北回歸線約在北緯 23.5 度") && OUT_OF_SCOPE.test("憲法規定") && OUT_OF_SCOPE.test("北半球") && OUT_OF_SCOPE.test("中央山脈是分水嶺"));
  assert.ok(!OUT_OF_SCOPE.test("北回歸線通過嘉義、花蓮和澎湖") && !OUT_OF_SCOPE.test("日本在臺灣的東北方"), "北回歸線、方位不該被擋");
  const hits = [];
  const chk = (who, t) => { if (typeof t === "string" && OUT_OF_SCOPE.test(t)) hits.push(who + "：" + t.slice(0, 80)); };
  // 會排成新卡的題：題目、選項、解說、提示、錯誤選項解說（答完就會看到）
  B.CARDS.forEach((c) => { chk(c.id + " 題目", c.q); c.opts.forEach((o) => chk(c.id + " 選項", o)); chk(c.id + " 解說", c.why); chk(c.id + " 提示", c.hint); c.wrongWhy.forEach((w) => chk(c.id + " 錯誤選項解說", w)); });
  CIDS.forEach((k) => {
    const c = B.CONCEPTS[k];
    ["title", "short", "exit", "exitAns"].forEach((f) => chk(k + " 觀念 " + f, c[f]));
    X.EXPLAIN[k].forEach((ex, j) => { [ex.name, ex.task, ex.ask].concat(ex.lines).forEach((t) => chk(k + " 說法" + (j + 1), t)); chk(k + " 說法" + (j + 1) + " 圖（含 aria-label）", ex.svg()); });
    const p = X.PREDICT[k]; [p.q, p.why].concat(p.opts).forEach((t) => chk(k + " 先想想看", t));
  });
  const V = require("../src/socvideos.js");
  Object.keys(V).forEach((k) => (Array.isArray(V[k]) ? V[k] : []).forEach((v) => { chk(k + " 影片 " + v.id + " 標題", v.title); chk(k + " 影片 " + v.id + " 說明", v.note); }));
  assert.deepEqual(hits, []);
});

test("範圍③ 1-1 相對位置：1a 會出新卡的題至少 6 張，而且都在範圍內", () => {
  const a = B.CARDS.filter((c) => c.concept === "1a");
  const clean = a.filter((c) => ![c.q, c.why, c.hint].concat(c.opts, c.wrongWhy).some((t) => OUT_OF_SCOPE.test(t || "")));
  assert.ok(clean.length >= 6, "1a 範圍內的新卡只有 " + clean.length + " 張：" + clean.map((c) => c.id).join("、"));
  assert.equal(clean.length, a.length, "1a 有範圍外的新卡：" + a.filter((c) => clean.indexOf(c) < 0).map((c) => c.id).join("、"));
  // 學校重點①的四塊都要練得到：八方位、鄰國方位、四周的海、亞洲東部
  const txt = a.map((c) => c.q + c.ans).join("｜");
  [/東北方|西南方|方位/, /日本|南韓|菲律賓/, /太平洋|臺灣海峽|巴士海峽|東海/, /亞洲/].forEach((re) => assert.ok(re.test(txt), "1a 缺這一塊：" + re));
});

test("範圍④影片只收康軒五上或國小通用影片：不收別版本（翰林、南一）或國中（七上、地球科學課）", () => {
  const V = require("../src/socvideos.js");
  const OTHER = /翰林|南一|七上|八上|九上|國中|地球科學/;
  const bad = [];
  Object.keys(V).forEach((k) => (Array.isArray(V[k]) ? V[k] : []).forEach((v) => { if (OTHER.test(v.title + " " + (v.note || ""))) bad.push(k + " " + v.id + "：" + v.title); }));
  assert.deepEqual(bad, []);
});

// ---------- 2026-10-23 交辦 #3034：Codex 審 cf08dd81（2026-10-20 00:14 收據）兩項內容 FAIL 的守門 ----------
// 單位＝孩子一次看到的一段字：題目各欄、觀念頁每一行、圖的 aria-label 和圖上文字分開算、先想想看、出口題
function textUnits(cards) {
  const out = [];
  const svg = (who, s) => {
    const m = /aria-label="([^"]*)"/.exec(s);
    if (m) out.push([who + " 圖說（aria-label）", m[1]]);
    out.push([who + " 圖上文字", s.replace(/<[^>]*>/g, "")]);
  };
  cards.forEach((c) => [c.q, c.ans, c.why, c.hint].concat(c.opts, c.wrongWhy).forEach((t) => out.push([c.id, t])));
  CIDS.forEach((k) => {
    const c = B.CONCEPTS[k];
    ["title", "short", "exit", "exitAns"].forEach((f) => out.push([k + " 觀念 " + f, c[f]]));
    X.EXPLAIN[k].forEach((ex, j) => { [ex.name, ex.task, ex.ask].concat(ex.lines).forEach((t) => out.push([k + " 說法" + (j + 1), t])); svg(k + " 說法" + (j + 1), ex.svg()); });
    const p = X.PREDICT[k]; [p.q, p.why].concat(p.opts).forEach((t) => out.push([k + " 先想想看", t]));
  });
  return out.filter((x) => typeof x[1] === "string" && x[1]);
}

// 國家賠償法第 3 條第 1 項（FACTCHECK law_stateco3）：「公共設施因設置或管理有欠缺，致人民…受損害者，國家應負損害賠償責任。」
const STATE_COMP = /國家賠償|國家要賠|國家會賠|國賠/;
const INJURY = /受傷|受損害|損害/;
const STATE_COMP_COND = /設置或管理有欠缺|沒設好或沒管好/;
test("內容①說到「受傷→國家賠償」的每一段字都帶成立條件（設置或管理有欠缺），不把單純受傷教成應賠", () => {
  // 判準自檢：抓得到收據裡的舊說法、放過帶條件的寫法
  assert.ok(STATE_COMP.test("例：設施害人受傷，國家賠償") && INJURY.test("例：設施害人受傷，國家賠償") && !STATE_COMP_COND.test("例：設施害人受傷，國家賠償"));
  assert.ok(STATE_COMP_COND.test("公共設施設置或管理有欠缺而害人受傷，國家要賠償"));
  const bad = textUnits(B.ALL_CARDS).filter((x) => STATE_COMP.test(x[1]) && INJURY.test(x[1]) && !STATE_COMP_COND.test(x[1])).map((x) => x[0] + "：" + x[1].replace(/\s+/g, " ").slice(0, 80));
  assert.deepEqual(bad, []);
  // 不是把國賠整段刪掉蒙混過關：1d 觀念頁兩種說法都還講得到國家賠償
  X.EXPLAIN["1d"].forEach((ex, j) => assert.ok(STATE_COMP.test(ex.svg()), "1d 說法" + (j + 1) + " 的國家賠償例子不見了"));
});

// 五大山脈由東到西的排序已判為考不到（f05 停出理由）；同一個排序換成「最東邊是哪一條」也一樣
const RANGE_ORDER = /由東(向|到|往)西|由西(向|到|往)東|最東邊|最西邊/;
test("範圍⑤五大山脈不教東西排序：f04 和 f05 一起停出；還會出現的題（新卡＋挑戰題到期複習）與觀念頁都不寫山脈排序", () => {
  assert.ok(RANGE_ORDER.test("由東到西是海岸山脈") && RANGE_ORDER.test("五大山脈裡，最東邊的是哪一條？") && RANGE_ORDER.test("海岸山脈在最東邊。"));
  assert.ok(!RANGE_ORDER.test("中央山脈北起蘇澳、南到鵝鑾鼻，是本島主幹。") && !RANGE_ORDER.test("日本在臺灣的東北方"), "非排序句不該被擋");
  const R = B.RETIRED;
  assert.equal(R.f04 && R.f04.kind, "out", "f04（最東邊是哪一條）沒有和 f05 一起停出");
  const served = B.ALL_CARDS.filter((c) => !B.MERGED[c.id] && !(R[c.id] && R[c.id].kind === "out"));
  const hits = textUnits(served).filter((x) => /山脈/.test(x[1]) && RANGE_ORDER.test(x[1])).map((x) => x[0] + "：" + x[1].replace(/\s+/g, " ").slice(0, 80));
  assert.deepEqual(hits, []);
  // 觀念頁仍然認得五大山脈的名字（範圍內），只是不背排序
  const ex = X.EXPLAIN["2b"][0];
  ["海岸山脈", "中央山脈", "雪山山脈", "玉山山脈", "阿里山山脈"].forEach((n) => assert.ok(ex.svg().indexOf(n) >= 0, "2b 圖少了 " + n));
});

test("範圍⑥照 app.html 組題庫跑核心：Codex 的重現（空白狀態 pick:fresh、ids:[f04]）佇列不再出 f04", () => {
  const R = B.RETIRED, active = {}, out = {};
  B.CARDS.forEach((c) => { active[c.id] = 1; });
  Object.keys(R).forEach((id) => { if (R[id] && R[id].kind === "out") out[id] = 1; });
  const bank = { cards: B.ALL_CARDS, active, out, concepts: {}, figs: {} };
  CIDS.forEach((k) => { bank.concepts[k] = { unit: B.CONCEPTS[k].unit }; });
  const start = (ids) => C.reduce(C.blankState(), { type: "sessionStart", id: "op-3034-" + ids.join(), kind: "review", pick: "fresh", ids }, { bank, now: Date.parse("2026-10-23T12:00:00+08:00") });
  // 對照組（探針有牙）：同一條路徑，範圍內的 f03 會排進佇列
  const ok = start(["f03"]);
  assert.deepEqual(ok.state && ok.state.session && ok.state.session.queue, ["f03"], "對照組 f03 沒排進佇列，這支測試打不到 review 路徑");
  const r = start(["f04"]);
  const q = (r.state && r.state.session && r.state.session.queue) || [];
  assert.ok(q.indexOf("f04") < 0, "f04 仍被排進佇列：" + JSON.stringify(q));
  assert.equal(r.error, "REVIEW_EMPTY", "只有 f04 時應該開不了局（全是考不到的題），實際：" + r.error);
});
