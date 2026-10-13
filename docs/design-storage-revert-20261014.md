# 存檔核心退回線上版（2026-10-14，迴圈 L20261013140308-6182ca 關功能）

- 依據：4agent 會診後第 2 次 FAIL（審 3e88471），三站報告 ~/scripts/state/fouragent_20261014_threesites/4A_threesites_report.md 第四節停止條件「當輪關功能，不再修」；常設授權 2026-09-17／09-23。
- 做法：src/core.js、src/app.html、tests/core.test.js 回到 origin/main（建置後 index.html 與線上版逐字相同）；刪除只驗新存檔能力的 tests/e2e_external.py、tests/external.test.js。
- 守住的底線：線上版既有行為（讀不到就不寫、不拿空白蓋掉存檔），真實裝置不退步。
- 放棄的：從未上線的「別處改掉存檔就整頁失效／存檔不正常整頁暫停」。本目錄其他 design-storage-*.md 保留作紀錄，不代表已上線。
- 可推翻：要恢復請另行交辦、開新迴圈。
