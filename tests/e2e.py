#!/usr/bin/env python3
"""五上社會複習 e2e：本機 index.html（或 --base 正式網址）；Chromium 桌機／手機 390、WebKit iPad。
（2026-10-13 由數學站 g5-math-review fd585e3 的 tests/e2e.py 複製改寫）
用 python3.12 執行：python3.12 tests/e2e.py [--base https://windsorya.github.io/g5-social-review/]
題目答案從頁面上的 window.G5SocBank 依題目文字查（題庫本身另有 tests/socbank.test.js 檢查）。"""
import json
import math
import sys
from pathlib import Path

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parent.parent
BASE = sys.argv[sys.argv.index("--base") + 1].rstrip("/") + "/" if "--base" in sys.argv else ROOT.as_uri() + "/"
URL = BASE + "index.html"
RESULTS = []


def check(name, cond, detail=""):
    RESULTS.append((name, bool(cond)))
    print(("PASS " if cond else "FAIL ") + name + ("" if cond else f"  ← {detail}"))


def open_page(browser, device=None, init=None):
    ctx = browser.new_context(**(device or {}))
    if init:
        ctx.add_init_script(init)
    page = ctx.new_page()
    errors = []
    page.on("pageerror", lambda e: errors.append(str(e)))
    page.goto(URL)
    page.wait_for_selector("#main .btn, #main .done")
    return ctx, page, errors


def current_card(page):
    q = page.locator("#main .q").inner_text()
    return page.evaluate("(q)=>{var c=G5SocBank.CARDS.find(function(x){return x.q===q;});return c?{id:c.id,a:c.a,opts:c.opts,concept:c.concept}:null;}", q)


def answer(page, right=True):
    c = current_card(page)
    assert c, "頁面上的題目在題庫裡找不到"
    i = c["a"] if right else (c["a"] + 1) % len(c["opts"])
    page.locator(f'#main .opt[data-i="{i}"]').click()
    return c, i


def no_overflow(page):
    return page.evaluate("document.documentElement.scrollWidth <= window.innerWidth + 1")


