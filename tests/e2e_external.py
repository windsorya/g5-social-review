#!/opt/homebrew/opt/python@3.12/bin/python3.12
"""存檔在頁面開著時被別處改掉／刪掉——端到端驗收（設計 g5-sci-review/docs/design-external-change-codex-20261013.md 方案 A，矩陣標 E 的 T01–T15）。

四個同型站（自然、數學、國語、社會）這個檔逐字相同：存檔 key 一律從頁面上的 G5Core.LS_KEY／LS_V1 取，不寫死站名；
作答、實驗、逐句解說都用畫面上找得到的按鈕操作。

跑法：python3.12 tests/e2e_external.py [--page index.html] [--only T05,T11] [--browser Chromium,WebKit]
做法：本機起一個 http 伺服器（同源，storage 事件才會在分頁之間傳），同一個 browser context 開兩個 page 當兩個分頁
（設計：不能用兩個隔離 context 代替跨分頁）；Chromium 與 WebKit 都跑。外部網址（字型、同步、QR）一律擋掉，測的只有本站。
斷言同時看：可見畫面、實際存檔、這一頁對存檔 key 的寫入次數（__w）、重新載入次數、pageerror。
「重載前那一刻」用同一個 JS 工作裡「點按鈕＋量畫面」做（sync_click），重載排在 setTimeout 之後，量得到失效當下的樣子。
"""
import functools
import http.server
import json
import sys
import threading
import time
import traceback
from pathlib import Path

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parent.parent
PAGE = sys.argv[sys.argv.index("--page") + 1] if "--page" in sys.argv else "index.html"
BROWSERS = sys.argv[sys.argv.index("--browser") + 1].split(",") if "--browser" in sys.argv else ["Chromium", "WebKit"]
ONLY = set(sys.argv[sys.argv.index("--only") + 1].split(",")) if "--only" in sys.argv else None
RESULTS = []
KNOWN = {}   # 題目文字 → 正確選項（答過一次、畫面標出 .opt.right 之後才知道）

# 每個分頁都裝：數這一頁對本站存檔 key 的寫入次數；可以讓 localStorage 的寫／讀丟錯（只影響 localStorage，不影響 sessionStorage）
INIT = """(() => { const S = Storage.prototype, set = S.setItem, get = S.getItem; window.__w = 0;
  S.setItem = function (k, v) {
    if (this === window.localStorage) {
      if (window.__failSet) throw new DOMException('QuotaExceededError', 'QuotaExceededError');
      if (window.G5Core && k === window.G5Core.LS_KEY) window.__w++;
    }
    return set.call(this, k, v); };
  S.getItem = function (k) { if (window.__failGet && this === window.localStorage) throw new DOMException('SecurityError', 'SecurityError'); return get.call(this, k); };
})();"""

SNAP = """(sel) => { const K = G5Core.LS_KEY, o = document.querySelector('#outdated');
  return {overlay: document.querySelectorAll('#outdated').length, text: o ? o.textContent : '', w: window.__w, raw: localStorage.getItem(K),
          li: document.querySelectorAll('#mSteps li').length}; }"""
# 同一個 JS 工作裡：先量、點、再量（重載排在 setTimeout 0，之後才發生）
SYNC_CLICK = """(sel) => { const K = G5Core.LS_KEY, w0 = window.__w, b = document.querySelector(sel);
  if (!b) return {missing: sel}; b.click(); const o = document.querySelector('#outdated');
  return {overlay: document.querySelectorAll('#outdated').length, text: o ? o.textContent : '', dw: window.__w - w0, raw: localStorage.getItem(K),
          li: document.querySelectorAll('#mSteps li').length}; }"""
SYNC_VIS = """() => { const K = G5Core.LS_KEY, w0 = window.__w; document.dispatchEvent(new Event('visibilitychange'));
  const o = document.querySelector('#outdated');
  return {overlay: document.querySelectorAll('#outdated').length, text: o ? o.textContent : '', dw: window.__w - w0, raw: localStorage.getItem(K)}; }"""
LAST_RUN = """() => { const s = JSON.parse(localStorage.getItem(G5Core.LS_KEY) || 'null'); if (!s) return null;
  const ids = Object.keys(s.labRuns || {}); const r = s.labRuns[ids[ids.length - 1]];
  return r ? {id: ids[ids.length - 1], n: ids.length, tasksDone: r.tasksDone.slice().sort(), tasks: r.tasks} : null; }"""
REDO = "紀錄已在別處更新，這一步需要重做"


def check(name, cond, detail=""):
    RESULTS.append((name, bool(cond)))
    print(("PASS " if cond else "FAIL ") + name + ("" if cond else f"  ← {detail}"), flush=True)


class Quiet(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a):
        pass


def serve():
    srv = http.server.ThreadingHTTPServer(("127.0.0.1", 0), functools.partial(Quiet, directory=str(ROOT)))
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    return srv, f"http://127.0.0.1:{srv.server_address[1]}"


ORIGIN = None


