// 補做重開的固化（2026-10-19 律師：「為何補做暫停使用？請修好並固化」；交辦 #2995／#3015）。四站同一支。
// 10-18 縮範圍曾用 localStorage 旗標把補做入口預設關閉，孩子在日曆下只看到「補做暫停使用」。
// 這支擋三件事：再加回開關、再出現暫停說明、補做排不出卡時又宣稱每張都學會（Codex 審 b7bfddf F5）。
// 行為面由 tests/e2e_missing.py ③⑤⑥⑦ 在真瀏覽器鎖住。執行：node --test tests/makeup_open.test.js
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
for (const f of ["src/app.html", "index.html"]) {
  const t = () => fs.readFileSync(path.join(root, f), "utf8");
  test(f + "：補做入口沒有開關、日曆下沒有「暫停使用」說明", () => {
    const s = t();
    assert.ok(!/makeupOn|MAKEUP_ON/.test(s), "補做又被加了開關");
    assert.ok(!s.includes("暫停使用："), "補做又被關掉（日曆下的暫停說明回來了）");
    assert.ok(s.includes('data-mk="'), "補做按鈕不見了");
  });
  test(f + "：補做排不出卡時，不宣稱每張都學會", () => {
    const m = t().match(/MAKEUP_ALLDONE:"([^"]*)"/);
    assert.ok(m, "找不到 MAKEUP_ALLDONE 提示");
    assert.ok(!/每一張|每張|全部/.test(m[1]), m[1]);
  });
}