def flow_main(browser, label, device=None):
    ctx, pg, errors = open_page(browser, device)
    check(f"{label} 首頁標題與倒數", "五上社會複習" in pg.title() and pg.locator("#days").inner_text().strip().isdigit())
    n_c = pg.evaluate("Object.keys(G5SocBank.CONCEPTS).length")
    check(f"{label} {n_c} 個觀念入口", n_c == 8 and pg.locator("#concepts .ccard").count() == n_c, pg.locator("#concepts .ccard").count())
    check(f"{label} 小考複習列出第一、二單元", all(pg.locator(f'button[data-rv="u{u}"]').count() == 1 for u in ["s1", "s2"]))
    check(f"{label} 沒有水平捲動", no_overflow(pg))
    want = {"五上自然複習": "https://windsorya.github.io/g5-sci-review/", "五上數學複習": "https://windsorya.github.io/g5-math-review/",
            "難題解說": "https://windsorya.github.io/g5-help/", "五上國語複習": "https://windsorya.github.io/g5-chinese-review/",
            "錯題複習": "https://windsorya.github.io/g5-wrong-review/"}
    got = {a.inner_text(): a.get_attribute("href") for a in pg.locator("#siteNav a").all()}
    check(f"{label} 五站切換列（#1333／#1351）：四個連結＋本站「五上社會複習」", got == want and pg.locator('#siteNav [aria-current="page"]').inner_text() == "五上社會複習", got)
    pg.locator("#goAll").click()
    pg.wait_for_selector("#main .q")
    c, _ = answer(pg, True)
    check(f"{label} 答對：顯示答對了與解說", "答對了" in pg.locator("#ansBox").inner_text())
    pg.locator("#next").click(); pg.wait_for_selector("#main .q")
    c2, picked = answer(pg, False)
    box = pg.locator("#ansBox").inner_text()
    check(f"{label} 答錯：顯示正確答案、「你選的…」錯在哪", "正確答案是" in box and ("你選的「" + c2["opts"][picked] + "」") in box, box[:200])
    check(f"{label} 答錯：顯示查證出處", "查證：" in box, box[:300])
    pg.locator('#errq button[data-k="concept"]').click()
    pg.wait_for_selector("#remedy")
    rtxt = pg.locator("#remedy").inner_text()
    check(f"{label} 補救：有白話解說、圖（svg role=img）與「換一題確認」入口、沒有算術字樣", pg.locator("#remedy svg.fig[role=img]").count() >= 1 and pg.locator("#remedy li").count() >= 2 and pg.locator("#toLab").count() == 1 and "換一題確認" in pg.locator("#toLab").inner_text() and "跟著算" not in rtxt, rtxt[:200])
    pg.locator("#toLab").click()
    pg.wait_for_selector("#labPredict button[data-g]")
    pg.locator("#labPredict button[data-g]").first.click()
    n = 0
    while pg.locator("#mNext").is_visible() and n < 10:
        pg.locator("#mNext").click(); n += 1
    check(f"{label} 一句一句看懂：每一句都看過後可以換一題確認", pg.locator("#labDone").is_enabled(), n)
    pg.locator("#labDone").click()
    pg.wait_for_selector("#main .q")
    head = pg.locator("#main .qhead").inner_text()
    c3 = current_card(pg)
    check(f"{label} 換一題確認：同一個觀念、不同的題", "同觀念換一題確認" in head and c3 and c3["concept"] == c2["concept"] and c3["id"] != c2["id"], {"head": head, "c2": c2, "c3": c3})
    saved = json.loads(pg.evaluate("localStorage.getItem('g5soc.v1')") or "null")
    check(f"{label} 存檔在 g5soc.v1，作答都記到", saved and len(saved.get("log", [])) >= 2, (saved or {}).get("log"))
    pg.reload(); pg.wait_for_selector("#main .btn, #main .done")
    saved2 = json.loads(pg.evaluate("localStorage.getItem('g5soc.v1')") or "null")
    check(f"{label} 重新整理後紀錄還在", saved2 and len(saved2.get("log", [])) == len(saved.get("log", [])))
    others = pg.evaluate("Object.keys(localStorage).filter(function(k){return /^g5(math|sci|help|chi)/.test(k);})")
    check(f"{label} 不寫其他站的存檔 key", others == [], others)
    pg.locator("#syncBox summary").click()
    check(f"{label} 同步面板：有內容（接上或寫明還沒開放）", len(pg.locator("#g5sync").inner_text().strip()) > 0, pg.locator("#g5sync").inner_html()[:200])
    check(f"{label} 沒有 JS 錯誤", not errors, errors)
    ctx.close()


def flow_concepts(browser, label, device=None):
    ctx, pg, errors = open_page(browser, device)
    cids = pg.evaluate("Object.keys(G5SocBank.CONCEPTS)")
    bad = []
    for cid in cids:
        pg.locator(f'#concepts .ccard[data-cid="{cid}"]').click()
        pg.wait_for_selector("#main .remedy")
        first = pg.locator("#main .remedy strong").first.inner_text()
        ok = pg.locator("#main .remedy svg.fig").count() == 1 and pg.locator("#main .remedy li").count() >= 2
        pg.locator("#cMore").click()
        second = pg.locator("#main .remedy strong").first.inner_text()
        ok = ok and second != first and pg.locator("#main .remedy svg.fig").count() == 1 and pg.locator("#main .remedy li").count() >= 2
        has_vid = pg.evaluate("(k)=>Array.isArray(G5_VIDEOS[k])&&G5_VIDEOS[k].length>0", cid)
        ok = ok and (pg.locator("#main .vids button[data-play]").count() >= 1) == has_vid   # #1335：有驗證過的影片就要看得到；寫 noVideoReason 的不顯示
        # Codex 審 ddd5a2e7：有截段（end）的影片不給外開 YouTube 連結（外開管不到結束秒數，會播到沒核實／有錯的後段）
        n_open = pg.locator('#main .vids a[href*="youtube.com"]').count()
        n_free = pg.evaluate("(k)=>(G5_VIDEOS[k]||[]).filter(function(v){return !v.end;}).length", cid) if has_vid else 0
        ok = ok and n_open == n_free
        if not ok or not no_overflow(pg):
            bad.append(cid)
        pg.locator("#cBack").click(); pg.wait_for_selector("#concepts .ccard")
    check(f"{label} {len(cids)} 個觀念頁：兩種說法都有圖與解說、影片照資料顯示、沒有水平捲動", not bad, bad)
    check(f"{label} 觀念頁沒有 JS 錯誤", not errors, errors)
    ctx.close()