class Tab:
    """一個分頁：記 pageerror、主框架導航次數（＝載入／重載次數）。"""

    def __init__(self, ctx):
        self.p = ctx.new_page()
        self.errors, self.navs = [], 0
        self.p.on("pageerror", lambda e: self.errors.append(str(e)))
        self.p.on("framenavigated", self._nav)
        self.p.goto(ORIGIN + "/" + PAGE)
        self.ready()

    def _nav(self, fr):
        if fr == self.p.main_frame:
            self.navs += 1

    def ready(self):
        self.p.wait_for_selector("#main .btn, #main .done")

    def ev(self, js, arg=None):
        return self.p.evaluate(js, arg) if arg is not None else self.p.evaluate(js)

    def key(self):
        return self.ev("G5Core.LS_KEY")

    def raw(self):
        return self.ev("localStorage.getItem(G5Core.LS_KEY)")

    def state(self):
        r = self.raw()
        return json.loads(r) if r else None

    def wait_reload(self, n0, timeout=10):
        end = time.time() + timeout
        while self.navs <= n0 and time.time() < end:
            self.p.wait_for_timeout(100)
        if self.navs <= n0:
            return False
        self.p.wait_for_load_state("domcontentloaded")
        self.ready()
        return True

    def quiet(self, ms=1200):
        """等一段時間，回傳這段時間有沒有被重載。"""
        n0 = self.navs
        self.p.wait_for_timeout(ms)
        return self.navs == n0

    def settle(self, ms=900):
        """等到這一頁連續 ms 毫秒沒有再重載（別頁連續寫兩次會重載兩次）。"""
        for _ in range(20):
            if self.quiet(ms):
                break
        self.ready()

    def has(self, sel):
        return self.p.locator(sel).count() > 0


def new_ctx(browser, device):
    ctx = browser.new_context(**(device or {}))
    ctx.set_default_timeout(15000)
    ctx.add_init_script(INIT)
    ctx.route("**/*", lambda route: route.continue_() if route.request.url.startswith(ORIGIN) else route.abort())
    return ctx


def start(t):
    """開始（或繼續）一輪練習，停在題目畫面。"""
    for sel in ("#goOn", "#goAll", "#goMore"):
        if t.has(sel) and t.p.locator(sel).first.is_visible():
            t.p.locator(sel).first.click()
            t.p.wait_for_selector("#main .q")
            return True
    return False


def prep_answer(t, want=True):
    """把作答做到只剩最後一下，回傳最後要點的按鈕 selector（選擇題、回想題、心智圖題都可以）。"""
    t.p.wait_for_selector("#main .q")
    if t.has("#main .opt"):
        q = t.p.locator("#main .q").first.inner_text()
        n = t.p.locator("#main .opt").count()
        k = KNOWN.get(q)
        i = (k if want else (k + 1) % n) if k is not None else 0
        return f'#main .opt[data-i="{i}"]'
    if t.has("#reveal"):
        t.p.locator("#reveal").click()
        return f'#selfGrade button[data-g="{1 if want else 0}"]'
    blanks = t.p.locator("#main .blank")
    for i in range(blanks.count()):
        blanks.nth(i).click()
    return f'#grade button[data-g="{1 if want else 0}"]'


def learn(t):
    if t.has("#main .opt.right"):
        q = t.p.locator("#main .q").first.inner_text()
        KNOWN[q] = int(t.p.locator("#main .opt.right").first.get_attribute("data-i"))


def answer(t, want=True):
    sel = prep_answer(t, want)
    t.p.locator(sel).click()
    learn(t)
    return sel


def log_len(t):
    s = t.state()
    return len(s["log"]) if s else 0


def open_settings(t):
    t.ev("() => { const d = document.querySelector('#setBox'); if (d) d.open = true; }")


def clear_all(t):
    open_settings(t)
    t.p.locator("#resetBtn").click()
    t.p.locator("#resetYes").click()


def open_lab(t, need_tasks=True):
    """從觀念卡打開一個能用按鈕完成任務的實驗／逐句解說（#mNext 或自然站的 #gr0…），停在「先預測」。"""
    n = t.p.locator("#concepts .ccard:not(.off)").count()
    for i in range(n):
        t.p.locator("#concepts .ccard:not(.off)").nth(i).click()
        if not t.has("#cLab"):
            continue
        t.p.locator("#cLab").click()
        t.p.wait_for_selector("#labPredict button[data-g]")
        if not need_tasks or t.has("#mNext") or t.has("#gr0"):
            return True
        for sel in ("#labHome", "#labSkip"):
            if t.has(sel):
                t.p.locator(sel).click()
                break
        t.p.wait_for_selector("#concepts .ccard")
    return False


def predict(t):
    t.p.locator("#labPredict button[data-g]").first.click()
    t.p.wait_for_selector("#labTask:not([hidden])")


def task_sel(t, i):
    return "#mNext" if t.has("#mNext") else f"#gr{i}"


def n_tasks(t):
    return t.p.locator("#labTask .ck").count()


def do_task(t, i):
    t.p.locator(task_sel(t, i)).click()


def overlay_ok(snap, pending):
    want = REDO if pending else "紀錄已更新"
    return snap.get("overlay") == 1 and want in snap.get("text", "")


# ---------------------------------------------------------------- T01
def t01(browser, label, dev):
    ctx = new_ctx(browser, dev)
    try:
        t = Tab(ctx)
        start(t); answer(t)
        ok1 = t.raw() is not None and not t.has("#outdated")
        t.p.reload(); t.ready()
        quiet = t.quiet(1500)
        check(f"{label} T01 全新頁面：作答存好、重新整理後不誤判外部變更、不重載循環、沒有「紀錄已更新」",
              ok1 and quiet and not t.has("#outdated") and not t.has("#reloadNote"), {"存好": ok1, "安靜": quiet, "reloadNote": t.has("#reloadNote")})
        l0 = log_len(t)
        start(t); answer(t)
        check(f"{label} T01 重新整理後繼續作答可以存", log_len(t) == l0 + 1 and not t.errors, {"log": [l0, log_len(t)], "errors": t.errors})
    finally:
        ctx.close()


