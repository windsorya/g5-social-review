# 存檔一不正常就整頁暫停，核心只留一筆（2026-10-14，4agent 最終方案 (a)）

來源：4agent 會診報告 4A-20261014-threesites【最終方案】(a)（迴圈 L20261013140245-c837f9、L20261013140430-b9551f、L20261013140308-6182ca）；自然站 d72a496 有同一套 resume 程式、同型回歸，一併套用（迴圈 L20261013140433-108c79）。四站副本逐字相同。

## 優先關係

本文件優先於 design-storage-resume-20261013.md 的 C1–C3 衝突部分（resume 不再接受參數、故障中不再接受第二筆操作、畫面改成整頁暫停）。C4、C5 是自然站專屬，已由自然站的 design-storage-scopecut-20261014.md 作廢。F2、X1–X4 不放寬。

## 核心（src/core.js createStore，四站逐字相同）

| 編號 | 規格 |
|---|---|
| K1 | 刪除舊版死碼：retire、archiveOld、setLegacy、restoreLegacy、finish、retryArchive 與 legacy、archive、mine、oTxt、legacyTxt、restoreUnsaved、choiceLocked。LS_V1＝null 照舊，load() 不碰舊 key（S0）。 |
| K2 | storageStatus 唯一公式：stale→stale；loadError→blocked；readFailed→readFailed；待存一筆或 tick 沒做完→saveFailed；其餘→ok。blocked 涵蓋開頁 READ 與壞檔 SCHEMA。 |
| K3 | 單槽閘門在 dispatch 入口：狀態不是 ok 時一律回 BLOCKED，零讀零寫、狀態不變，tick 也不例外；只有 resume 的補存路徑可繞過。狀態 ok 時讀失敗：有 id 的收成唯一待存、tick 記成沒做完，回 READ；寫失敗同樣收成待存，回 SAVE_FAILED。刪除「先補舊筆再收新筆」。 |
| K4 | resume() 不接受參數：查當下存檔 → 補存唯一待存 → tick，每一步失敗就停。stale 回 STATE_CHANGED；開頁 READ 回 RELOAD_REQUIRED；壞檔回 BLOCKED。補存成功時把該筆的回饋資訊存進核心，後面的 tick 失敗也不清。全部成功才回 ok（含 acceptedId）。retry()＝resume()。 |
| K5 | takeInfo(id)：回傳並清除那一筆的回饋資訊（畢業等），畫面用它公布，不用猜。 |
| K6 | check()／refresh() 只做唯讀比對與失效偵測；讀成功也不清已觀察到的讀不到、待存、tick 沒做完，只有 resume 整條成功才解除。 |
| K7 | 錯誤分類不改寫：READ 就是 READ，寫失敗是 SAVE_FAILED，業務錯誤原樣回傳；補存那筆遇業務錯誤時停住，不丟棄後當成功。 |
| K8 | 外部變更流程照舊（prepareReload、invalidate、watches、失效優先）；失效時有待存仍要確認「這一步需要重做」。 |

## 畫面（src/app.html，四站同型）

| 編號 | 規格 |
|---|---|
| U1 | banners() 是唯一的遮罩 renderer：狀態不是 ok 就蓋上 #storeMask（role=alertdialog，其餘 body 子元素 inert，焦點移到遮罩）。讀不到：「暫時讀不到紀錄，先停在這裡」；有待存：「剛剛那一步還沒存進這台裝置」；只有 tick 沒做完：「今天的進度還沒整理好」（不說沒有存）；以上都有〔再試一次〕〔回首頁〕。開頁讀不到：「讀不到這台裝置的紀錄」＋〔重新整理〕。壞檔：「存檔讀不出來」＋家長兩步〔清除壞掉的存檔，重新開始〕。 |
| U2 | 〔回首頁〕＝整頁重載；有待存時先確認「這一步還沒存，回首頁後要重做」，取消就留著遮罩與待存。 |
| U3 | canGo()＝沒有失效而且狀態是 ok。下一題（nextQ）、練習畫面、route、觀念頁、實驗、首頁（開頁那一次除外）、下一步、完成鈕、作答，第一行都先問 canGo()。其餘寫入入口靠核心 K3 兜底。 |
| U4 | submit：暫停中不收；成功才公布；READ／SAVE_FAILED 時這一題由核心持有，畫面只留脈絡用來公布、不拿它補送，選項維持停用、不標對錯。刪除 SAVE_PENDING 分支、1.6 秒重畫、#saveFail、#saveAgain、resume(a)。 |
| U5 | resumeUI：只由遮罩的〔再試一次〕與切回分頁呼叫；失效走失效流程、RELOAD_REQUIRED 整頁重讀、其他失敗留著遮罩不換畫面；成功才關遮罩，原題尚未公布而且已存就用 takeInfo 公布。遮罩已關時的舊按鈕點擊不再動作。 |
| U6 | 切回分頁：遮罩開著時只 check()（失效才走失效流程），不 resume、不重畫；遮罩關著才 resumeUI 補做 tick，失敗就進遮罩。 |
| U7 | 刪除 ready() 的自動 resume、readNote 旗標殘留、只為舊版搬移存在的死分支；storage 事件照舊。 |

## 驗收列（tests/external.test.js、tests/e2e_external.py；四站逐字相同）

核心：A01、A07、A14／A15、A16、A17、A18、A19、A20（22,620 條序列列舉）、A21；N22＝T17／28b；N23＝原 T01–T16；N24＝本站 createStore 的 SHA-256 與四站共同值相同；R25＝產物與來源一致。
畫面（Chromium＋WebKit，原始 handler）：A01、A02（含 A04、A05）、A08、A09、A11、A12、A13、A14、A16、A21。

## 契約換新的舊測試（改寫、不刪；原反例由新列承接）

- 「故障中接受第二筆操作／先補舊筆」：core.test 27b、D1、M4；external R03、R09、R27、R28、T10、T11 → 改成 BLOCKED（A01、A19 承接）。
- 「resume(a) 補送畫面答案」「#saveFail／#saveAgain」「SAVE_PENDING 1.6 秒重畫」「ready() 自動 resume」：e2e R01–R05、R27–R31、T08b、T10、T11、T14、T15、T27、T28、M 流程；e2e_v3 矩陣 19、27、D1、R2 → 改成按遮罩的〔再試一次〕（A02、A08、A09、A11、A21 承接）。
- 「READ 被改報 SAVE_*」：已在補充設計校正，A17 承接。

## 停止條件（會診後計數）

會診後第 1 次 FAIL：只修該輪點名的列。第 2 次 FAIL：當輪關功能，三站 git checkout origin/main -- src/core.js src/app.html 與對應存檔測試，build、node 全套，docs 記錄理由，三條迴圈 record-owner --decision close（可推翻）。