# ---------- 影片真的在播（照數學站 g5-math-review tests/e2e.py b1ae271 的 player_problem／flow_video_live） ----------
# Codex 審 ddd5a2e7：舊版捕捉讀取例外後只把文字設成「<讀不到…>」，再查有沒有「153」字樣——inner_text() 拋 TimeoutError 也判 PASS。
# 播放器畫面出現這些字＝不能播（YouTube 嵌入錯誤頁；英文介面與中文介面都列）。比對時不分大小寫。
PLAYER_ERROR_MARKS = ("video unavailable", "this video is private", "private video", "error 153", "錯誤 153",
                      "無法播放", "影片無法觀看", "私人影片", "an error occurred", "發生錯誤",
                      "sign in to confirm", "登入以確認")
# 讀播放器 iframe 裡的真實狀態：正常播放時 body 文字常是空的（數學站 2026-10-13 正式網址實測），所以看 <video> 元素。
PLAYER_STATE_JS = """b => { const v = b.querySelector('video'), e = b.querySelector('.ytp-error');
  return {text: (b.innerText || '').trim().slice(0, 200), hasVideo: !!v, t: v ? v.currentTime : null, paused: v ? v.paused : null,
          err: e ? (e.innerText || 'ytp-error').trim().slice(0, 120) : ''}; }"""
PLAY_GAP_MS = 2000        # 兩次讀狀態之間隔多久
PLAY_MIN_ADVANCE = 0.5    # 隔 PLAY_GAP_MS 後 currentTime 至少要多這麼多秒，才算真的在播


def player_problem(src, rp, read_state, wait):
    """判斷一個嵌入播放器是不是真的在播；回傳問題說明，在播回傳 None。
    read_state() 回傳 {text, hasVideo, t, paused, err}；先讀一次、wait()（約 2 秒）、再讀一次：
    兩次都要讀得到（讀取例外＝失敗）、有 <video>、沒有錯誤畫面；第二次 paused=false，且 currentTime 比第一次多 ≥ PLAY_MIN_ADVANCE 秒。"""
    if "youtube-nocookie.com/embed/" not in (src or ""):
        return f"iframe 沒指向 youtube-nocookie：{src}"
    if rp != "strict-origin-when-cross-origin":
        return f"referrerpolicy 不對：{rp}"
    states = []
    for k in (1, 2):
        if k == 2:
            wait()
        try:
            st = read_state()
        except Exception as e:  # noqa: BLE001 — 任何讀取失敗都是播放失敗
            return f"第 {k} 次讀不到播放器內容（{type(e).__name__}：{str(e)[:60]}）"
        if not isinstance(st, dict):
            return f"第 {k} 次讀到的播放器狀態讀不懂：{st!r}"[:120]
        low = (str(st.get("text") or "") + " " + str(st.get("err") or "")).lower()
        hit = next((m for m in PLAYER_ERROR_MARKS if m.lower() in low), None)
        if st.get("err") or hit:
            return f"第 {k} 次讀：播放器顯示錯誤（{hit or st.get('err')}）"
        if not st.get("hasVideo"):
            return f"第 {k} 次讀：播放器裡沒有 <video>（沒有載入影片）"
        states.append(st)
    t1, t2 = states[0].get("t"), states[1].get("t")
    if not all(isinstance(x, (int, float)) and not isinstance(x, bool) and math.isfinite(x) for x in (t1, t2)):
        return f"讀不到播放時間（t={t1}→{t2}）"
    if states[1].get("paused") is not False:
        return f"第二次讀時影片沒有在播（paused={states[1].get('paused')}、t={t2}）"
    if t2 - t1 < PLAY_MIN_ADVANCE:
        return f"影片沒有往前播（隔約 {PLAY_GAP_MS / 1000:g} 秒，t {t1}→{t2}，只多 {t2 - t1:.2f} 秒，至少要 {PLAY_MIN_ADVANCE}）"
    return None