# ---------------------------------------------------------------- T02
def t02(browser, label, dev):
    ctx = new_ctx(browser, dev)
    try:
        t = Tab(ctx)
        start(t); answer(t)
        before = t.raw()
        t.ev("() => { window.__failSet = true; }")
        clear_all(t)
        failed = t.raw() == before and t.has("#retrySave")
        t.ev("() => { window.__failSet = false; }")
        t.p.locator("#retrySave").first.click()
        s = t.state()
        cleared = s is not None and s["cards"] == {} and s["log"] == []
        check(f"{label} T02 清除時寫入失敗：存檔不動、出現「再存一次」；重試後才真的清掉", failed and cleared, {"失敗時沒動": failed, "清掉": cleared})
        start(t); answer(t)
        s = t.state()
        check(f"{label} T02 清除後新答案可以存、沒有卡住、沒有失效遮罩", s and len(s["log"]) == 1 and not t.has("#outdated") and not t.errors,
              {"log": s and len(s["log"]), "errors": t.errors})
    finally:
        ctx.close()


# ---------------------------------------------------------------- T03
def t03(browser, label, dev):
    ctx = new_ctx(browser, dev)
    try:
        A, B = Tab(ctx), Tab(ctx)
        b0 = B.navs
        start(A); answer(A)
        a_card = A.state()["log"][-1]["card"]
        reloaded = B.wait_reload(b0); B.settle()
        check(f"{label} T03 A 存好後 B 先更新畫面（自動重載、顯示「紀錄已更新，請從這裡繼續」）",
              reloaded and B.has("#reloadNote") and B.raw() == A.raw(), {"重載": reloaded, "提示": B.has("#reloadNote")})
        a0 = A.navs
        start(B); answer(B)
        s = B.state()
        cards = [e["card"] for e in s["log"]]
        a_re = A.wait_reload(a0); A.settle()
        check(f"{label} T03 B 在新畫面作答後，A、B 的作答都在存檔裡；A 也跟著更新",
              len(s["log"]) == 2 and a_card in cards and a_re and A.raw() == B.raw(), {"log": cards, "A 重載": a_re})
        check(f"{label} T03 沒有 JS 錯誤", not A.errors and not B.errors, A.errors + B.errors)
    finally:
        ctx.close()


# ---------------------------------------------------------------- T04
def t04(browser, label, dev):
    ctx = new_ctx(browser, dev)
    try:
        A, B = Tab(ctx), Tab(ctx)
        a0 = A.navs
        start(B); answer(B)
        A.wait_reload(a0); A.settle()
        b0 = B.navs
        clear_all(A)
        cleared = A.state()
        reloaded = B.wait_reload(b0)
        check(f"{label} T04 A 用站內「清除全部紀錄」（存檔仍是合法 JSON）：B 失效重載",
              cleared and cleared["log"] == [] and reloaded and B.raw() == A.raw(), {"重載": reloaded})
        start(B); answer(B)
        s = B.state()
        seen = [c["seen"] for c in s["cards"].values()]
        check(f"{label} T04 舊紀錄不復活、新練習可以存", len(s["log"]) == 1 and seen == [1] and not B.errors and not A.errors,
              {"log": len(s["log"]), "seen": seen, "errors": A.errors + B.errors})
    finally:
        ctx.close()


# ---------------------------------------------------------------- T05
def t05(browser, label, dev, how):
    ctx = new_ctx(browser, dev)
    try:
        A, B = Tab(ctx), Tab(ctx)
        a0 = A.navs
        start(B); answer(B)
        A.wait_reload(a0); A.settle()
        b0 = B.navs
        A.ev("() => localStorage.removeItem(G5Core.LS_KEY)" if how == "removeItem" else "() => localStorage.clear()")
        reloaded = B.wait_reload(b0)
        quiet = B.quiet(800)
        check(f"{label} T05 別處 {how}()：B 失效重載、舊紀錄沒有被寫回去、不重播舊操作",
              reloaded and quiet and B.raw() is None and B.has("#reloadNote"), {"重載": reloaded, "raw": B.raw()})
        start(B); answer(B)
        s = B.state()
        check(f"{label} T05 {how}() 之後可以從頭存", s and len(s["log"]) == 1 and not B.errors, {"log": s and len(s["log"]), "errors": B.errors})
    finally:
        ctx.close()


# ---------------------------------------------------------------- T06
def t06(browser, label, dev):
    ctx = new_ctx(browser, dev)
    try:
        B = Tab(ctx)
        v1 = '{"v":1,"cards":{}}'
        B.ev("(v) => { localStorage.clear(); localStorage.setItem(G5Core.LS_V1, v); }", v1)
        B.p.reload(); B.ready()
        pre = B.raw() is not None
        A = Tab(ctx)
        b0 = B.navs
        A.ev("() => localStorage.removeItem(G5Core.LS_KEY)")
        reloaded = B.wait_reload(b0)
        v1_now = B.ev("localStorage.getItem(G5Core.LS_V1)")
        check(f"{label} T06 前提：第一次開頁把舊版搬進來", pre, "沒搬")
        check(f"{label} T06 新版被刪、失效重載後不搬回舊版；舊版原文不動", reloaded and B.raw() is None and v1_now == v1, {"重載": reloaded, "raw": B.raw()})
        B.p.reload(); B.ready()
        check(f"{label} T06 同一分頁再整理一次也不搬", B.raw() is None and B.ev("localStorage.getItem(G5Core.LS_V1)") == v1, B.raw())
        start(B); answer(B)
        s = B.state()
        check(f"{label} T06 新作答建立新紀錄（不是舊版搬來的）", s and len(s["log"]) == 1 and B.ev("localStorage.getItem(G5Core.LS_V1)") == v1 and not B.errors,
              {"log": s and len(s["log"]), "errors": B.errors})
    finally:
        ctx.close()


