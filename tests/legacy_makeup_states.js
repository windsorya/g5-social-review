// 父版補做（逐題歸屬；aa7a05a／f3ed703／a9a0882，2026-10-14 10:45–11:52 在線上）真的寫出過的補做存檔。
// 用當時那三版核心原封不動（tests/fixtures/core.makeup-perq-*.js）跑「今天做完 → 開補做 10/13 → 答 0／1／全部」產生，
// 不手刻形狀（Codex 審 0f3f4f68 第 1 項，#2505；同國語站 #2498、數學站 #2500、自然站 #2502）。core.test.js L01–L11 與 tests/e2e_legacy_makeup.py 共用。
// 直接執行（node tests/legacy_makeup_states.js）＝把全部情境印成 JSON 給 e2e 用。
"use strict";
const VERSIONS = ["aa7a05a", "f3ed703", "a9a0882"];
const TODAY = "2026-10-14", DAY = "2026-10-13";
const CONCEPTS = { "1-1": { unit: "1" }, "1-2": { unit: "1" }, "3-1": { unit: "3" } };
const card = (id) => ({ id, concept: "1-1", type: "choice", q: "題目 " + id, opts: ["甲", "乙"], a: 0 });
const BANK = { cards: Array.from({ length: 30 }, (_, i) => card("c" + (i + 1))), concepts: CONCEPTS, figs: { "sun-am": 1, "sun-pm": 1 } };
const NOON = (d) => Date.parse(d + "T12:00:00+08:00");
const copy = (x) => JSON.parse(JSON.stringify(x));

// 傳入 bank（e2e 用站上真的題庫）就照那份題庫跑；預設用測試題庫
function states(bank) {
  bank = bank || BANK;
  const out = [];
  VERSIONS.forEach((v) => {
    const O = require("./fixtures/core.makeup-perq-" + v + ".js");
    let n = 0;
    const run = (s, a) => { const r = O.reduce(s, Object.assign({ id: v + "-" + (++n) }, a), { bank, now: NOON(TODAY) }); if (r.error) throw new Error(v + " " + a.type + " " + r.error); return r.state; };
    let s = run(O.blankState(), { type: "sessionStart" });
    while (s.session.queue.length) s = run(s, { type: "answer", cardId: s.session.queue[0], ok: true });
    s = run(s, { type: "sessionStart", kind: "makeup", day: DAY });
    out.push({ version: v, stage: "opened", answered: 0, state: copy(s) });
    s = run(s, { type: "answer", cardId: s.session.queue[0], ok: true, makeup: DAY });
    out.push({ version: v, stage: "one", answered: 1, state: copy(s) });
    while (s.session.queue.length) s = run(s, { type: "answer", cardId: s.session.queue[0], ok: true, makeup: DAY });
    out.push({ version: v, stage: "done", answered: s.session.answered.length, state: copy(s) });
    out.forEach((x) => { if (x.version === v) x.oldErrors = O.checkState(x.state, bank); });
  });
  return out;
}
module.exports = { states, VERSIONS, TODAY, DAY, BANK };
if (require.main === module) {
  const bank = process.argv[2] ? JSON.parse(require("fs").readFileSync(process.argv[2], "utf8")) : undefined;
  process.stdout.write(JSON.stringify(states(bank)));
}
