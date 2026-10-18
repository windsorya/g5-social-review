# Phase 3 工具裁決（Claude）— 原始輸出全文見 p3_raw.txt、p0_raw.txt

## Gemini 斷言
| # | 斷言（Gemini 原文） | 查法 | 原始輸出 | 判定 |
|---|---|---|---|---|
| G1 | 「嚴格加上守衛：`state.session.date === today`」 | git show HEAD:src/core.js（數學）grep "s.session = " | core.js:250 `s.session = { day: today, kind: "review", ...}`；:256 同為 `day` | 推翻（欄位名是 day，不是 date；照抄會恆為 false＝把當日 session 也排除） |
| G2 | 「poolCards() 與 unitCards() 無條件納入 state.session」 | sed -n 76,90p core.js | `if (state.session) state.session.queue.concat(state.session.answered)...` 無日期條件 | 證實 |
| G3 | 「Schema 升 v4；舊版讀到非 v3 即嚴格拒讀、零寫入」 | grep decode／refresh | core.js:551 `o.v !== 3 → bad("v")`；refresh() :667-675 `var r = decode(raw); if (!r.accepted) return false` 且註解「讀不到就不寫」 | 證實（已開著的舊頁寫入前先 refresh，讀到 v4 即不寫） |
| G4 | 「在 navigator.locks.request("storage_lock") 內依序執行讀取→apply→寫入」（每次寫入取鎖） | grep act()／錯題站 locks | 數學 app.html:379 `function act(a){...var r=store.dispatch(a);...return r;}` 同步；beginRound 依賴 `r.ok`。錯題站 core.js:321 `locks.request(LOCK,{ifAvailable:true},...)`、:310 hold() 回不 resolve 的 promise＝整頁持鎖、其他頁唯讀，:319 不支援時 NOLOCK | 推翻作法（每寫入取鎖會把同步 act 變非同步、波及所有呼叫端）；採錯題站「整頁單一寫入者」形狀 |
| G5 | 「app.html:576 讀取共用全域變數 pv.makeupPending 結算」 | sed -n 570,582p app.html | `function beginRound(a){var pv=V();if(pv.makeupPending&&pv.session){act({type:"makeupClaim",day:pv.makeupPending,ids:pv.session.answered.slice()});}` | 證實 |
| G6 | 「core.js:326 仍取重試當下的 today」 | sed -n 318,335p | `cd.madeUp = today;`、`claimable(s, today, ids)` | 證實 |
| G7 | 「graduated = n >= 3 須改 n >= 2」 | git grep 四站 | 四站 core.js `info.graduated = n >= 3`；GRAD_DAYS = 2 | 證實（應改為 n >= GRAD_DAYS，不寫死 2） |
| G8 | 「makeupCards 未檢查 due」 | git grep var old 四站 | 四站同碼 `cs.seen > 0 && !retired(cs) && ... && !hit[c.id]` | 證實（四站共病，Codex 只報社會） |
| G9 | 「把 merge.js 移到 steps.js 之前」 | git grep @INLINE 自然 | app.html:312 steps、:315 merge；steps.js:853 載入當下讀 root.G5_MERGED | 證實 |
| G10 | 「跨午夜：隔日提示『昨日補做未完成已重置』」（縮範圍建議） | 讀設計報告 (C)5 | 「跨午夜仍採現有語意：昨天未結算的卡不冒算成今天作答，目標日保持可補。」 | 查不到支持（與設計報告語意衝突；不採） |

## Grok 斷言
| # | 斷言（Grok 原文） | 查法 | 原始輸出 | 判定 |
|---|---|---|---|---|
| K1 | 「Node 沒有 navigator.locks：無後備則…整批爆；有後備仍直寫 setItem，同一反例再 FAIL」 | 讀錯題站 core.js locks 用法（p3_raw Q10） | 錯題站 :319 `if (!locks ...) { S.mode = "NOLOCK" ...}`；:269 非 writer 一律 no(...)＝唯讀 | 證實（每寫入取鎖在 Node 測不到；改用「store 注入鎖物件、無鎖即唯讀」才能在 Node 重現與驗收） |
| K2 | 「app.html:576 beginRound 讀共用 pv.makeupPending；M03 不跑這條」 | sed app.html:576 | `if(pv.makeupPending&&pv.session){act({type:"makeupClaim",day:pv.makeupPending,...` | 證實 |
| K3 | 「新核心若只收 v4，孩子既有 v3 被拒→T01 翻紅」 | 讀 decode:551 | `o.v !== 3 → bad("v")` | 證實（v4 必須同時接受 v3 並升版寫回） |
| K4 | 「completed=false 把補做門檻再綁回、T04 死鎖回來」 | git grep MAKEUP_TODAY_FIRST | core.js:243 `if (liveRemaining(s, bank, day).length) return fail(state0, "MAKEUP_TODAY_FIRST")` | 推翻（門檻看 liveRemaining 不看 completed）；仍採不改 completed、另加 planStatus，避免牽動舊測試 |
| K5 | 「(!cs.due||due<=today) 會放行 due=null 且尚未 graduated 的卡」 | grep due 設定點 | core.js:291 `cs.due = n >= GRAD_DAYS ? null : addDays(today, FIRST_GAP)`；:91 retired＝goodDays>=GRAD_DAYS | 推翻（狀態層 due=null ⇔ 已退場或未見過；錯的只有回饋旗標 info.graduated） |
| K6 | 「社會 app.html:455 用原始 S()…母體仍含昨日」 | git grep poolCards( 三站 app | 三站皆 `C.poolCards(S(),BANK,V().today)` | 部分推翻：已傳今天；病根在 core poolCards 無條件納入 session（G2），修 core 即可 |
| K7 | 「v4…sync.js 範圍外、雲端進度可能整份拒讀」 | grep g5-help/src/sync.js version | :131/:184/:205 version:1 為同步日誌自身版本；資料以 hash 處理 | 查不到支持（未見 sync 解析存檔 v；未跑整合 e2e，標查不到） |

## GPT 斷言
| # | 斷言（GPT 原文） | 查法 | 原始輸出 | 判定 |
|---|---|---|---|---|
| P1 | 「採『每次操作取得鎖』序列化」 | 同 G4／Q9 | act() 同步、beginRound 依賴 r.ok | 推翻（改採整頁單一寫入者） |
| P2 | 「跨日拒領，不採 Gemini M05 的隔日成功」 | 讀設計報告 (C)5 | 「昨天未結算的卡不冒算成今天作答，目標日保持可補」 | 證實（與設計報告一致） |
| P3 | 「core 的 makeupClaim … cd.madeUp = today」需綁實際作答日 | sed core.js:318-335 | `claimable(s, today, ...)`、`cd.madeUp = today` | 證實 |
| P4 | 「缺題時 completed=false，沿用 open＋missingIds」 | 讀 R4 測試 tests/core.test.js:691 | `assert.deepEqual([v.remainingIds, v.completed, v.missingIds], [[], true, ["gone"]])` | 不採（既有契約 completed=true；只改畫面與 planStatus，避免既有測試語意翻轉） |