# ---------------------------------------------------------------- T07
def t07(browser, label, dev, stage):
    ctx = new_ctx(browser, dev)
    try:
        B = Tab(ctx)
        if not open_lab(B):
            check(f"{label} T07 找得到能用按鈕完成任務的實驗／解說", False, "沒有")
            return
        if stage == "predict":
            sel = "#labPredict button[data-g]"
        else:
            predict(B)
            if stage == "task":
                sel = task_sel(B, 0)
            else:
                for i in range(n_tasks(B)):
                    do_task(B, i)
                sel = "#labDone"
        B.ev("() => localStorage.removeItem(G5Core.LS_KEY)")   # 同一頁直接刪（不會有 storage 事件）
        b0 = B.navs
        snap = B.ev(SYNC_CLICK, sel)
        reloaded = B.wait_reload(b0)
        check(f"{label} T07 實驗／解說停在「{stage}」、存檔被刪後按原按鈕：停下並進入恢復流程（不是無提示的 NO_RUN）、不寫入",
              overlay_ok(snap, False) and snap.get("dw") == 0 and snap.get("raw") is None and reloaded and B.raw() is None and B.has("#reloadNote") and not B.errors,
              {"snap": snap, "重載": reloaded, "errors": B.errors})
    finally:
        ctx.close()


# ---------------------------------------------------------------- T08
def t08(browser, label, dev):
    ctx = new_ctx(browser, dev)
    try:
        B = Tab(ctx)
        if not open_lab(B) or not B.has("#mNext"):
            print(f"SKIP {label} T08 本站沒有逐句解說（#mNext）")
            return
        predict(B)
        B.p.locator("#mNext").click()
        B.ev("() => localStorage.removeItem(G5Core.LS_KEY)")
        b0 = B.navs
        snap = B.ev(SYNC_CLICK, "#mNext")
        reloaded = B.wait_reload(b0)
        check(f"{label} T08 存檔被刪後按「下一句」：舊的句數不再前進、進入恢復流程、不寫入",
              snap.get("li") == 1 and overlay_ok(snap, False) and snap.get("dw") == 0 and reloaded and B.raw() is None, {"snap": snap, "重載": reloaded})
        open_lab(B); predict(B)
        n = n_tasks(B)
        k = 0
        while B.p.locator("#mNext").is_visible() and k < 30:
            B.p.locator("#mNext").click(); k += 1
        run = B.ev(LAST_RUN)
        ok = run and run["tasksDone"] == list(range(n)) and B.p.locator("#mSteps li").count() == n and B.p.locator("#labDone").is_enabled()
        check(f"{label} T08 重新進入解說：句數與已存任務一致、可以完成", ok, {"run": run, "li": B.p.locator("#mSteps li").count(), "n": n})
        if ok:
            B.p.locator("#labDone").click()
        check(f"{label} T08 沒有 JS 錯誤", not B.errors, B.errors)
    finally:
        ctx.close()


# ---------------------------------------------------------------- T09
def end_with_wrong(ctx):
    """做出一個「結束畫面留著『再練答錯的』」的分頁：先在 S 答錯一張，把這一輪剩下的題目改成只剩那一張；
    B 打開後繼續這一輪、答對它，結束畫面就有「再練答錯的 1 張」。"""
    S = Tab(ctx)
    start(S)
    wid = None
    for _ in range(25):
        answer(S, want=False)
        s = S.state()
        if s["session"] and s["session"]["wrong"]:
            wid = s["session"]["wrong"][0]
            break
        if S.has("#next"):
            S.p.locator("#next").click()
        else:
            start(S)
    if not wid:
        S.p.close()
        return None, None
    S.ev("(id) => { const K = G5Core.LS_KEY, s = JSON.parse(localStorage.getItem(K)); s.session.queue = [id]; s.session.kinds = {}; localStorage.setItem(K, JSON.stringify(s)); }", wid)
    S.p.close()
    B = Tab(ctx)
    start(B); answer(B, want=True)
    if B.has("#next"):
        B.p.locator("#next").click()
    B.p.wait_for_selector("#goRedo")
    return B, wid


