# 4agent 協作報告｜四站裁題承接第 2 輪 FAIL｜2026-10-18（迴圈 L20261018061404-4e46e8）

## 前提查核（Phase 0）
見 4B-20261018-g5r2_claude_premise.txt：#2696 只改排程沒改學會判定（部分推翻前一棒結案證據）；T15–T18 並非「同意不修」而是設計報告驗收列（推翻前一棒進度表）。

## 工具裁決摘要（Phase 3，見 _claude_probe.txt）
證實 13、推翻 7（G1 欄位名 date→day、G4/P1 每寫入取鎖、K4、K5、K6 部分、P4 不採）、查不到 2（G10、K7）。

## 最終方案（依上列查證）
A. 本輪必修（四站共用 core，收據原重現先寫成測試、舊碼紅）
 1. info.graduated = n >= GRAD_DAYS；MAKEUP 文案改「兩個不同的日子」（G7）。
 2. view() 增 planStatus：empty／open／complete／complete_missing；completed 語意不變（K4、P4）；首頁 complete_missing 顯示「完成 N 張，另有 M 張題目已不在題庫」，不得出現「全部完成」。
 3. poolCards 只在 session.day === day 時納入 session（G1、G2、K6）。
 4. makeupCards 舊卡須 due 存在且 ≤ 今天；排除今天已被其他補做日結算用掉的卡（touched 於 madeUp=今天 的日子）（G8、K5、截斷列）。
 5. 自然：merge.js 移到 steps.js 之前（G9）。
B. 多分頁一族（錯題站已 PASS 形狀，K1）
 6. 單一寫入分頁：createStore 收 opt.lock（app 以 navigator.locks ifAvailable 整頁持有；無鎖或沒搶到＝唯讀並明講）；非寫入者 dispatch 回 READONLY、零寫入（T18、T15）。
 7. makeupClaim 綁 answerDay（＝回合 session.day），≠ 今天即拒領 MAKEUP_STALE，目標日保持可補（T16、P2）；beginRound 只結算本頁回合自己的 session.makeup（K2）。
 8. schema v4：decode 接受 v3／v4，寫入一律 v4；舊頁 refresh 讀到 v4 拒讀零寫入（G3、K3）。
C. 翻案（縮範圍）條件：本方案後再 2 輪 FAIL 且 FAIL 落在 B 族 ⇒ 關補做功能（入口隱藏、core 拒補做型動作），保留單一寫入者與資料。
D. 驗收矩陣：M01 缺題首頁／M02 二次學會／M03 本頁補做歸屬／M04 交錯寫入（雙 store 共用假鎖）／M05 跨日拒領／M06 舊頁 v4 拒寫（已載入 v3 的舊 store 再 tick）／M07a 補做到期／M07b 截斷後不重排／M08 自然載入順序（依 HTML 順序 VM 載入，q13 p27 p55）／M09 跨日母體／M10 寫失敗重試只結算一次。