def selftest_player():
    """播放判準的替身測試（不開瀏覽器）：餵假的兩次狀態序列，斷言判對；也斷言兩次讀之間真的有等（呼叫順序 讀→等→讀）。
    含 Codex 審 ddd5a2e7 的反例：讀取（inner_text／evaluate）拋 TimeoutError 必須判失敗。"""
    ok_src, ok_rp = "https://www.youtube-nocookie.com/embed/RKRvSGuU_cw?start=76&end=236", "strict-origin-when-cross-origin"

    def st(**kw):
        return dict({"text": "", "hasVideo": True, "t": 76.0, "paused": False, "err": ""}, **kw)
    boom = TimeoutError("Locator.inner_text: Timeout 10000ms exceeded.")
    cases = [  # (說明, 兩次狀態（例外＝讀時丟出）, 應判在播?)
        ("Codex 反例：inner_text 第一次就拋 TimeoutError", [boom, boom], False),
        ("第二次讀拋 TimeoutError", [st(t=76), boom], False),
        ("第一次讀拋 TimeoutError、第二次正常", [boom, st(t=78)], False),
        ("停在起點 {t:76, paused:true}", [st(t=76, paused=True), st(t=76, paused=True)], False),
        ("{paused:false, t:0} 沒前進", [st(t=0), st(t=0)], False),
        ("正常在播：76→78.1", [st(t=76), st(t=78.1)], True),
        ("剛好前進 0.5 秒", [st(t=76), st(t=76.5)], True),
        ("第二次暫停（雖然時間有前進）", [st(t=76), st(t=78, paused=True)], False),
        ("第二次 paused=None（讀不到）", [st(t=76), st(t=78, paused=None)], False),
        ("只前進 0.3 秒（緩衝中）", [st(t=76), st(t=76.3)], False),
        ("時間倒退", [st(t=80), st(t=76)], False),
        ("第一次 paused=true、第二次在播且前進", [st(t=76, paused=True), st(t=77.9)], True),
        ("錯誤 153 畫面", [st(text="影片播放器設定錯誤 錯誤 153"), st(t=78)], False),
        ("第二次出現 Video unavailable", [st(t=76), st(t=78, text="Video unavailable. This video is private.")], False),
        ("第一次有 .ytp-error", [st(err="ytp-error"), st(t=78)], False),
        ("Sign in to confirm you're not a bot", [st(text="Sign in to confirm you're not a bot"), st(t=78)], False),
        ("沒有 <video>", [st(hasVideo=False, t=None, paused=None), st(hasVideo=False, t=None, paused=None)], False),
        ("t 是 None", [st(t=None), st(t=None)], False),
        ("t 是字串", [st(t="76"), st(t="78")], False),
        ("狀態不是 dict（例如 inner_text 回字串）", ["", st(t=78)], False),
    ]
    wrong = []
    for name, seq, want in cases:
        log, it = [], iter(seq)

        def read():
            log.append("讀"); x = next(it)
            if isinstance(x, Exception):
                raise x
            return x
        got = player_problem(ok_src, ok_rp, read, lambda: log.append("等")) is None
        if got != want:
            wrong.append(f"{name}：應判{'在播' if want else '沒在播'}，判成{'在播' if got else '沒在播'}")
        if want and log != ["讀", "等", "讀"]:
            wrong.append(f"{name}：呼叫順序應為 讀→等→讀，實際 {log}")
    if player_problem("https://www.youtube.com/embed/RKRvSGuU_cw", ok_rp, lambda: st(), lambda: None) is None:
        wrong.append("iframe 不是 youtube-nocookie 卻判在播")
    if player_problem(ok_src, "no-referrer", lambda: st(), lambda: None) is None:
        wrong.append("referrerpolicy 錯卻判在播")
    check(f"播放判準替身測試：{len(cases) + 2} 個假狀態序列都判對（含 inner_text 拋 TimeoutError 要判失敗）", not wrong, wrong)