def t09(browser, label, dev, how):
    ctx = new_ctx(browser, dev)
    try:
        B, wid = end_with_wrong(ctx)
        if not B:
            check(f"{label} T09 準備：做出結束畫面的「再練答錯的」", False, "答不錯任何一題")
            return
        b0 = B.navs
        if how == "別頁清除":
            A = Tab(ctx)
            clear_all(A)
            reloaded = B.wait_reload(b0)
            ok = reloaded and not B.has("#goRedo") and B.state()["session"] is None
            detail = {"重載": reloaded, "goRedo": B.has("#goRedo")}
        else:
            B.ev("() => localStorage.removeItem(G5Core.LS_KEY)")
            snap = B.ev(SYNC_VIS) if how == "切回頁面" else B.ev(SYNC_CLICK, "#goRedo")
            reloaded = B.wait_reload(b0)
            ok = overlay_ok(snap, False) and snap.get("dw") == 0 and reloaded and B.raw() is None and not B.has("#goRedo")
            detail = {"snap": snap, "重載": reloaded}
        check(f"{label} T09 結束畫面有「再練答錯的」、{how}：不以舊 wrong 清單開新回合、不寫入、沒有 TypeError",
              ok and not B.errors, {**detail, "errors": B.errors})
    finally:
        ctx.close()


# ---------------------------------------------------------------- T10
def t10(browser, label, dev, kind):
    ctx = new_ctx(browser, dev)
    try:
        B = Tab(ctx)
        if kind == "answer":
            start(B)
            l0 = log_len(B)
            sel = prep_answer(B)
            B.ev("() => { window.__failSet = true; }")
            B.p.locator(sel).click()
            failed = B.has("#saveAgain") and log_len(B) == l0
            B.ev("() => { window.__failSet = false; }")
            B.p.locator("#saveAgain").click()
            s = B.state()
            ops = s["ops"]
            ok = failed and len(s["log"]) == l0 + 1 and len(ops) == len(set(ops)) and not B.has("#saveFail") and (B.has("#main .fb.ok") or B.has("#errq") or B.has("#next"))
            detail = {"失敗時": failed, "log": [l0, len(s["log"])]}
        else:
            if not open_lab(B):
                check(f"{label} T10 找得到實驗", False, "沒有")
                return
            predict(B)
            B.ev("() => { window.__failSet = true; }")
            do_task(B, 0)
            failed = B.has("#retrySave") and B.ev(LAST_RUN)["tasksDone"] == []
            B.ev("() => { window.__failSet = false; }")
            B.p.locator("#retrySave").first.click()
            run = B.ev(LAST_RUN)
            ok = failed and run["tasksDone"] == [0] and not B.has("#retrySave")
            detail = {"失敗時": failed, "run": run}
        w0 = B.ev("window.__w")
        B.ev("() => document.dispatchEvent(new Event('visibilitychange'))")
        again = B.ev("window.__w") - w0
        check(f"{label} T10 存檔沒變、只是寫入失敗：待存的 {kind} 恢復後重試只接受一次、畫面與存檔一致",
              ok and again <= 1 and not B.has("#outdated") and not B.errors, {**detail, "之後又寫": again, "errors": B.errors})
    finally:
        ctx.close()


# ---------------------------------------------------------------- T11
def pending_answer(B):
    start(B)
    sel = prep_answer(B)
    B.ev("() => { window.__failSet = true; }")
    B.p.locator(sel).click()
    B.ev("() => { window.__failSet = false; window.__w = 0; }")   # 之後 B 對存檔的寫入從 0 數
    return B.has("#saveAgain")


def t11_event(browser, label, dev, how):
    ctx = new_ctx(browser, dev)
    try:
        A, B = Tab(ctx), Tab(ctx)
        a0 = A.navs
        has_pending = pending_answer(B)
        A.wait_reload(a0); A.settle()   # B 的 sessionStart 存進去了，A 先跟上
        b0 = B.navs
        if how == "一般更新":
            start(A)
        elif how == "清除全部紀錄":
            clear_all(A)
        else:
            A.ev("() => localStorage.removeItem(G5Core.LS_KEY)")
        after_a = A.raw()
        B.p.wait_for_selector("#outdated")
        snap = B.ev(SNAP, "")
        quiet = B.quiet(1000)
        check(f"{label} T11 待存的作答遇到別頁「{how}」：B 停下說「這一步需要重做」、不自動重載、不偷偷補寫",
              has_pending and overlay_ok(snap, True) and quiet and snap["w"] == 0 and B.raw() == after_a, {"待存": has_pending, "snap": snap, "安靜": quiet})
        B.ev("() => { ['#saveAgain', '#retrySave'].forEach((s) => { const b = document.querySelector(s); if (b) b.click(); }); document.dispatchEvent(new Event('visibilitychange')); }")
        check(f"{label} T11 「{how}」後舊的再存一次、切回頁面都不補寫", B.ev("window.__w") == 0 and B.raw() == after_a and B.navs == b0, {"w": B.ev("window.__w")})
        B.p.locator("#loadLatest").click()
        reloaded = B.wait_reload(b0)
        s = B.state()
        check(f"{label} T11 「{how}」後按「載入最新紀錄」：舊的待存操作取消、存檔沒被動過", reloaded and B.raw() == after_a, {"重載": reloaded})
        l0 = len(s["log"]) if s else 0
        start(B); answer(B)
        check(f"{label} T11 「{how}」重載後可以重新作答", log_len(B) == l0 + 1 and not B.errors and not A.errors, {"log": [l0, log_len(B)], "errors": A.errors + B.errors})
    finally:
        ctx.close()


