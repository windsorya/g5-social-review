#!/opt/homebrew/opt/python@3.12/bin/python3.12
"""存檔在頁面開著時被別處改掉／刪掉——端到端驗收（設計 g5-sci-review/docs/design-external-change-codex-20261013.md 方案 A，矩陣標 E 的 T01–T15）。

四個同型站（自然、數學、國語、社會）這個檔逐字相同：存檔 key 一律從頁面上的 G5Core.LS_KEY 取，不寫死站名（自然站專屬的舊版 key 只在 is_sci 流程用）；
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
INIT = """(() => { const S = Storage.prototype, set = S.setItem, get = S.getItem, rm = S.removeItem; window.__w = 0; window.__keys = [];
  window.__rawGet = (k) => get.call(window.localStorage, k);   // 測試自己讀存檔用：不受 __failGet 影響、不記進 __keys
  S.setItem = function (k, v) {
    if (this === window.localStorage) {
      window.__keys.push(String(k));
      if (window.__failSet) throw new DOMException('QuotaExceededError', 'QuotaExceededError');
      // 定位注入（補充設計：以操作＋key＋第幾次定位）：本站存檔先放行 __failSetV 次，下一次寫入失敗一次
      if (window.G5Core && k === window.G5Core.LS_KEY && typeof window.__failSetV === 'number' && window.__failSetV >= 0) { if (window.__failSetV-- === 0) throw new DOMException('QuotaExceededError', 'QuotaExceededError'); }
      if (window.G5Core && k === window.G5Core.LS_KEY) window.__w++;
    }
    return set.call(this, k, v); };
  S.getItem = function (k) { if (this === window.localStorage) { window.__keys.push(String(k)); if (window.__failGet) throw new DOMException('SecurityError', 'SecurityError');
      if (window.G5Core && k === window.G5Core.LS_KEY && typeof window.__failGetV === 'number' && window.__failGetV >= 0) { if (window.__failGetV-- === 0) throw new DOMException('SecurityError', 'SecurityError'); } }
    return get.call(this, k); };
  S.removeItem = function (k) { if (this === window.localStorage) { window.__keys.push(String(k)); if (window.__failRm) throw new DOMException('SecurityError', 'SecurityError'); } return rm.call(this, k); };
  const ss = S.setItem; S.setItem = function (k, v) { if (window.__failSession && this === window.sessionStorage) throw new DOMException('QuotaExceededError', 'QuotaExceededError'); return ss.call(this, k, v); };
  const raf = window.requestAnimationFrame; window.__raf = 0; window.requestAnimationFrame = function (f) { window.__raf++; return raf.call(window, f); };
  // 跨重載的故障旗標：測試先在分頁暫存寫 __e2e＝{"__failSet":true,…}，下一次載入「頁面程式執行前」就生效（量開頁當下的行為）
  try { Object.assign(window, JSON.parse(get.call(window.sessionStorage, '__e2e') || '{}')); } catch (e) { /* 沒有就算了 */ }
})();"""

SNAP = """(sel) => { const K = G5Core.LS_KEY, o = document.querySelector('#outdated');
  return {overlay: document.querySelectorAll('#outdated').length, text: o ? o.textContent : '', w: window.__w, raw: window.__rawGet(K), read: document.querySelectorAll('#readNote').length,
          li: document.querySelectorAll('#mSteps li').length}; }"""
# 同一個 JS 工作裡：先量、點、再量（重載排在 setTimeout 0，之後才發生）
SYNC_CLICK = """(sel) => { const K = G5Core.LS_KEY, w0 = window.__w, b = document.querySelector(sel);
  if (!b) return {missing: sel}; b.click(); const o = document.querySelector('#outdated');
  return {overlay: document.querySelectorAll('#outdated').length, text: o ? o.textContent : '', dw: window.__w - w0, raw: window.__rawGet(K), read: document.querySelectorAll('#readNote').length,
          li: document.querySelectorAll('#mSteps li').length}; }"""
SYNC_VIS = """() => { const K = G5Core.LS_KEY, w0 = window.__w; document.dispatchEvent(new Event('visibilitychange'));
  const o = document.querySelector('#outdated');
  return {overlay: document.querySelectorAll('#outdated').length, text: o ? o.textContent : '', dw: window.__w - w0, raw: window.__rawGet(K),
          read: document.querySelectorAll('#readNote').length, li: document.querySelectorAll('#mSteps li').length}; }"""
LAST_RUN = """() => { const s = JSON.parse(window.__rawGet(G5Core.LS_KEY) || 'null'); if (!s) return null;
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

    def __init__(self, ctx, clock=None):
        self.p = ctx.new_page()
        self.errors, self.navs = [], 0
        self.p.on("pageerror", lambda e: self.errors.append(str(e)))
        self.p.on("framenavigated", self._nav)
        if clock:
            self.p.clock.install(time=clock)   # 跨日流程用：頁面時鐘可控
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

    def raw(self, key=None):
        return self.ev("(k) => window.__rawGet(k || G5Core.LS_KEY)", key or "")

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


# ---------------------------------------------------------------- 第 2 輪（Codex 審 812ca9b／04f1e26／889660d／c10c0f9）
def t08b(browser, label, dev):
    """已補存的那一步（設定操作順便補存、句數還沒前進），同頁刪檔後按「下一句／下一步」：不得前進。"""
    ctx = new_ctx(browser, dev)
    try:
        B = Tab(ctx)
        if not open_lab(B) or not B.has("#mNext"):
            print(f"SKIP {label} T08b 本站沒有逐句解說（#mNext）")
            return
        predict(B)
        B.ev("() => { window.__failSet = true; }")
        B.p.locator("#mNext").click()
        B.ev("() => { window.__failSet = false; }")
        B.ev("() => { const s = document.querySelector('#snd'); s.value = s.value === 'off' ? '0' : 'off'; s.dispatchEvent(new Event('change')); }")
        run = B.ev(LAST_RUN)
        pre = run and run["tasksDone"] == [0] and B.p.locator("#mSteps li").count() == 0
        B.ev("() => localStorage.removeItem(G5Core.LS_KEY)")
        b0 = B.navs
        snap = B.ev(SYNC_CLICK, "#mNext")
        reloaded = B.wait_reload(b0)
        check(f"{label} T08b 前提：設定操作補存了第一步、畫面句數仍是 0", pre, {"run": run})
        check(f"{label} T08b 已補存的一步、同頁刪檔後按下一句：不前進、進入恢復流程、不寫入",
              snap.get("li") == 0 and overlay_ok(snap, False) and snap.get("dw") == 0 and reloaded and B.raw() is None and not B.errors,
              {"snap": snap, "重載": reloaded, "errors": B.errors})
    finally:
        ctx.close()


def t15_anim(browser, label, dev):
    """自然站溶解實驗：待存的一步遇到同頁刪檔，失效後動畫不再被同一個按鈕重新啟動。"""
    ctx = new_ctx(browser, dev)
    try:
        B = Tab(ctx)
        # 溶解實驗在第三單元（預設關閉）：先在設定裡打開第三單元，再從觀念卡逐一找；沒有這個實驗的站略過
        B.ev("() => { const u = document.querySelector('#u3'); if (u && !u.checked) { u.checked = true; u.dispatchEvent(new Event('change')); } }")
        found = False
        n = B.p.locator("#concepts .ccard:not(.off)").count()
        for i in range(n):
            B.p.locator("#concepts .ccard:not(.off)").nth(i).click()
            if B.has("#cLab"):
                B.p.locator("#cLab").click()
                B.p.wait_for_selector("#labPredict button[data-g]")
                if B.has("#dsSalt"):
                    found = True
                    break
                for sel in ("#labHome", "#labSkip"):
                    if B.has(sel):
                        B.p.locator(sel).click()
                        break
            B.p.wait_for_selector("#concepts .ccard")
        if not found:
            print(f"SKIP {label} T15 動畫：本站沒有溶解實驗")
            return
        predict(B)
        for _ in range(5):
            B.p.locator("#dsSalt").click()
        B.ev("() => { window.__failSet = true; }")
        B.p.locator("#dsSalt").click()          # 第 6 匙溶不下：任務寫入失敗＝待存
        B.ev("() => { window.__failSet = false; }")
        B.ev("() => localStorage.removeItem(G5Core.LS_KEY)")
        B.p.locator("#dsSalt").click()          # 再加一匙：偵測失效
        B.p.wait_for_timeout(100)
        r0 = B.ev("window.__raf")
        B.p.wait_for_timeout(600)
        r1 = B.ev("window.__raf")
        ov = B.ev("document.querySelectorAll('#outdated').length")
        check(f"{label} T15 失效後動畫停住、不被同一個按鈕重新啟動", ov == 1 and r1 == r0 and not B.errors, {"遮罩": ov, "raf": [r0, r1], "errors": B.errors})
    finally:
        ctx.close()


# ---------------------------------------------------------------- 舊版紀錄（設計 task-mv6srlue-pujdyl：S0／S1／S2／S3）
# 站別能力不同：自然站（g5sci.v3）有真的舊版 O＝g5sci.v1，封存 A＝g5sci.v1.archived；數學、國語、社會沒有舊版（S0）。
# 用 LS_KEY 認站（不用 LS_V1：舊碼三站的 LS_V1 是假 key）。站別專屬流程在別站印 SKIP。
O_KEY, A_KEY = "g5sci.v1", "g5sci.v1.archived"
V1 = '{"v":1,"cards":{},"unit3":true}'   # 恢復後 settings.unit3＝true（空白新版是 false），看得出是不是真的從舊版恢復
READ_TXT = "暫時讀不到紀錄，先停在這裡，請再試一次"   # 補充設計 C1 文案


def is_sci(t):
    return t.key() == "g5sci.v3"


def seed(t, kv, arm=None):
    """清空本站存檔、放入指定 key，重新整理；arm＝下一次載入前就生效的故障旗標（經分頁暫存帶過重載）。"""
    t.ev("(a) => { window.__failSet = window.__failGet = window.__failRm = window.__failSession = false; localStorage.clear(); sessionStorage.removeItem('__e2e'); if (a.arm) sessionStorage.setItem('__e2e', JSON.stringify(a.arm));"
         " Object.keys(a.kv).forEach((k) => localStorage.setItem(k, a.kv[k])); }", {"kv": kv, "arm": arm or {}})
    t.p.reload(); t.ready()
    t.ev("() => sessionStorage.removeItem('__e2e')")   # 只影響剛才那一次載入


def choose(t, which):
    """家長按「恢復舊版紀錄」或「從頭開始」，再按確定（不能一按就生效）。"""
    t.p.locator("#legacyRestore" if which == "restore" else "#legacyFresh").click()
    t.p.locator("#legacyYes").click()


def t06(browser, label, dev):
    ctx = new_ctx(browser, dev)
    try:
        B = Tab(ctx)
        if not is_sci(B):
            print(f"SKIP {label} T06 本站沒有舊版存檔（設計 S0；改由 T17 驗不碰舊版 key）")
            return
        seed(B, {O_KEY: V1})
        ask = B.has("#legacyBox") and B.raw() is None and B.ev("window.__w") == 0 and B.has("#legacyRestore") and B.has("#legacyFresh")
        check(f"{label} T06 只剩舊版：不自動搬、顯示家長選擇「恢復舊版紀錄／從頭開始」", ask, {"box": B.has("#legacyBox"), "raw": B.raw()})
        B.p.locator("#legacyRestore").click()
        asked = B.raw() is None and B.has("#legacyYes")
        B.p.locator("#legacyYes").click()
        s = B.state()
        done = asked and s is not None and s["settings"]["unit3"] is True and B.raw(O_KEY) is None and B.raw(A_KEY) == V1 and not B.has("#legacyBox")
        check(f"{label} T06 按「恢復」要再確認一次；確定後 V 建好、O 原文封存進 A、O 刪除", done, {"asked": asked, "O": B.raw(O_KEY), "A": B.raw(A_KEY), "s": s and s["settings"]})
        A = Tab(ctx)
        b0 = B.navs
        A.ev("() => localStorage.removeItem(G5Core.LS_KEY)")
        reloaded = B.wait_reload(b0)
        after = B.raw() is None and B.raw(O_KEY) is None and B.raw(A_KEY) == V1 and not B.has("#legacyBox")
        check(f"{label} T06（修訂）完成封存後刪 V、失效重載：V 不補回、O 不存在、A 原文完整、不再問", reloaded and after, {"重載": reloaded, "raw": B.raw(), "A": B.raw(A_KEY)})
        B.p.reload(); B.ready()
        check(f"{label} T06 同一分頁再整理一次也不補回", B.raw() is None and B.raw(A_KEY) == V1, B.raw())
        start(B); answer(B)
        s = B.state()
        check(f"{label} T06 新作答建立新紀錄（不是舊版恢復來的）", s and len(s["log"]) == 1 and s["settings"]["unit3"] is False and B.raw(A_KEY) == V1 and not B.errors and not A.errors,
              {"log": s and len(s["log"]), "errors": A.errors + B.errors})
    finally:
        ctx.close()


def t17(browser, label, dev):
    """三站：舊版／標記 key 放好合法 v1，頁面從載入到作答完全不碰它們（也不碰字串 "null"）。"""
    ctx = new_ctx(browser, dev)
    try:
        B = Tab(ctx)
        if is_sci(B):
            print(f"SKIP {label} T17 自然站有舊版存檔（改驗 S1／S2）")
            return
        K = B.key(); pre = K.split(".")[0]
        legacy = [k for k in (pre + ".none", pre + ".v1", K + ".fromV1", K + ".noMigrate", "null") if k != K]
        kv = {k: ("1" if k.endswith((".fromV1", ".noMigrate")) else '{"v":1,"cards":{}}') for k in legacy}
        seed(B, kv)
        start(B); answer(B)
        B.ev("() => document.dispatchEvent(new Event('visibilitychange'))")
        touched = B.ev("(ks) => window.__keys.filter((k) => ks.indexOf(k) >= 0)", legacy)
        same = all(B.raw(k) == v for k, v in kv.items())
        s = B.state()
        check(f"{label} T17 三站：舊版與標記 key 從載入到作答一次都沒被讀寫（含 \"null\"）、原值不動、不搬移、照常存現行紀錄",
              touched == [] and same and s and len(s["log"]) == 1 and not B.has("#legacyBox") and not B.errors,
              {"碰到": touched, "原值不動": same, "log": s and len(s["log"]), "errors": B.errors})
    finally:
        ctx.close()


def t18(browser, label, dev):
    """自然站：封存完成後，分頁暫存寫不進（或連本機存檔也寫不進）時刪 V、重載：V 不補回、O 不存在、A 保留、零寫入。"""
    for both in (False, True):
        ctx = new_ctx(browser, dev)
        try:
            B = Tab(ctx)
            if not is_sci(B):
                print(f"SKIP {label} T18 本站沒有舊版存檔（設計 S0）")
                return
            seed(B, {O_KEY: V1}); choose(B, "restore")
            pre = B.raw() is not None and B.raw(O_KEY) is None and B.raw(A_KEY) == V1
            B.ev("(b) => { window.__failSession = true; if (b) window.__failSet = true; }", both)
            b0 = B.navs
            B.ev("() => localStorage.removeItem(G5Core.LS_KEY)")
            B.ev("() => document.dispatchEvent(new Event('visibilitychange'))")
            reloaded = B.wait_reload(b0)
            how = "分頁暫存與本機存檔都寫不進" if both else "分頁暫存寫不進"
            check(f"{label} T18 封存完成後{how}、刪 V 重載：V 不補回、O 不存在、A 保留、重載後零寫入",
                  pre and reloaded and B.raw() is None and B.raw(O_KEY) is None and B.raw(A_KEY) == V1 and B.ev("window.__w") == 0 and not B.has("#legacyBox") and not B.errors,
                  {"pre": pre, "重載": reloaded, "raw": B.raw(), "A": B.raw(A_KEY), "w": B.ev("window.__w"), "errors": B.errors})
        finally:
            ctx.close()


def t19(browser, label, dev):
    ctx = new_ctx(browser, dev)
    try:
        B = Tab(ctx)
        if not is_sci(B):
            print(f"SKIP {label} T19 本站沒有舊版存檔（設計 S0）")
            return
        v3 = B.ev("JSON.stringify(G5Core.blankState())")
        seed(B, {"g5sci.v3": v3, O_KEY: V1}, {"__failSet": True})
        note = B.has("#archiveNote") and "封存未完成" in B.p.locator("#archiveNote").inner_text()
        kept = B.raw() == v3 and B.raw(O_KEY) == V1 and B.raw(A_KEY) is None
        check(f"{label} T19 舊安裝 V、O 並存、封存寫不進：V 照用、O 保留、顯示「進度已存，舊版封存未完成」", note and kept, {"note": note, "kept": kept})
        B.ev("() => localStorage.removeItem(G5Core.LS_KEY)")
        B.p.reload(); B.ready()
        check(f"{label} T19 接著外部刪 V、強制重開：V 不重建、O 保留、顯示家長選擇（不呈現舊進度已恢復）",
              B.raw() is None and B.raw(O_KEY) == V1 and B.has("#legacyBox") and B.ev("window.__w") == 0 and not B.errors,
              {"raw": B.raw(), "O": B.raw(O_KEY), "box": B.has("#legacyBox"), "errors": B.errors})
    finally:
        ctx.close()


def t24(browser, label, dev):
    ctx = new_ctx(browser, dev)
    try:
        B = Tab(ctx)
        if not is_sci(B):
            print(f"SKIP {label} T24 本站沒有舊版存檔（設計 S0）")
            return
        other = '{"v":1,"cards":{}}'
        seed(B, {O_KEY: V1, A_KEY: other})
        box = B.p.locator("#legacyBox").inner_text() if B.has("#legacyBox") else ""
        check(f"{label} T24 A 與 O 不同：顯示封存衝突、沒有「恢復」也沒有「從頭開始」（補充設計 C4）、三個 key 都不動",
              "不一樣" in box and not B.has("#legacyRestore") and not B.has("#legacyFresh") and B.raw() is None and B.raw(O_KEY) == V1 and B.raw(A_KEY) == other and B.ev("window.__w") == 0 and not B.errors,
              {"box": box[:120], "O": B.raw(O_KEY), "A": B.raw(A_KEY), "errors": B.errors})
    finally:
        ctx.close()


def t26(browser, label, dev):
    ctx = new_ctx(browser, dev)
    try:
        B = Tab(ctx)
        if not is_sci(B):
            print(f"SKIP {label} T26 本站沒有舊版存檔（設計 S0）")
            return
        seed(B, {O_KEY: V1})
        B.p.reload(); B.ready()
        quiet = B.raw() is None and B.raw(O_KEY) == V1 and B.ev("window.__w") == 0 and B.has("#legacyBox")
        choose(B, "fresh")
        s = B.state()
        fresh = s is not None and s["settings"]["unit3"] is False and s["log"] == [] and B.raw(O_KEY) is None and B.raw(A_KEY) == V1
        check(f"{label} T26 只剩 O：單純重載兩次零寫入；按「從頭開始」才建立空白 V，O 原文封存進 A", quiet and fresh, {"quiet": quiet, "fresh": fresh})
        seed(B, {A_KEY: V1})
        B.p.reload(); B.ready()
        open_settings(B)
        quiet = B.raw() is None and B.ev("window.__w") == 0 and not B.has("#legacyBox") and B.has("#restoreArchived")
        B.p.locator("#restoreArchived").click(); B.p.locator("#restoreArchivedYes").click()
        s = B.state()
        ok = s is not None and s["settings"]["unit3"] is True and B.raw(A_KEY) == V1
        check(f"{label} T26 只剩 A：重載零寫入、不擋作答；家長在設定按「恢復封存的舊版紀錄」並確定才建立 V，A 不變", quiet and ok and not B.errors,
              {"quiet": quiet, "s": s and s["settings"], "errors": B.errors})
    finally:
        ctx.close()


def t27(browser, label, dev, how):
    """三站逐句解說：已補存的那一步，讀存檔拋錯時按「下一句」：不前進、顯示「暫時讀不到」、不寫、不重載；恢復後未變可續接、已刪則失效。"""
    ctx = new_ctx(browser, dev)
    try:
        B = Tab(ctx)
        if not open_lab(B) or not B.has("#mNext"):
            print(f"SKIP {label} T27 本站沒有逐句解說（#mNext）")
            return
        predict(B)
        B.ev("() => { window.__failSet = true; }")
        B.p.locator("#mNext").click()
        B.ev("() => { window.__failSet = false; }")
        B.ev("() => { const s = document.querySelector('#snd'); s.value = s.value === 'off' ? '0' : 'off'; s.dispatchEvent(new Event('change')); }")
        run = B.ev(LAST_RUN)
        pre = run and run["tasksDone"] == [0] and B.p.locator("#mSteps li").count() == 0
        if how == "已刪":
            B.ev("() => localStorage.removeItem(G5Core.LS_KEY)")
        raw0 = B.raw()
        B.ev("() => { window.__failGet = true; }")
        b0 = B.navs
        snap = B.ev(SYNC_CLICK, "#mNext")
        quiet = B.quiet(800)
        txt = B.p.locator("#readNote").inner_text() if B.has("#readNote") else ""
        check(f"{label} T27 V {how}、讀取拋錯時按下一句：句數不增、零寫入、不失效、看得到「{READ_TXT}」",
              pre and snap.get("li") == 0 and snap.get("dw") == 0 and snap.get("overlay") == 0 and quiet and READ_TXT in txt and B.raw() == raw0,
              {"pre": pre, "snap": snap, "安靜": quiet, "提示": txt})
        B.ev("() => { window.__failGet = false; }")
        snap2 = B.ev(SYNC_CLICK, "#mNext")
        if how == "未變":
            ok = snap2.get("li") == 1 and snap2.get("overlay") == 0 and snap2.get("read") == 0
        else:
            ok = snap2.get("li") == 0 and overlay_ok(snap2, False) and snap2.get("dw") == 0 and B.wait_reload(b0) and B.raw() is None
        check(f"{label} T27 V {how}、讀取恢復後再按：{'續接下一句' if how == '未變' else '進入失效流程、不寫入'}", ok and not B.errors, {"snap": snap2, "errors": B.errors})
    finally:
        ctx.close()


def t28(browser, label, dev):
    """四站：讀取失敗時，切回分頁／再存一次／補存後原畫面重繪都不得回成功或推動畫面；恢復後重查。"""
    ctx = new_ctx(browser, dev)
    try:
        B = Tab(ctx)
        start(B); answer(B)
        raw0 = B.raw()
        B.ev("() => { window.__failGet = true; }")
        b0 = B.navs
        snap = B.ev(SYNC_VIS)
        quiet = B.quiet(800)
        txt = B.p.locator("#readNote").inner_text() if B.has("#readNote") else ""
        B.ev("() => { window.__failGet = false; }")
        snap2 = B.ev(SYNC_VIS)
        check(f"{label} T28 沒有待存時切回分頁讀不到：不失效、不重載、零寫入、看得到「{READ_TXT}」；恢復後切回提示消失",
              snap.get("overlay") == 0 and snap.get("dw") == 0 and quiet and READ_TXT in txt and B.raw() == raw0 and snap2.get("read") == 0 and snap2.get("overlay") == 0 and B.navs == b0,
              {"snap": snap, "安靜": quiet, "提示": txt, "snap2": snap2})
        # 再存一次：作答寫入失敗 → 讀取也壞了 → 按「再存一次」不得公布回饋；恢復後只存一次（換一個新分頁，從題目畫面開始）
        B.p.close()
        B = Tab(ctx)
        start(B)
        l0 = log_len(B)
        sel = prep_answer(B)
        B.ev("() => { window.__failSet = true; }")
        B.p.locator(sel).click()
        B.ev("() => { window.__failSet = false; window.__failGet = true; }")
        snap = B.ev(SYNC_CLICK, "#saveAgain")
        still = B.has("#saveFail") and log_len(B) == l0
        B.ev("() => { window.__failGet = false; }")
        B.p.locator("#saveAgain").click()
        check(f"{label} T28 讀不到時按「再存一次」：不公布、不寫入；恢復後只存一次",
              snap.get("dw") == 0 and snap.get("overlay") == 0 and still and log_len(B) == l0 + 1 and not B.has("#saveFail") and not B.errors,
              {"snap": snap, "still": still, "log": [l0, log_len(B)], "errors": B.errors})
        # 逐句解說最後一步存不進 → 讀取也壞 → 切回分頁：不補存、句數不增（labRefresh 也要先查）；恢復後切回才補上
        B.p.close()
        B = Tab(ctx)
        if not open_lab(B) or not B.has("#mNext"):
            print(f"SKIP {label} T28 labRefresh：本站沒有逐句解說（#mNext）")
            return
        predict(B)
        n = n_tasks(B)
        for _ in range(n - 1):
            B.p.locator("#mNext").click()
        B.ev("() => { window.__failSet = true; }")
        B.p.locator("#mNext").click()
        B.ev("() => { window.__failSet = false; window.__failGet = true; }")
        snap = B.ev(SYNC_VIS)
        B.ev("() => { window.__failGet = false; }")
        snap2 = B.ev(SYNC_VIS)
        run = B.ev(LAST_RUN)
        check(f"{label} T28 逐句解說讀不到時切回分頁：句數不增、零寫入；恢復後切回才補存並補上最後一句",
              snap.get("li") == n - 1 and snap.get("dw") == 0 and snap.get("read") == 1 and snap2.get("li") == n and run["tasksDone"] == list(range(n)) and not B.errors,
              {"snap": snap, "snap2": snap2, "run": run, "errors": B.errors})
    finally:
        ctx.close()


def t29(browser, label, dev):
    """自然站 makeStorage：probe 寫不進、只剩 A 時，不能換成看不到 A 的記憶體空白模式；讀取拋錯時顯示讀不到。"""
    ctx = new_ctx(browser, dev)
    try:
        B = Tab(ctx)
        if not is_sci(B):
            print(f"SKIP {label} T29 本站沒有舊版存檔（設計 S0）")
            return
        seed(B, {A_KEY: V1}, {"__failSet": True})
        ban = B.p.locator("#banners").inner_text()
        open_settings(B)
        check(f"{label} T29 probe 寫不進、只剩 A：不落入記憶體空白模式（A 還看得到、有恢復入口）",
              "存不了" not in ban and B.has("#restoreArchived") and B.raw(A_KEY) == V1 and not B.errors, {"banner": ban[:120], "entry": B.has("#restoreArchived")})
        seed(B, {A_KEY: V1}, {"__failSet": True, "__failGet": True})
        ban = B.p.locator("#banners").inner_text()
        check(f"{label} T29 probe 寫不進、讀取也拋錯：顯示讀不到（READ），不是「存不了」", "讀不到這台裝置的作答紀錄" in ban and "存不了" not in ban and not B.errors, ban[:160])
    finally:
        ctx.close()


# ---------------------------------------------------------------- 補充設計 task-mv6ujb6v-51m58n（單一存檔狀態＋resume）；R 編號＝補充矩陣 Txx
FB = "() => !!(document.querySelector('#main .fb.ok') || document.querySelector('#errq') || document.querySelector('#next'))"
CLEAN = "() => { const t = document.querySelector('#banners').innerText; return !/沒有存|讀不到|還沒存/.test(t) && !document.querySelector('#saveFail'); }"


def r01(browser, label, dev):
    """R01：答案寫入失敗 → 切回分頁時讀不到 → 解除 → 再存一次：只存一次、同輪公布回饋、提示一起更新（不殘留「沒有存」）。"""
    ctx = new_ctx(browser, dev)
    try:
        B = Tab(ctx)
        start(B); l0 = log_len(B); sel = prep_answer(B)
        B.ev("() => { window.__failSet = true; }"); B.p.locator(sel).click(); B.ev("() => { window.__failSet = false; window.__failGet = true; }")
        snap = B.ev(SYNC_VIS)
        mid = B.has("#saveFail") and not B.ev(FB) and snap.get("read") == 1 and snap.get("dw") == 0
        B.ev("() => { window.__failGet = false; }")
        B.p.locator("#saveAgain").click()
        check(f"{label} R01 寫失敗→切回分頁讀不到→解除→再存一次：只存一次、公布回饋、READ／沒存提示一起清掉",
              mid and log_len(B) == l0 + 1 and B.ev(FB) and B.ev(CLEAN) and not B.errors, {"mid": mid, "snap": snap, "log": [l0, log_len(B)], "clean": B.ev(CLEAN), "errors": B.errors})
    finally:
        ctx.close()


def r02(browser, label, dev):
    """R02：作答時就讀不到 → 讀取仍失敗時切回分頁 → 恢復 → 再存一次：不以空白覆蓋、留原題、同 id 只接受一次、提示一致。"""
    ctx = new_ctx(browser, dev)
    try:
        B = Tab(ctx)
        start(B); l0 = log_len(B); raw0 = B.raw(); sel = prep_answer(B)
        B.ev("() => { window.__failGet = true; }"); B.p.locator(sel).click()
        snap = B.ev(SYNC_VIS)
        held = B.has("#saveFail") and not B.ev(FB) and snap.get("dw") == 0 and B.raw() == raw0 and READ_TXT in B.p.locator("#banners").inner_text()
        B.ev("() => { window.__failGet = false; }")
        B.p.locator("#saveAgain").click()
        s = B.state(); ops = s["ops"]
        check(f"{label} R02 作答就讀不到→切回分頁仍讀不到→恢復→再存一次：失敗時留原題、恢復後同 id 只接受一次、提示一致",
              held and log_len(B) == l0 + 1 and len(ops) == len(set(ops)) and B.ev(FB) and B.ev(CLEAN) and not B.errors,
              {"held": held, "log": [l0, log_len(B)], "clean": B.ev(CLEAN), "errors": B.errors})
    finally:
        ctx.close()


def r03(browser, label, dev):
    """R03：答案寫失敗 → 設定操作補存了答案、但設定自己寫失敗 → 讀不到時按再存一次：不移除失敗提示、不公布答案；恢復後才公布。"""
    ctx = new_ctx(browser, dev)
    try:
        B = Tab(ctx)
        start(B); l0 = log_len(B); sel = prep_answer(B)
        B.ev("() => { window.__failSet = true; }"); B.p.locator(sel).click(); B.ev("() => { window.__failSet = false; window.__failSetV = 1; }")
        B.ev("() => { const s = document.querySelector('#snd'); s.value = s.value === 'off' ? '0' : 'off'; s.dispatchEvent(new Event('change')); }")
        pre = log_len(B) == l0 + 1 and B.has("#saveFail")
        B.ev("() => { window.__failGet = true; }")
        snap = B.ev(SYNC_CLICK, "#saveAgain")
        held = B.has("#saveFail") and not B.ev(FB) and snap.get("dw") == 0
        B.ev("() => { window.__failGet = false; }")
        B.p.locator("#saveAgain").click()
        check(f"{label} R03 其他操作待存＋讀不到時按再存一次：不公布答案、零寫入；恢復後才公布、答案只記一次",
              pre and held and B.ev(FB) and log_len(B) == l0 + 1 and B.ev(CLEAN) and not B.errors,
              {"pre": pre, "held": held, "snap": snap, "log": [l0, log_len(B)], "errors": B.errors})
    finally:
        ctx.close()


def r04(browser, label, dev, when):
    """R04：實驗／解說進行中切回分頁，前置檢查成功、tick 讀存檔失敗（同日／跨日）：留在原畫面（lab、句數、runId 不變）、顯示讀不到。"""
    ctx = new_ctx(browser, dev)
    try:
        B = Tab(ctx, clock="2026-10-20T23:59:00+08:00" if when == "跨日" else None)
        if not open_lab(B):
            check(f"{label} R04 找得到實驗", False, "沒有"); return
        predict(B); do_task(B, 0)
        run0 = B.ev(LAST_RUN); li0 = B.p.locator("#mSteps li").count()
        if when == "跨日":
            B.p.clock.set_system_time("2026-10-21T00:00:30+08:00")
        B.ev("() => { window.__failGetV = 1; }")
        snap = B.ev(SYNC_VIS)
        still = B.has("#labPredict") and B.has("#labTask") and B.p.locator("#mSteps li").count() == li0 and B.ev(LAST_RUN) == run0
        check(f"{label} R04 {when}切回分頁、tick 讀不到：留在原實驗畫面、零寫入、看得到「{READ_TXT}」",
              still and snap.get("dw") == 0 and snap.get("read") == 1 and snap.get("overlay") == 0 and not B.errors,
              {"still": still, "snap": snap, "errors": B.errors})
        B.ev("() => document.dispatchEvent(new Event('visibilitychange'))")
        check(f"{label} R04 {when}讀取恢復後再切回：提示消失、畫面照常", B.ev("document.querySelectorAll('#readNote').length") == 0 and not B.errors, B.errors)
    finally:
        ctx.close()


def r05(browser, label, dev):
    """R05：resume 中答案補存成功、後面的 tick 讀不到：已存不回滾、這輪不公布；再按一次才公布，同一題不記兩次。"""
    ctx = new_ctx(browser, dev)
    try:
        B = Tab(ctx)
        start(B); l0 = log_len(B); sel = prep_answer(B)
        B.ev("() => { window.__failSet = true; }"); B.p.locator(sel).click(); B.ev("() => { window.__failSet = false; window.__failGetV = 2; }")
        snap = B.ev(SYNC_CLICK, "#saveAgain")
        held = log_len(B) == l0 + 1 and B.has("#saveFail") and not B.ev(FB) and snap.get("read") == 1
        B.p.locator("#saveAgain").click()
        check(f"{label} R05 補存成功但 tick 讀不到：答案已存、這輪不公布；再按一次才公布、只記一次",
              held and B.ev(FB) and log_len(B) == l0 + 1 and B.ev(CLEAN) and not B.errors, {"held": held, "snap": snap, "log": [l0, log_len(B)], "errors": B.errors})
    finally:
        ctx.close()


def r13(browser, label, dev):
    """R13（自然）：開頁只有 O，選項顯示後才出現不同的 A；按「從頭開始」：當下重驗發現衝突，不建立 V、不動 O／A，兩個選項都收起來。"""
    ctx = new_ctx(browser, dev)
    try:
        B = Tab(ctx)
        if not is_sci(B):
            print(f"SKIP {label} R13 本站沒有舊版存檔（設計 S0）"); return
        other = '{"v":1,"cards":{}}'
        seed(B, {O_KEY: V1})
        B.ev("(v) => localStorage.setItem('g5sci.v1.archived', v)", other)   # 同頁直接寫，沒有 storage 事件
        B.p.locator("#legacyFresh").click()
        if B.has("#legacyYes"):
            B.p.locator("#legacyYes").click()
        box = B.p.locator("#legacyBox").inner_text() if B.has("#legacyBox") else ""
        check(f"{label} R13 選項顯示後才出現不同的備份：按從頭開始時重驗擋下，不建 V、不動舊資料、兩個選項都收起",
              B.raw() is None and B.raw(O_KEY) == V1 and B.raw(A_KEY) == other and "不一樣" in box and not B.has("#legacyRestore") and not B.has("#legacyFresh") and not B.errors,
              {"raw": B.raw(), "box": box[:100], "errors": B.errors})
    finally:
        ctx.close()


def r14(browser, label, dev):
    """R14（自然）：先選「從頭開始」、V 寫後回讀失敗：畫面只剩「重新檢查」（不能改選恢復）；重新檢查後公布「從頭開始」，實際 V 也是空白。"""
    ctx = new_ctx(browser, dev)
    try:
        B = Tab(ctx)
        if not is_sci(B):
            print(f"SKIP {label} R14 本站沒有舊版存檔（設計 S0）"); return
        seed(B, {O_KEY: V1})
        B.p.locator("#legacyFresh").click()
        B.ev("() => { window.__failGetV = 1; }")              # 確定後：前置讀 V 放行，寫入後的回讀失敗一次
        B.p.locator("#legacyYes").click()
        box = B.p.locator("#legacyBox").inner_text() if B.has("#legacyBox") else ""
        locked = "尚未確認" in box and B.has("#legacyRecheck") and not B.has("#legacyRestore") and not B.has("#legacyFresh") and B.raw(O_KEY) == V1
        B.p.locator("#legacyRecheck").click()
        s = B.state(); note = B.p.locator("#banners").inner_text()
        check(f"{label} R14 回讀失敗：鎖定只剩重新檢查；重查後公布「從頭開始」、實際 V 是空白、O 封存",
              locked and s is not None and s["settings"]["unit3"] is False and "已從頭開始" in note and "恢復舊版紀錄；" not in note and B.raw(O_KEY) is None and B.raw(A_KEY) == V1 and not B.errors,
              {"locked": locked, "box": box[:120], "note": note[:120], "errors": B.errors})
    finally:
        ctx.close()


# ---------------------------------------------------------------- 第 3 輪（四站共同）：待存 ID 分離、tick 未完成不前進、READ 時不先標答案
def r27(browser, label, dev):
    """R27：設定寫失敗成為待存 → 作答時讀不到（核心待存仍是設定）→ 恢復後再存一次：先補存設定、再存這一題（只存一次），公布回饋、提示清掉。"""
    ctx = new_ctx(browser, dev)
    try:
        B = Tab(ctx)
        start(B); l0 = log_len(B); sel = prep_answer(B)
        snd0 = B.state()["settings"]["sound"]
        B.ev("() => { window.__failSet = true; const s = document.querySelector('#snd'); s.value = s.value === 'off' ? '0' : 'off'; s.dispatchEvent(new Event('change')); window.__failSet = false; window.__failGet = true; }")
        B.p.locator(sel).click()
        held = B.has("#saveFail") and not B.ev(FB)
        B.ev("() => { window.__failGet = false; }")
        B.p.locator("#saveAgain").click()
        s = B.state()
        check(f"{label} R27 另一筆待存＋作答讀不到→再存一次：設定與這一題都存到（這一題只一次）、公布回饋、提示清掉",
              held and log_len(B) == l0 + 1 and s["settings"]["sound"] != snd0 and B.ev(FB) and B.ev(CLEAN) and not B.errors,
              {"held": held, "log": [l0, log_len(B)], "sound": [snd0, s["settings"]["sound"]], "clean": B.ev(CLEAN), "errors": B.errors})
    finally:
        ctx.close()


def r28(browser, label, dev):
    """R28：切回分頁時 tick 寫失敗（維護沒做完）→ 恢復後按下一步／完成鈕：先補完 tick 再前進，前進後沒有殘留「沒有存」。"""
    ctx = new_ctx(browser, dev)
    try:
        B = Tab(ctx)
        if not open_lab(B):
            check(f"{label} R28 找得到實驗", False, "沒有"); return
        predict(B); n = n_tasks(B)
        B.ev("() => { window.__failSetV = 0; }"); B.ev(SYNC_VIS)
        pre = B.has("#retrySave")
        do_task(B, 0)
        run = B.ev(LAST_RUN)
        check(f"{label} R28 tick 沒做完時按下一步：先補完 tick 再存這一步、提示清掉", pre and run["tasksDone"] == [0] and not B.has("#retrySave") and not B.errors,
              {"pre": pre, "run": run, "retry": B.has("#retrySave")})
        for i in range(1, n):
            do_task(B, i)
        B.ev("() => { window.__failSetV = 0; }"); B.ev(SYNC_VIS)
        pre2 = B.has("#retrySave")
        B.p.locator("#labDone").click()
        done = not B.has("#labNav") and not B.has("#retrySave")
        check(f"{label} R28 tick 沒做完時按完成鈕：先補完 tick 再完成、提示清掉", pre2 and done and not B.errors, {"pre": pre2, "labNav": B.has("#labNav"), "retry": B.has("#retrySave"), "errors": B.errors})
    finally:
        ctx.close()


def r29(browser, label, dev):
    """R29：題目畫面切回分頁時 tick 寫失敗 → 恢復後作答：先補完 tick 再公布答案，公布時沒有殘留「沒有存」。"""
    ctx = new_ctx(browser, dev)
    try:
        B = Tab(ctx)
        start(B); l0 = log_len(B)
        B.ev("() => { window.__failSetV = 0; }"); B.ev(SYNC_VIS)
        pre = B.has("#retrySave")
        answer(B)
        check(f"{label} R29 tick 沒做完時作答：先補完 tick 再公布、提示清掉、只記一次", pre and B.ev(FB) and B.ev(CLEAN) and log_len(B) == l0 + 1 and not B.errors,
              {"pre": pre, "clean": B.ev(CLEAN), "log": [l0, log_len(B)], "errors": B.errors})
    finally:
        ctx.close()


def r30(browser, label, dev):
    """R30：讀不到時點選項：存檔確認前不標出正解／錯解；恢復後再存一次才標示。"""
    ctx = new_ctx(browser, dev)
    try:
        B = Tab(ctx)
        start(B)
        for _ in range(30):
            if B.has("#main .opt"):
                break
            answer(B)
            if B.has("#next"):
                B.p.locator("#next").click()
            else:
                start(B)
        if not B.has("#main .opt"):
            print(f"SKIP {label} R30 這一輪沒有選擇題"); return
        B.ev("() => { window.__failGet = true; }")
        B.p.locator("#main .opt").first.click()
        marked = B.ev("document.querySelectorAll('#main .opt.right, #main .opt.wrong').length")
        B.ev("() => { window.__failGet = false; }")
        B.p.locator("#saveAgain").click()
        after = B.ev("document.querySelectorAll('#main .opt.right').length")
        check(f"{label} R30 讀不到時點選項：確認存好前不標正解；存好後才標", marked == 0 and after == 1 and B.ev(FB) and not B.errors, {"未存時標了": marked, "存好後正解": after, "errors": B.errors})
    finally:
        ctx.close()


def r31(browser, label, dev):
    """R31：實驗最後一步寫入失敗 → 恢復後切回分頁：留在實驗、重繪任務、完成鈕依 tasksDone 變成可按。"""
    ctx = new_ctx(browser, dev)
    try:
        B = Tab(ctx)
        if not open_lab(B):
            check(f"{label} R31 找得到實驗", False, "沒有"); return
        predict(B); n = n_tasks(B)
        for i in range(n - 1):
            do_task(B, i)
        B.ev("() => { window.__failSet = true; }"); do_task(B, n - 1); B.ev("() => { window.__failSet = false; }")
        B.ev("() => document.dispatchEvent(new Event('visibilitychange'))")
        run = B.ev(LAST_RUN)
        ok = B.has("#labPredict") and run["tasksDone"] == list(range(n)) and B.p.locator("#labDone").is_enabled() and B.p.locator("#labTask .ck.got").count() == n
        check(f"{label} R31 實驗補存後切回分頁：留在實驗、任務全打勾、完成鈕可按", ok and not B.errors,
              {"run": run, "got": B.p.locator("#labTask .ck.got").count(), "enabled": B.has("#labDone") and B.p.locator("#labDone").is_enabled(), "errors": B.errors})
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
    ("T08", t08b, ()), ("T15", t15_anim, ()),
    ("T17", t17, ()), ("T18", t18, ()), ("T19", t19, ()), ("T24", t24, ()), ("T26", t26, ()),
    ("T27", t27, ("未變",)), ("T27", t27, ("已刪",)), ("T28", t28, ()), ("T29", t29, ()),
    ("R01", r01, ()), ("R02", r02, ()), ("R03", r03, ()), ("R04", r04, ("同日",)), ("R04", r04, ("跨日",)), ("R05", r05, ()),
    ("R13", r13, ()), ("R14", r14, ()),
    ("R27", r27, ()), ("R28", r28, ()), ("R29", r29, ()), ("R30", r30, ()), ("R31", r31, ()),
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