def flow_video_live(browser, label, device=None):
    """只在線上版跑（#1335）：每個有影片的觀念頁按第一段影片播放，iframe 指向 youtube-nocookie、帶 referrerpolicy；
    等播放器載入後隔約 2 秒讀兩次 <video>：都有 <video>、沒有錯誤畫面，第二次在播且時間前進 ≥0.5 秒。讀取例外＝失敗。"""
    ctx, pg, errors = open_page(browser, device)
    bad, ok = [], []
    cids = pg.evaluate("Object.keys(G5SocBank.CONCEPTS).filter(function(k){return Array.isArray(G5_VIDEOS[k])&&G5_VIDEOS[k].length;})")
    for cid in cids:
        pg.locator(f'#concepts .ccard[data-cid="{cid}"]').click(); pg.wait_for_selector("#main .remedy")
        b = pg.locator("#main .vids button[data-play]").first
        b.click()
        fr = pg.locator("#main .vids iframe").first
        src, rp = fr.get_attribute("src"), fr.get_attribute("referrerpolicy")
        pg.wait_for_timeout(5000)
        seen = []

        def read():
            s = pg.frame_locator("#main .vids iframe").first.locator("body").evaluate(PLAYER_STATE_JS, timeout=10000)
            seen.append({k: s.get(k) for k in ("t", "paused")} if isinstance(s, dict) else s)
            return s
        why = player_problem(src, rp, read, lambda: pg.wait_for_timeout(PLAY_GAP_MS))
        if why:
            bad.append((cid, why))
        else:
            ok.append((cid, seen))
        pg.locator("#cBack").click(); pg.wait_for_selector("#concepts .ccard")
    print("  影片兩次讀到的狀態（觀念：[第一次, 第二次]）：" + json.dumps(ok, ensure_ascii=False))
    check(f"{label} {len(cids)} 個有影片的觀念都真的在播（隔 {PLAY_GAP_MS / 1000:g} 秒讀兩次：有 <video>、無錯誤畫面、第二次沒暫停、時間前進 ≥{PLAY_MIN_ADVANCE} 秒）", cids and not bad, bad or "沒有任何觀念")
    ctx.close()


def flow_lab_save_fail(browser, label, device=None):
    """Codex 審 ddd5a2e7：「一句一句看懂」按「下一句」時存檔失敗也照樣前進（check(shown);shown++），
    恢復後 tasksDone 缺號、完成鈕停用、又沒有待重試的操作，這一輪做不完。
    重現：按「下一句」前讓 localStorage.setItem 拋錯、按兩次，再恢復，繼續按到底。
    應該：失敗時留在原句（沒有多出新句、出現「再存一次」），恢復後每一句都記到、完成鈕可按。"""
    ctx, pg, errors = open_page(browser, device)
    pg.locator("#goAll").click(); pg.wait_for_selector("#main .q")
    answer(pg, False)
    pg.locator('#errq button[data-k="concept"]').click(); pg.wait_for_selector("#remedy")
    pg.locator("#toLab").click(); pg.wait_for_selector("#labPredict button[data-g]")
    pg.locator("#labPredict button[data-g]").first.click()
    pg.wait_for_selector("#mNext")
    n_lines = pg.evaluate("document.querySelectorAll('#labTask .ck').length")
    pg.evaluate("""() => { window.__realSet = Storage.prototype.setItem;
      Storage.prototype.setItem = function () { throw new DOMException('QuotaExceededError', 'QuotaExceededError'); }; }""")
    pg.locator("#mNext").click()
    pg.evaluate("() => { const b = document.querySelector('#mNext'); if (b) b.click(); }")   # 4agent 方案 (a)：整頁暫停中再觸發（繞過遮罩）也不前進
    shown_while_failing = pg.locator("#mSteps li").count()
    retry_shown = pg.locator("#retrySave").count() == 1
    pg.evaluate("() => { Storage.prototype.setItem = window.__realSet; }")
    pg.locator("#retrySave").click()   # 恢復後按遮罩的再試一次補存
    n = 0
    while pg.locator("#mNext").is_visible() and n < 20:
        pg.locator("#mNext").click(); n += 1
    run = pg.evaluate("""() => { const s = JSON.parse(localStorage.getItem('g5soc.v1') || 'null'); if (!s) return null;
      const ids = Object.keys(s.labRuns || {}); const r = s.labRuns[ids[ids.length - 1]]; return r ? {tasksDone: r.tasksDone, tasks: r.tasks} : null; }""")
    done = sorted((run or {}).get("tasksDone") or [])
    check(f"{label} 一句一句看懂：存檔失敗時留在原句（沒有前進）並出現「再存一次」", shown_while_failing == 0 and retry_shown, {"失敗時顯示幾句": shown_while_failing, "再存一次": retry_shown})
    check(f"{label} 一句一句看懂：恢復後每一句都記到（tasksDone 不缺號）、完成鈕可按", run and done == list(range(run["tasks"])) and run["tasks"] == n_lines and pg.locator("#labDone").is_enabled(),
          {"run": run, "畫面句數": n_lines, "完成鈕": pg.locator("#labDone").is_enabled()})
    check(f"{label} 一句一句看懂存檔失敗流程沒有 JS 錯誤", not errors, errors)
    ctx.close()