def t11_trigger(browser, label, dev, trigger):
    ctx = new_ctx(browser, dev)
    try:
        B = Tab(ctx)
        if not open_lab(B):
            check(f"{label} T11 找得到實驗", False, "沒有")
            return
        predict(B)
        B.ev("() => { window.__failSet = true; }")
        do_task(B, 0)
        B.ev("() => { window.__failSet = false; }")
        has_pending = B.has("#retrySave")
        B.ev("() => localStorage.removeItem(G5Core.LS_KEY)")   # 同一頁直接刪：沒有事件，由下一個操作自己發現
        b0 = B.navs
        if trigger == "retry":
            snap = B.ev(SYNC_CLICK, "#retrySave")
        elif trigger == "tick":
            snap = B.ev(SYNC_VIS)
        else:
            snap = B.ev(SYNC_CLICK, task_sel(B, 1))
        quiet = B.quiet(800)
        check(f"{label} T11 待存的 labTask、存檔被刪後觸發 {trigger}：先進衝突提示、不補寫、不回假成功、不自動重載",
              has_pending and overlay_ok(snap, True) and snap.get("dw") == 0 and snap.get("raw") is None and quiet, {"待存": has_pending, "snap": snap, "安靜": quiet})
        B.p.locator("#loadLatest").click()
        reloaded = B.wait_reload(b0)
        ok_raw = B.raw() is None
        start(B); answer(B)
        check(f"{label} T11 {trigger}：確認重載後舊 labTask 沒被重播、可以重新作答", reloaded and ok_raw and log_len(B) == 1 and not B.errors,
              {"重載": reloaded, "raw 空": ok_raw, "log": log_len(B), "errors": B.errors})
    finally:
        ctx.close()


# ---------------------------------------------------------------- T12
def t12(browser, label, dev, via):
    ctx = new_ctx(browser, dev)
    try:
        B = Tab(ctx)
        start(B)
        sel = prep_answer(B) if via == "dispatch" else None
        changed = B.ev("() => { const K = G5Core.LS_KEY, s = JSON.parse(localStorage.getItem(K)); s.settings.sound = !s.settings.sound; const t = JSON.stringify(s); localStorage.setItem(K, t); return t; }")
        b0 = B.navs
        snap = B.ev(SYNC_CLICK, sel) if via == "dispatch" else B.ev(SYNC_VIS)
        reloaded = B.wait_reload(b0)
        check(f"{label} T12 還沒收到事件、同頁程式直接改存檔後立刻 {via}：舊操作被擋、寫入數 0、存檔是別人改的那份",
              overlay_ok(snap, False) and snap.get("dw") == 0 and snap.get("raw") == changed and reloaded and B.raw() == changed and not B.errors,
              {"snap": snap, "重載": reloaded, "errors": B.errors})
    finally:
        ctx.close()


# ---------------------------------------------------------------- T13
def t13(browser, label, dev):
    ctx = new_ctx(browser, dev)
    try:
        A, B = Tab(ctx), Tab(ctx)
        a0 = A.navs
        start(A); answer(A)
        own = A.quiet(1200) and not A.has("#outdated")
        B.settle()
        a1 = A.navs
        B.ev("""() => { const K = G5Core.LS_KEY, p = K.split('.')[0];
          localStorage.setItem('g5other.v1', '{}'); localStorage.setItem(p + '.probe', '1'); localStorage.removeItem(p + '.probe');
          localStorage.setItem(K + '.x', '1'); sessionStorage.setItem('whatever', '1'); }""")
        others = A.quiet(1500) and not A.has("#outdated")
        A.ev("() => window.dispatchEvent(new StorageEvent('storage', {key: G5Core.LS_KEY, oldValue: null, newValue: '{過期的值', storageArea: localStorage}))")
        stale_ev = A.quiet(1000) and not A.has("#outdated")
        w0 = A.ev("window.__w")
        A.ev("() => document.dispatchEvent(new Event('visibilitychange'))")
        still = not A.has("#outdated") and A.quiet(500)
        check(f"{label} T13 自己的寫入不讓自己重載", own and A.navs == a0, {"own": own, "navs": A.navs - a0})
        check(f"{label} T13 別站 key、probe、本站 key 的其他欄、sessionStorage 都不誤重載", others and A.navs == a1, {"others": others})
        check(f"{label} T13 延遲送到的舊事件：以當下原文比對，不誤重載、之後照常運作", stale_ev and still and A.ev("window.__w") >= w0 and not A.errors and not B.errors,
              {"stale": stale_ev, "still": still, "errors": A.errors + B.errors})
    finally:
        ctx.close()


# ---------------------------------------------------------------- T14
def t14_broken(browser, label, dev):
    ctx = new_ctx(browser, dev)
    try:
        A, B = Tab(ctx), Tab(ctx)
        a0 = A.navs
        start(B); answer(B)
        A.wait_reload(a0); A.settle()
        b0 = B.navs
        A.ev("() => localStorage.setItem(G5Core.LS_KEY, '{壞掉')")
        reloaded = B.wait_reload(b0)
        quiet = B.quiet(1500)
        banner = "存檔讀不出來" in B.p.locator("body").inner_text()
        check(f"{label} T14 開頁後存檔變壞：B 重載一次、看得見問題、沒有重載循環、不覆寫原文",
              reloaded and quiet and banner and B.navs == b0 + 1 and B.raw() == "{壞掉", {"重載": reloaded, "安靜": quiet, "看得見": banner, "navs": B.navs - b0})
        if B.has("#goAll"):
            B.p.locator("#goAll").click()   # 壞存檔時開始一輪也存不進去，畫面留在首頁
            B.p.wait_for_timeout(500)
        if B.has("#main .q"):
            answer(B)
        check(f"{label} T14 壞存檔時作答不寫入、不當空白、不要求重載", B.raw() == "{壞掉" and not B.has("#outdated") and B.quiet(500), B.raw())
        open_settings(B)
        B.p.locator("#discard").click(); B.p.locator("#discardYes").click()
        s = B.state()
        start(B); answer(B)
        check(f"{label} T14 恢復出口：家長按「清除壞掉的存檔」後可以重新作答", s is not None and log_len(B) == 1 and not B.errors, {"log": log_len(B), "errors": B.errors})
    finally:
        ctx.close()


def t14_read(browser, label, dev):
    ctx = new_ctx(browser, dev)
    try:
        B = Tab(ctx)
        start(B)
        l0 = log_len(B)
        sel = prep_answer(B)
        B.ev("() => { window.__failGet = true; }")
        B.p.locator(sel).click()
        snap = {"overlay": B.ev("document.querySelectorAll('#outdated').length")}   # 讀取還在丟錯，不讀存檔
        quiet = B.quiet(800)
        B.ev("() => { window.__failGet = false; }")
        failed = snap["overlay"] == 0 and quiet and B.has("#saveAgain")
        B.p.locator("#saveAgain").click()
        check(f"{label} T14 讀取拋錯：不當空白、不失效重載、看得見；恢復可讀後重試只存一次",
              failed and log_len(B) == l0 + 1 and not B.has("#saveFail") and not B.errors, {"失敗時": failed, "snap": snap, "log": [l0, log_len(B)], "errors": B.errors})
    finally:
        ctx.close()


# ---------------------------------------------------------------- T15
def t15_pending(browser, label, dev):
    ctx = new_ctx(browser, dev)
    try:
        A, B = Tab(ctx), Tab(ctx)
        a0 = A.navs
        has_pending = pending_answer(B)
        A.wait_reload(a0); A.settle()
        b0 = B.navs
        start(A)
        B.p.wait_for_selector("#outdated")
        B.ev("""() => { for (let i = 0; i < 5; i++) ['#saveAgain', '#retrySave', '#main .opt', '#goAll', '#goOn'].forEach((s) => { const b = document.querySelector(s); if (b) b.click(); });
          if (window.G5Outdated) { window.G5Outdated(); window.G5Outdated(); }
          document.dispatchEvent(new Event('visibilitychange')); }""")
        snap = B.ev(SNAP, "")
        quiet = B.quiet(1000)
        check(f"{label} T15 已失效（有待存）：連點舊按鈕、同步 onReplaced 同時抵達都不寫入、只有一個遮罩、不重載",
              has_pending and snap["overlay"] == 1 and snap["w"] == 0 and quiet, {"snap": snap, "安靜": quiet})
        A.ev("() => { const K = G5Core.LS_KEY, s = JSON.parse(localStorage.getItem(K)); s.settings.sound = !s.settings.sound; localStorage.setItem(K, JSON.stringify(s)); }")
        latest = A.raw()
        B.p.locator("#loadLatest").click()
        reloaded = B.wait_reload(b0)
        quiet2 = B.quiet(1000)
        check(f"{label} T15 按「載入最新紀錄」只重載一次、讀到當下最新版、沒有 pageerror",
              reloaded and quiet2 and B.navs == b0 + 1 and B.raw() == latest and not B.errors and not A.errors, {"navs": B.navs - b0, "errors": A.errors + B.errors})
    finally:
        ctx.close()


def t15_burst(browser, label, dev):
    ctx = new_ctx(browser, dev)
    try:
        B = Tab(ctx)
        start(B); answer(B)
        b0 = B.navs
        B.ev("""() => { localStorage.removeItem(G5Core.LS_KEY);
          for (let i = 0; i < 3; i++) { if (window.G5Outdated) window.G5Outdated();
            window.dispatchEvent(new StorageEvent('storage', {key: G5Core.LS_KEY, storageArea: localStorage})); document.dispatchEvent(new Event('visibilitychange')); } }""")
        reloaded = B.wait_reload(b0)
        quiet = B.quiet(1500)
        check(f"{label} T15 沒有待存時同時來好幾個失效訊號：只排一次重載、不寫入、沒有 pageerror",
              reloaded and quiet and B.navs == b0 + 1 and B.raw() is None and not B.errors, {"navs": B.navs - b0, "raw": B.raw(), "errors": B.errors})
    finally:
        ctx.close()


# ---------------------------------------------------------------- 同型缺陷：逐句解說存檔失敗（社會站已修；數學、國語同法修）
def m_save_fail(browser, label, dev):
    ctx = new_ctx(browser, dev)
    try:
        B = Tab(ctx)
        if not open_lab(B) or not B.has("#mNext"):
            print(f"SKIP {label} M 本站沒有逐句解說（#mNext）")
            return
        predict(B)
        n = n_tasks(B)
        B.ev("() => { window.__failSet = true; }")
        for _ in range(2):
            B.p.locator("#mNext").click()
        shown = B.p.locator("#mSteps li").count()
        retry = B.has("#retrySave")
        B.ev("() => { window.__failSet = false; }")
        k = 0
        while B.p.locator("#mNext").is_visible() and k < 30:
            B.p.locator("#mNext").click(); k += 1
        run = B.ev(LAST_RUN)
        check(f"{label} M 逐句解說：存檔失敗時留在原句、出現「再存一次」", shown == 0 and retry, {"失敗時句數": shown, "再存一次": retry})
        check(f"{label} M 逐句解說：恢復後每一句都記到、完成鈕可按", run and run["tasksDone"] == list(range(n)) and B.p.locator("#labDone").is_enabled() and not B.errors,
              {"run": run, "n": n, "errors": B.errors})
    finally:
        ctx.close()