BREAK_SET = """() => { window.__realSet = Storage.prototype.setItem;
  Storage.prototype.setItem = function () { throw new DOMException('QuotaExceededError', 'QuotaExceededError'); }; }"""
FIX_SET = "() => { Storage.prototype.setItem = window.__realSet; }"
LAST_RUN = """() => { const s = JSON.parse(localStorage.getItem('g5soc.v1') || 'null'); if (!s) return null;
  const ids = Object.keys(s.labRuns || {}); const r = s.labRuns[ids[ids.length - 1]];
  return r ? {id: ids[ids.length - 1], n: ids.length, tasksDone: r.tasksDone.slice().sort(), tasks: r.tasks} : null; }"""


def enter_lab(pg):
    pg.locator("#goAll").click(); pg.wait_for_selector("#main .q")
    answer(pg, False)
    pg.locator('#errq button[data-k="concept"]').click(); pg.wait_for_selector("#remedy")
    pg.locator("#toLab").click(); pg.wait_for_selector("#labPredict button[data-g]")
    pg.locator("#labPredict button[data-g]").first.click()
    pg.wait_for_selector("#mNext")
    return pg.evaluate("document.querySelectorAll('#labTask .ck').length")


def flow_lab_last_resume(browser, label, device=None):
    """Codex 審 e195ef98 #1：最後一句存檔失敗→恢復→切回分頁（visibilitychange 補存）→再按下一句，
    舊版 check() 見 tasksDone 已有這一句就直接 return true、不重繪，完成鈕一直停用。應該：補存後完成鈕可按。"""
    ctx, pg, errors = open_page(browser, device)
    n_lines = enter_lab(pg)
    for _ in range(n_lines - 1):
        pg.locator("#mNext").click()
    pg.evaluate(BREAK_SET)
    pg.locator("#mNext").click()
    failed_shown = pg.locator("#mSteps li").count()
    pg.evaluate(FIX_SET)
    pg.evaluate("() => document.dispatchEvent(new Event('visibilitychange'))")   # 4agent 方案 (a)：暫停中切回分頁只檢查、不補存
    pg.locator("#retrySave").click()                                               # 補存靠遮罩的再試一次
    if pg.locator("#mNext").is_visible():
        pg.locator("#mNext").click()
    run = pg.evaluate(LAST_RUN)
    st = pg.evaluate("() => document.querySelector('#retrySave') ? 'retry' : 'none'")
    check(f"{label} 最後一句存檔失敗→恢復→再試一次補存：每一句都記到、畫面四句都在、完成鈕可按",
          failed_shown == n_lines - 1 and run and run["tasksDone"] == list(range(n_lines)) and pg.locator("#mSteps li").count() == n_lines
          and st == "none" and pg.locator("#labDone").is_enabled(),
          {"失敗時句數": failed_shown, "run": run, "畫面句數": pg.locator("#mSteps li").count(), "再存一次": st, "完成鈕": pg.locator("#labDone").is_enabled()})
    if pg.locator("#labDone").is_enabled():
        pg.locator("#labDone").click()
    check(f"{label} 補存後按完成，回到練習換一題確認", pg.locator("#main .q").count() == 1, pg.locator("#main").inner_text()[:120])
    check(f"{label} 最後一句補存流程沒有 JS 錯誤", not errors, errors)
    ctx.close()