def m_retry_resume(browser, label, dev):
    ctx = new_ctx(browser, dev)
    try:
        B = Tab(ctx)
        if not open_lab(B) or not B.has("#mNext"):
            print(f"SKIP {label} M 本站沒有逐句解說（#mNext）")
            return
        predict(B)
        n = n_tasks(B)
        B.p.locator("#mNext").click()
        B.ev("() => { window.__failSet = true; }")
        B.p.locator("#mNext").click()
        before = B.ev(LAST_RUN)
        B.ev("() => { window.__failSet = false; }")
        B.p.locator("#retrySave").first.click()
        still = B.has("#labPredict") and B.has("#mNext")
        after = B.ev(LAST_RUN)
        check(f"{label} M 「再存一次」後留在原本的逐句解說、第二句接著出現", still and B.p.locator("#mSteps li").count() == 2 and after["tasksDone"] == [0, 1],
              {"還在": still, "li": B.p.locator("#mSteps li").count(), "run": after})
        k = 0
        while still and B.p.locator("#mNext").is_visible() and k < 30:
            B.p.locator("#mNext").click(); k += 1
        end = B.ev(LAST_RUN)
        check(f"{label} M 「再存一次」後續接同一輪做到完、完成鈕可按", still and end["id"] == before["id"] and end["tasksDone"] == list(range(n)) and B.p.locator("#labDone").is_enabled() and not B.errors,
              {"before": before, "end": end, "errors": B.errors})
    finally:
        ctx.close()


def m_last_resume(browser, label, dev):
    ctx = new_ctx(browser, dev)
    try:
        B = Tab(ctx)
        if not open_lab(B) or not B.has("#mNext"):
            print(f"SKIP {label} M 本站沒有逐句解說（#mNext）")
            return
        predict(B)
        n = n_tasks(B)
        for _ in range(n - 1):
            B.p.locator("#mNext").click()
        B.ev("() => { window.__failSet = true; }")
        B.p.locator("#mNext").click()
        failed_shown = B.p.locator("#mSteps li").count()
        B.ev("() => { window.__failSet = false; }")
        B.ev("() => document.dispatchEvent(new Event('visibilitychange'))")
        if B.p.locator("#mNext").is_visible():
            B.p.locator("#mNext").click()
        run = B.ev(LAST_RUN)
        check(f"{label} M 最後一句存檔失敗→切回分頁補存：每一句都記到、畫面句數齊全、完成鈕可按",
              failed_shown == n - 1 and run["tasksDone"] == list(range(n)) and B.p.locator("#mSteps li").count() == n and B.p.locator("#labDone").is_enabled() and not B.errors,
              {"失敗時句數": failed_shown, "run": run, "li": B.p.locator("#mSteps li").count(), "errors": B.errors})
    finally:
        ctx.close()


FLOWS = [
    ("T01", t01, ()), ("T02", t02, ()), ("T03", t03, ()), ("T04", t04, ()),
    ("T05", t05, ("removeItem",)), ("T05", t05, ("clear",)), ("T06", t06, ()),
    ("T07", t07, ("predict",)), ("T07", t07, ("task",)), ("T07", t07, ("complete",)), ("T08", t08, ()),
    ("T09", t09, ("別頁清除",)), ("T09", t09, ("切回頁面",)), ("T09", t09, ("點舊按鈕",)),
    ("T10", t10, ("answer",)), ("T10", t10, ("labTask",)),
    ("T11", t11_event, ("一般更新",)), ("T11", t11_event, ("清除全部紀錄",)), ("T11", t11_event, ("整個刪掉",)),
    ("T11", t11_trigger, ("retry",)), ("T11", t11_trigger, ("tick",)), ("T11", t11_trigger, ("新操作",)),
    ("T12", t12, ("dispatch",)), ("T12", t12, ("tick",)), ("T13", t13, ()),
    ("T14", t14_broken, ()), ("T14", t14_read, ()), ("T15", t15_pending, ()), ("T15", t15_burst, ()),
    ("M", m_save_fail, ()), ("M", m_retry_resume, ()), ("M", m_last_resume, ()),
]


def main():
    global ORIGIN
    srv, ORIGIN = serve()
    try:
        with sync_playwright() as p:
            for name, launch, dev in (("Chromium", p.chromium, {"viewport": {"width": 1280, "height": 900}}), ("WebKit", p.webkit, p.devices["iPad (gen 7)"])):
                if name not in BROWSERS:
                    continue
                br = launch.launch()
                for tag, fn, args in FLOWS:
                    if ONLY and tag not in ONLY:
                        continue
                    label = f"{name} {'/'.join(args) if args else ''}".strip()
                    try:
                        fn(br, label, dev, *args)
                    except Exception as e:   # 一條流程出錯不擋後面的
                        check(f"{label} {tag} 流程沒有例外", False, f"{type(e).__name__}: {str(e)[:300]}")
                        traceback.print_exc(limit=2)
                br.close()
    finally:
        srv.shutdown()
    bad = [r for r in RESULTS if not r[1]]
    print(f"\n{len(RESULTS) - len(bad)}/{len(RESULTS)} PASS")
    sys.exit(1 if bad else 0)


if __name__ == "__main__":
    main()