def flow_lab_retry_resume(browser, label, device=None):
    """Codex 審 e195ef98 #2：第二句存檔失敗→恢復→按上方「再存一次」，舊版存成功後呼叫 route()，
    screen="lab" 被導回首頁、lab=null，只能重開一輪。應該：留在原本那一輪，第二句接著出現，同一個 runId 做到完。"""
    ctx, pg, errors = open_page(browser, device)
    n_lines = enter_lab(pg)
    pg.locator("#mNext").click()
    pg.evaluate(BREAK_SET)
    pg.locator("#mNext").click()
    before = pg.evaluate(LAST_RUN)
    pg.evaluate(FIX_SET)
    pg.locator("#retrySave").click()
    after = pg.evaluate(LAST_RUN)
    still_lab = pg.locator("#labPredict").count() == 1 and pg.locator("#mNext").count() == 1
    check(f"{label} 「再存一次」成功後留在原本的一句一句看懂，第二句接著出現",
          still_lab and pg.locator("#mSteps li").count() == 2 and after and after["tasksDone"] == [0, 1] and pg.locator("#retrySave").count() == 0,
          {"還在學習畫面": still_lab, "畫面句數": pg.locator("#mSteps li").count(), "run": after, "main": pg.locator("#main").inner_text()[:80]})
    n = 0
    while still_lab and pg.locator("#mNext").is_visible() and n < 20:
        pg.locator("#mNext").click(); n += 1
    end = pg.evaluate(LAST_RUN)
    ok_end = bool(still_lab and end and before and end["id"] == before["id"] and end["n"] == before["n"]
                  and end["tasksDone"] == list(range(n_lines)) and pg.locator("#labDone").is_enabled())
    check(f"{label} 「再存一次」後續接同一輪（同一個 runId、沒有多開一輪）做到完、完成鈕可按", ok_end, {"before": before, "end": end})
    check(f"{label} 「再存一次」續接流程沒有 JS 錯誤", not errors, errors)
    ctx.close()


def flow_review(browser):
    ctx, pg, errors = open_page(browser)
    check("小考複習按鈕寫「第 2 單元 臺灣的自然環境與生活」", "第 2 單元 臺灣的自然環境與生活" in pg.locator("#main .review").inner_text(), pg.locator("#main .review").inner_text()[:200])
    pg.locator('button[data-rv="us2"]').click(); pg.wait_for_selector("#main .q")
    c = current_card(pg)
    check("小考複習：第 2 單元只出地形、氣候的題", c and c["concept"] in ("2a", "2b", "2c", "2d"), c)
    check("小考複習沒有 JS 錯誤", not errors, errors)
    ctx.close()


# 補題區（交辦 #1618）：家長打開才載入 g5-help/upload.js；本機測試用 g5-help 的原始碼頂替（還沒上線的版本也測得到），GAS 一律攔截不打真後端。
UP_SRC = ROOT.parent / "g5-help" / "src" / "upload.js"
UP_PNG = __import__("base64").b64decode("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==")


def flow_upload(browser, subject, site, bank_global):
    import json as _j, tempfile as _t
    live = BASE.startswith("https:")
    ctx = browser.new_context()
    ctx.add_init_script("localStorage.setItem('g5sync.code','ABCDEFGHJKMN')")
    sent, mode = [], {"fail_js": True}
    def gas(route):
        req = _j.loads(route.request.post_data or "{}")
        if route.request.method != "POST" or not req:   # GET 等非 JSON POST：從網址參數取 op，並記方法（審 684ecc8：GET 漏算）
            from urllib.parse import urlparse as _u, parse_qsl as _q
            req = dict(_q(_u(route.request.url).query), _method=route.request.method)
        sent.append(req)
        body = {"ok": True, "id": "u1"} if req.get("op") == "upload" else {"ok": True, "items": [], "lastFetch": 0} if req.get("op") == "mine" else {"ok": False, "err": "test"}
        route.fulfill(status=200, content_type="application/json", headers={"Access-Control-Allow-Origin": "*"}, body=_j.dumps(body))
    ctx.route("**/macros/s/**", gas)
    def upjs(route):
        if mode["fail_js"]:
            return route.abort()
        if live:
            return route.continue_()
        route.fulfill(status=200, content_type="application/javascript", body=UP_SRC.read_text(encoding="utf-8"))
    ctx.route("**/g5-help/upload.js", upjs)
    pg = ctx.new_page(); errors = []
    pg.on("pageerror", lambda e: errors.append(str(e)))
    pg.goto(URL); pg.wait_for_selector("#main .btn, #main .done")
    check(f"補題區 首頁沒打開前不載入 upload.js", pg.evaluate("!window.G5Upload && !document.querySelector('script[src*=\"g5-help/upload.js\"]')"))
    pg.locator("#upBox summary").click()
    pg.wait_for_function("document.getElementById('g5upload').textContent.indexOf('載入失敗') >= 0", timeout=10000)
    check(f"補題區 upload.js 載不到：說明可以關掉再打開重試", "關掉再打開" in pg.inner_text("#g5upload"))
    mode["fail_js"] = False
    pg.locator("#upBox summary").click(); pg.locator("#upBox summary").click()
    # 補題區已關功能（g5-help upload.js ENABLED=false，迴圈 L20261013134831-7db82f 會診後第 2 次 FAIL）：只顯示暫停說明、導向難題站、0 請求
    pg.wait_for_function("document.getElementById('g5upload').textContent.indexOf('補題區暫停使用') >= 0", timeout=20000)
    link = pg.locator("#g5upload a[href='https://windsorya.github.io/g5-help/']")
    check(f"補題區 暫停：說明與難題站連結看得見、沒有表單", pg.locator("#g5upload .g5u-msg", has_text="補題區暫停使用").is_visible() and link.count() == 1 and link.is_visible() and pg.locator("#g5upload .g5u-send, #g5upload .g5u-file").count() == 0)   # 審 684ecc8：只比 textContent 會放過 hidden
    pg.wait_for_timeout(500)
    up_ops = [r for r in sent if r.get("op") != "get"]   # 只有本站同步自己的 op:get 不算；其餘（含 GET、沒有 op 的請求）一律算補題區送出
    check(f"補題區 暫停：補題區沒有送出任何請求（除本站同步 op:get 外＝0，含 GET）", not up_ops, up_ops[:2])
    check(f"補題區 沒有水平捲動", no_overflow(pg))
    # 做好了的連結 #c/<觀念id> 直接打開那個觀念；不存在的觀念留在首頁
    cid = pg.evaluate(f"Object.keys(window.{bank_global}.CONCEPTS)[0]")
    pg.goto(URL + "#c/" + cid); pg.wait_for_selector("#main .remedy", timeout=10000)
    check(f"補題區 #c/{cid} 直接打開該觀念", pg.locator("#cBack").count() == 1)
    pg2 = ctx.new_page(); pg2.on("pageerror", lambda e: errors.append(str(e)))
    pg2.goto(URL + "#c/no-such-concept"); pg2.wait_for_selector("#main .btn, #main .done")
    check(f"補題區 #c/不存在的觀念：留在首頁", pg2.locator("#main .remedy").count() == 0 and pg2.locator("#concepts .ccard").count() > 0)
    check(f"補題區 沒有 JS 錯誤", not errors, errors)
    ctx.close()


def main():
    with sync_playwright() as p:
        selftest_player()
        cr = p.chromium.launch()
        if BASE.startswith("https:"):
            flow_video_live(cr, "線上Chromium")
        flow_lab_save_fail(cr, "桌機", {"viewport": {"width": 1280, "height": 900}})
        flow_lab_last_resume(cr, "桌機", {"viewport": {"width": 1280, "height": 900}})
        flow_lab_retry_resume(cr, "桌機", {"viewport": {"width": 1280, "height": 900}})
        flow_main(cr, "桌機", {"viewport": {"width": 1280, "height": 900}})
        flow_main(cr, "手機390", {"viewport": {"width": 390, "height": 844}, "is_mobile": True, "has_touch": True, "device_scale_factor": 2})
        flow_concepts(cr, "手機390", {"viewport": {"width": 390, "height": 844}, "is_mobile": True, "has_touch": True})
        flow_review(cr)
        flow_upload(cr, "社會", "g5-social-review", "G5SocBank")
        cr.close()
        wk = p.webkit.launch()
        ipad = p.devices["iPad (gen 7)"]
        flow_main(wk, "iPad", ipad)
        flow_concepts(wk, "iPad", ipad)
        flow_upload(wk, "社會", "g5-social-review", "G5SocBank")
        wk.close()
    bad = [r for r in RESULTS if not r[1]]
    print(f"\n{len(RESULTS) - len(bad)}/{len(RESULTS)} PASS")
    sys.exit(1 if bad else 0)


if __name__ == "__main__":
    main()
