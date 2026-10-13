#!/opt/homebrew/opt/python@3.12/bin/python3.12
"""存檔在頁面開著時被別處改掉／刪掉——端到端驗收（設計 g5-sci-review/docs/design-external-change-codex-20261013.md 方案 A，矩陣標 E 的 T01–T15）。

四個同型站（自然、數學、國語、社會）共用這個檔（自然站縮範圍後拿掉舊版專屬流程，見 docs/design-storage-scopecut-20261014.md）：存檔 key 一律從頁面上的 G5Core.LS_KEY 取，不寫死站名（自然站專屬的舊版 key 只在 is_sci 流程用）；
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
            failed = B.has("#retrySave") and log_len(B) == l0
            B.ev("() => { window.__failSet = false; }")
            B.p.locator("#retrySave").click()
            s = B.state()
            ops = s["ops"]
            ok = failed and len(s["log"]) == l0 + 1 and len(ops) == len(set(ops)) and not B.has("#storeMask") and (B.has("#main .fb.ok") or B.has("#errq") or B.has("#next"))
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
    return B.has("#retrySave")


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
        B.ev("() => { ['#retrySave', '#retrySave'].forEach((s) => { const b = document.querySelector(s); if (b) b.click(); }); document.dispatchEvent(new Event('visibilitychange')); }")
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
            snap0 = B.ev(SYNC_CLICK, task_sel(B, 1))   # 4agent 方案 (a)：暫停中新操作被拒收——不寫、還沒失效
            assert snap0.get("dw") == 0 and snap0.get("overlay") == 0, snap0
            snap = B.ev(SYNC_CLICK, "#retrySave")
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
        B.ev("() => { const b = document.querySelector('#goAll'); if (b) b.click(); }")   # 4agent 方案 (a)：壞檔時整頁暫停；繞過遮罩直接觸發也不寫
        B.p.wait_for_timeout(500)
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
        failed = snap["overlay"] == 0 and quiet and B.has("#retrySave")
        B.p.locator("#retrySave").click()
        check(f"{label} T14 讀取拋錯：不當空白、不失效重載、看得見；恢復可讀後重試只存一次",
              failed and log_len(B) == l0 + 1 and not B.has("#storeMask") and not B.errors, {"失敗時": failed, "snap": snap, "log": [l0, log_len(B)], "errors": B.errors})
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
        B.ev("""() => { for (let i = 0; i < 5; i++) ['#retrySave', '#retrySave', '#main .opt', '#goAll', '#goOn'].forEach((s) => { const b = document.querySelector(s); if (b) b.click(); });
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
        B.p.locator("#mNext").click()
        B.ev("() => { const b = document.querySelector('#mNext'); if (b) b.click(); }")   # 暫停中再觸發一次（繞過遮罩）：不得前進
        shown = B.p.locator("#mSteps li").count()
        retry = B.has("#retrySave")
        B.ev("() => { window.__failSet = false; }")
        B.p.locator("#retrySave").click()   # 4agent 方案 (a)：恢復後按遮罩的再試一次
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
        B.ev("() => document.dispatchEvent(new Event('visibilitychange'))")   # 4agent 方案 (a)：暫停中切回分頁只檢查，不補存
        B.p.locator("#retrySave").click()                                     # 補存靠遮罩的再試一次
        if B.p.locator("#mNext").is_visible():
            B.p.locator("#mNext").click()
        run = B.ev(LAST_RUN)
        check(f"{label} M 最後一句存檔失敗→恢復後再試一次補存：每一句都記到、畫面句數齊全、完成鈕可按",
              failed_shown == n - 1 and run["tasksDone"] == list(range(n)) and B.p.locator("#mSteps li").count() == n and B.p.locator("#labDone").is_enabled() and not B.errors,
              {"失敗時句數": failed_shown, "run": run, "li": B.p.locator("#mSteps li").count(), "errors": B.errors})
    finally:
        ctx.close()


# ---------------------------------------------------------------- 第 2 輪（Codex 審 812ca9b／04f1e26／889660d／c10c0f9）
def t08b(browser, label, dev):
    """（4agent 方案 (a) 改寫）下一步存檔失敗 → 暫停；同頁刪檔後按「再試一次」：句數不增、進失效流程（這一步需要重做）、不寫入。
    舊前提「設定操作順便補存」在新契約不存在（暫停中設定被拒收），由 A01 守。"""
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
        pre = B.has("#storeMask") and B.p.locator("#mSteps li").count() == 0
        B.ev("() => localStorage.removeItem(G5Core.LS_KEY)")
        snap = B.ev(SYNC_CLICK, "#retrySave")
        check(f"{label} T08b 前提：下一步存不進去就暫停、句數仍是 0", pre, {"mask": B.has("#storeMask")})
        check(f"{label} T08b 暫停中同頁刪檔再按再試一次：不前進、進失效流程（這一步需要重做）、不寫入",
              snap.get("li") == 0 and overlay_ok(snap, True) and snap.get("dw") == 0 and B.raw() is None and not B.errors,
              {"snap": snap, "errors": B.errors})
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
        B.ev(SYNC_CLICK, "#retrySave")          # 4agent 方案 (a)：暫停中按再試一次才偵測到失效
        B.ev("() => document.querySelector('#dsSalt').click()")   # 失效後再加一匙（繞過遮罩）
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
READ_TXT = "暫時讀不到紀錄，先停在這裡"   # 補充設計 C1 文案


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



def t17(browser, label, dev):
    """三站：舊版／標記 key 放好合法 v1，頁面從載入到作答完全不碰它們（也不碰字串 "null"）。"""
    ctx = new_ctx(browser, dev)
    try:
        B = Tab(ctx)
        if B.ev("G5Core.LS_V1") is not None:   # 自然站縮範圍後也是 LS_V1＝null，一樣要跑（docs/design-storage-scopecut-20261014.md）
            print(f"SKIP {label} T17 本站仍有舊版搬移")
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






def t27(browser, label, dev, how):
    """（4agent 方案 (a) 改寫）逐句解說按下一句時讀不到：不前進、暫停顯示「暫時讀不到」、不寫、不重載；恢復後按再試一次：未變就續接、已刪就失效。"""
    ctx = new_ctx(browser, dev)
    try:
        B = Tab(ctx)
        if not open_lab(B) or not B.has("#mNext"):
            print(f"SKIP {label} T27 本站沒有逐句解說（#mNext）")
            return
        predict(B)
        B.p.locator("#mNext").click()
        li0 = B.p.locator("#mSteps li").count()
        raw0 = B.raw()
        B.ev("() => { window.__failGet = true; }")
        b0 = B.navs
        snap = B.ev(SYNC_CLICK, "#mNext")
        quiet = B.quiet(800)
        txt = B.p.locator("#readNote").inner_text() if B.has("#readNote") else ""
        check(f"{label} T27 讀不到時按下一句：句數不增、零寫入、不失效、暫停顯示「{READ_TXT}」",
              snap.get("li") == li0 and snap.get("dw") == 0 and snap.get("overlay") == 0 and quiet and READ_TXT in txt and B.raw() == raw0,
              {"snap": snap, "安靜": quiet, "提示": txt})
        B.ev("() => { window.__failGet = false; }")
        if how == "已刪":
            B.ev("() => localStorage.removeItem(G5Core.LS_KEY)")
        snap2 = B.ev(SYNC_CLICK, "#retrySave")
        if how == "未變":
            ok = snap2.get("li") == li0 + 1 and snap2.get("overlay") == 0 and not B.has("#storeMask")
        else:
            ok = snap2.get("li") == li0 and overlay_ok(snap2, True) and snap2.get("dw") == 0 and B.raw() is None
        check(f"{label} T27 V {how}、讀取恢復後按再試一次：{'補存這一句並續接' if how == '未變' else '進入失效流程、不寫入'}", ok and not B.errors, {"snap": snap2, "errors": B.errors})
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
        snap2 = B.ev(SYNC_CLICK, "#retrySave")   # 4agent 方案 (a)：暫停只由再試一次解除
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
        snap = B.ev(SYNC_CLICK, "#retrySave")
        still = B.has("#storeMask") and log_len(B) == l0
        B.ev("() => { window.__failGet = false; }")
        B.p.locator("#retrySave").click()
        check(f"{label} T28 讀不到時按「再存一次」：不公布、不寫入；恢復後只存一次",
              snap.get("dw") == 0 and snap.get("overlay") == 0 and still and log_len(B) == l0 + 1 and not B.has("#storeMask") and not B.errors,
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
        snap2 = B.ev(SYNC_CLICK, "#retrySave")
        run = B.ev(LAST_RUN)
        check(f"{label} T28 逐句解說讀不到時切回分頁：句數不增、零寫入；恢復後切回才補存並補上最後一句",
              snap.get("li") == n - 1 and snap.get("dw") == 0 and snap.get("read") == 1 and snap2.get("li") == n and run["tasksDone"] == list(range(n)) and not B.errors,
              {"snap": snap, "snap2": snap2, "run": run, "errors": B.errors})
    finally:
        ctx.close()



# ---------------------------------------------------------------- 補充設計 task-mv6ujb6v-51m58n（單一存檔狀態＋resume）；R 編號＝補充矩陣 Txx
FB = "() => !!(document.querySelector('#main .fb.ok') || document.querySelector('#errq') || document.querySelector('#next'))"
CLEAN = "() => { const t = document.querySelector('#banners').innerText; return !/沒有存|讀不到|還沒存/.test(t) && !document.querySelector('#storeMask'); }"


def r01(browser, label, dev):
    """R01：答案寫入失敗 → 切回分頁時讀不到 → 解除 → 再存一次：只存一次、同輪公布回饋、提示一起更新（不殘留「沒有存」）。"""
    ctx = new_ctx(browser, dev)
    try:
        B = Tab(ctx)
        start(B); l0 = log_len(B); sel = prep_answer(B)
        B.ev("() => { window.__failSet = true; }"); B.p.locator(sel).click(); B.ev("() => { window.__failSet = false; window.__failGet = true; }")
        snap = B.ev(SYNC_VIS)
        mid = B.has("#storeMask") and not B.ev(FB) and snap.get("read") == 1 and snap.get("dw") == 0
        B.ev("() => { window.__failGet = false; }")
        B.p.locator("#retrySave").click()
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
        held = B.has("#storeMask") and not B.ev(FB) and snap.get("dw") == 0 and B.raw() == raw0 and READ_TXT in B.p.locator("#storeMask").inner_text()
        B.ev("() => { window.__failGet = false; }")
        B.p.locator("#retrySave").click()
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
        B.ev("() => { const s = document.querySelector('#snd'); s.value = s.value === 'off' ? '0' : 'off'; s.dispatchEvent(new Event('change')); window.__failSetV = -1; }")   # 4agent 方案 (a)：設定被拒收、沒寫，計數器歸零
        pre = log_len(B) == l0 and B.has("#storeMask")   # 4agent 方案 (a)：暫停中設定被拒收，不會順便補存答案
        B.ev("() => { window.__failGet = true; }")
        snap = B.ev(SYNC_CLICK, "#retrySave")
        held = B.has("#storeMask") and not B.ev(FB) and snap.get("dw") == 0
        B.ev("() => { window.__failGet = false; }")
        B.p.locator("#retrySave").click()
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
        B.p.locator("#retrySave").click()   # 4agent 方案 (a)：暫停只由再試一次解除
        check(f"{label} R04 {when}讀取恢復後按再試一次：提示消失、畫面照常", B.ev("document.querySelectorAll('#readNote').length") == 0 and not B.errors, B.errors)
    finally:
        ctx.close()


def r05(browser, label, dev):
    """R05：resume 中答案補存成功、後面的 tick 讀不到：已存不回滾、這輪不公布；再按一次才公布，同一題不記兩次。"""
    ctx = new_ctx(browser, dev)
    try:
        B = Tab(ctx)
        start(B); l0 = log_len(B); sel = prep_answer(B)
        B.ev("() => { window.__failSet = true; }"); B.p.locator(sel).click(); B.ev("() => { window.__failSet = false; window.__failGetV = 2; }")
        snap = B.ev(SYNC_CLICK, "#retrySave")
        held = log_len(B) == l0 + 1 and B.has("#storeMask") and not B.ev(FB) and snap.get("read") == 1
        B.p.locator("#retrySave").click()
        check(f"{label} R05 補存成功但 tick 讀不到：答案已存、這輪不公布；再按一次才公布、只記一次",
              held and B.ev(FB) and log_len(B) == l0 + 1 and B.ev(CLEAN) and not B.errors, {"held": held, "snap": snap, "log": [l0, log_len(B)], "errors": B.errors})
    finally:
        ctx.close()




# ---------------------------------------------------------------- 第 3 輪（四站共同）：待存 ID 分離、tick 未完成不前進、READ 時不先標答案
def r27(browser, label, dev):
    """R27（4agent 方案 (a) 改寫）：設定寫失敗成為唯一待存 → 整頁暫停（作答被遮住、繞過也拒收）→ 再試一次補存設定 → 之後作答只記一次。"""
    ctx = new_ctx(browser, dev)
    try:
        B = Tab(ctx)
        start(B); l0 = log_len(B); sel = prep_answer(B)
        snd0 = B.state()["settings"]["sound"]
        B.ev("() => { window.__failSet = true; const s = document.querySelector('#snd'); s.value = s.value === 'off' ? '0' : 'off'; s.dispatchEvent(new Event('change')); window.__failSet = false; }")
        held = B.has("#storeMask")
        B.ev("(s) => document.querySelector(s).click()", sel)
        rejected = log_len(B) == l0 and not B.ev(FB)
        B.p.locator("#retrySave").click()
        s1 = B.state()
        B.p.wait_for_selector("#main .q")
        answer(B)
        check(f"{label} R27 設定待存時暫停、作答被拒收；再試一次補存設定；之後作答只記一次",
              held and rejected and s1["settings"]["sound"] != snd0 and log_len(B) == l0 + 1 and B.ev(FB) and B.ev(CLEAN) and not B.errors,
              {"held": held, "rejected": rejected, "log": [l0, log_len(B)], "errors": B.errors})
    finally:
        ctx.close()


def r28(browser, label, dev):
    """R28（4agent 方案 (a) 改寫）：切回分頁時 tick 寫失敗 → 暫停；繞過遮罩按下一步／完成鈕都不動；再試一次補完 tick 後才前進。"""
    ctx = new_ctx(browser, dev)
    try:
        B = Tab(ctx)
        if not open_lab(B):
            check(f"{label} R28 找得到實驗", False, "沒有"); return
        predict(B); n = n_tasks(B)
        B.ev("() => { window.__failSetV = 0; }"); B.ev(SYNC_VIS)
        pre = B.has("#storeMask")
        B.ev("(s) => { const b = document.querySelector(s); if (b) b.click(); }", task_sel(B, 0))
        blocked = B.ev(LAST_RUN)["tasksDone"] == []
        B.p.locator("#retrySave").click()
        do_task(B, 0)
        run = B.ev(LAST_RUN)
        check(f"{label} R28 tick 沒做完時暫停、下一步被拒收；再試一次後才前進、提示清掉", pre and blocked and run["tasksDone"] == [0] and not B.has("#storeMask") and not B.errors,
              {"pre": pre, "blocked": blocked, "run": run})
        for i in range(1, n):
            do_task(B, i)
        B.ev("() => { window.__failSetV = 0; }"); B.ev(SYNC_VIS)
        pre2 = B.has("#storeMask")
        B.ev("() => { const d = document.querySelector('#labDone'); if (d) d.click(); }")
        stay = B.has("#labNav")
        B.p.locator("#retrySave").click(); B.p.locator("#labDone").click()
        done = not B.has("#labNav") and not B.has("#storeMask")
        check(f"{label} R28 tick 沒做完時完成鈕被拒收；再試一次後才完成、提示清掉", pre2 and stay and done and not B.errors, {"pre": pre2, "stay": stay, "done": done, "errors": B.errors})
    finally:
        ctx.close()


def r29(browser, label, dev):
    """R29（4agent 方案 (a) 改寫）：題目畫面切回分頁時 tick 寫失敗 → 暫停（作答被遮住）；再試一次補完 tick 後作答，公布時沒有殘留提示、只記一次。"""
    ctx = new_ctx(browser, dev)
    try:
        B = Tab(ctx)
        start(B); l0 = log_len(B)
        B.ev("() => { window.__failSetV = 0; }"); B.ev(SYNC_VIS)
        pre = B.has("#storeMask") and "還沒整理好" in B.p.locator("#storeMask").inner_text()
        B.p.locator("#retrySave").click()
        answer(B)
        check(f"{label} R29 tick 沒做完時暫停（說還沒整理好）；再試一次後作答才公布、提示清掉、只記一次", pre and B.ev(FB) and B.ev(CLEAN) and log_len(B) == l0 + 1 and not B.errors,
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
        B.p.locator("#retrySave").click()
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
        B.p.locator("#retrySave").click()   # 4agent 方案 (a)：補存靠遮罩的再試一次
        run = B.ev(LAST_RUN)
        ok = B.has("#labPredict") and run["tasksDone"] == list(range(n)) and B.p.locator("#labDone").is_enabled() and B.p.locator("#labTask .ck.got").count() == n
        check(f"{label} R31 實驗最後一步補存（再試一次）後：留在實驗、任務全打勾、完成鈕可按", ok and not B.errors,
              {"run": run, "got": B.p.locator("#labTask .ck.got").count(), "enabled": B.has("#labDone") and B.p.locator("#labDone").is_enabled(), "errors": B.errors})
    finally:
        ctx.close()


# ---------------------------------------------------------------- 4agent 最終方案 (a)「存檔一不正常就整頁暫停」：A 列（真實瀏覽器、原始 handler）
MASK = "#storeMask"
QTXT = "() => { const q = document.querySelector('#main .q'); return q ? q.innerText : ''; }"
MARKS = "document.querySelectorAll('#main .opt.right, #main .opt.wrong').length"


def first_choice(t):
    """開始一輪並停在選擇題（需要 .opt）；找不到回 False。"""
    start(t)
    for _ in range(30):
        if t.has("#main .opt"):
            return True
        answer(t)
        if t.has("#next"):
            t.p.locator("#next").click()
        else:
            start(t)
    return t.has("#main .opt")


def a01(browser, label, dev):
    """A01：設定寫失敗成為待存 → 整頁暫停；直接觸發作答（繞過遮罩用 JS click）：不寫、不公布、題目不變。"""
    ctx = new_ctx(browser, dev)
    try:
        B = Tab(ctx)
        if not first_choice(B):
            print(f"SKIP {label} A01 這一輪沒有選擇題"); return
        l0 = log_len(B); q0 = B.ev(QTXT)
        B.ev("() => { window.__failSet = true; const s = document.querySelector('#snd'); s.value = s.value === 'off' ? '0' : 'off'; s.dispatchEvent(new Event('change')); window.__failSet = false; window.__w = 0; }")
        masked = B.has(MASK)
        B.ev("() => document.querySelector('#main .opt').click()")
        check(f"{label} A01 設定待存時整頁暫停；直接觸發作答也不寫、不公布、題目不變",
              masked and B.ev("window.__w") == 0 and log_len(B) == l0 and B.ev(QTXT) == q0 and B.ev(MARKS) == 0 and not B.ev(FB) and not B.errors,
              {"遮罩": masked, "w": B.ev("window.__w"), "log": [l0, log_len(B)], "errors": B.errors})
    finally:
        ctx.close()


def a02(browser, label, dev):
    """A02／A04／A05：作答時讀不到 → 暫停、不標對錯；暫停中直接觸發換頁也不換；恢復後再試一次：存一次、同一題公布回饋並標正解。"""
    ctx = new_ctx(browser, dev)
    try:
        B = Tab(ctx)
        if not first_choice(B):
            print(f"SKIP {label} A02 這一輪沒有選擇題"); return
        l0 = log_len(B); q0 = B.ev(QTXT)
        B.ev("() => { window.__failGet = true; }")
        B.p.locator("#main .opt").first.click()
        held = B.has(MASK) and B.has("#readNote") and B.ev(MARKS) == 0 and not B.ev(FB)
        B.ev("() => { window.__failGet = false; window.__w = 0; const c = document.querySelector('#concepts .ccard'); if (c) c.click(); }")
        same = B.ev(QTXT) == q0 and B.ev("window.__w") == 0
        B.p.locator("#retrySave").click()
        check(f"{label} A02 作答讀不到：暫停、不標對錯、不公布；暫停中換頁無效；恢復後再試一次：只存一次、同一題公布並標正解",
              held and same and log_len(B) == l0 + 1 and B.ev(FB) and B.ev("document.querySelectorAll('#main .opt.right').length") == 1 and not B.has(MASK) and not B.errors,
              {"held": held, "same": same, "log": [l0, log_len(B)], "mask": B.has(MASK), "errors": B.errors})
    finally:
        ctx.close()


def a08(browser, label, dev):
    """A08：答完一題（有「下一題」）→ 切回分頁 tick 寫失敗 → 暫停（說「今天的進度還沒整理好」）；直接觸發「下一題」：題目不變。"""
    ctx = new_ctx(browser, dev)
    try:
        B = Tab(ctx)
        start(B); answer(B)
        if not B.has("#next") and B.has('#errq button[data-k=""]'):
            B.p.locator('#errq button[data-k=""]').click()   # 答錯時按「先跳過」，「下一題」才會出現
        if not B.has("#next"):
            check(f"{label} A08 答完要有「下一題」", False, "沒有"); return
        q0 = B.ev(QTXT)
        B.ev("() => { window.__failSetV = 0; }"); B.ev(SYNC_VIS)
        txt = B.p.locator(MASK).inner_text() if B.has(MASK) else ""
        B.ev("() => document.querySelector('#next').click()")
        check(f"{label} A08 tick 沒做完時暫停（不說沒有存）；直接觸發下一題：題目不變",
              "還沒整理好" in txt and "沒有存" not in txt and B.ev(QTXT) == q0 and B.has("#next") and B.has(MASK) and not B.errors, {"txt": txt[:80], "next": B.has("#next"), "errors": B.errors})   # 原題回饋與「下一題」還在＝沒換頁
        B.p.locator("#retrySave").click()
        check(f"{label} A08 恢復後再試一次：暫停解除", not B.has(MASK) and not B.errors, B.errors)
    finally:
        ctx.close()


def a09(browser, label, dev):
    """A09：解說／實驗暫停中，直接觸發下一步與完成鈕：句數不增、完成鈕不開。"""
    ctx = new_ctx(browser, dev)
    try:
        B = Tab(ctx)
        if not open_lab(B):
            check(f"{label} A09 找得到實驗", False, "沒有"); return
        predict(B); do_task(B, 0)
        run0 = B.ev(LAST_RUN); li0 = B.p.locator("#mSteps li").count()
        B.ev("() => { window.__failSetV = 0; }"); B.ev(SYNC_VIS)
        sel = task_sel(B, 1)
        B.ev("(s) => { const b = document.querySelector(s); if (b) b.click(); const d = document.querySelector('#labDone'); if (d) { d.disabled = false; d.click(); } }", sel)
        check(f"{label} A09 暫停中觸發下一步／完成鈕：句數與任務不變、仍在實驗",
              B.has(MASK) and B.ev(LAST_RUN) == run0 and B.p.locator("#mSteps li").count() == li0 and B.has("#labPredict") and not B.errors, {"run": B.ev(LAST_RUN), "errors": B.errors})
    finally:
        ctx.close()


def a11(browser, label, dev):
    """A11：暫停中切回分頁：只檢查有沒有被別處改，不補存、不重畫；被別處改了才走失效流程。"""
    ctx = new_ctx(browser, dev)
    try:
        B = Tab(ctx)
        start(B); sel = prep_answer(B); l0 = log_len(B)
        B.ev("() => { window.__failSet = true; }"); B.p.locator(sel).click(); B.ev("() => { window.__failSet = false; window.__w = 0; }")
        snap = B.ev(SYNC_VIS)
        stay = B.has(MASK) and snap.get("dw") == 0 and log_len(B) == l0
        A = Tab(ctx); b0 = B.navs
        A.ev("() => localStorage.removeItem(G5Core.LS_KEY)")
        B.p.wait_for_selector("#outdated")
        check(f"{label} A11 暫停中切回分頁：不補存（寫入 0）、仍暫停；別處刪檔才進失效（這一步需要重做）",
              stay and overlay_ok(B.ev(SNAP, ""), True) and B.quiet(800) and not B.errors and not A.errors, {"stay": stay, "snap": snap})
    finally:
        ctx.close()


def a12(browser, label, dev):
    """A12：作答讀不到 → 別處換掉存檔 → 再試一次：進失效流程並要求確認（這一步需要重做），不自動重載、不寫回。"""
    ctx = new_ctx(browser, dev)
    try:
        B = Tab(ctx)
        start(B); sel = prep_answer(B)
        B.ev("() => { window.__failGet = true; }"); B.p.locator(sel).click(); B.ev("() => { window.__failGet = false; }")
        ext = B.ev("() => { const K = G5Core.LS_KEY, s = JSON.parse(window.__rawGet(K)); s.settings.sound = !s.settings.sound; const t = JSON.stringify(s); localStorage.setItem(K, t); window.__w = 0; return t; }")
        snap = B.ev(SYNC_CLICK, "#retrySave")
        check(f"{label} A12 讀不到後別處換檔、再試一次：失效並要求確認、不自動重載、存檔保持別處的值",
              overlay_ok(snap, True) and snap.get("dw") == 0 and B.quiet(800) and B.raw() == ext and not B.errors, {"snap": snap})
    finally:
        ctx.close()


def a13(browser, label, dev):
    """A13：有待存時按「回首頁」：取消＝仍暫停、待存保留；確定＝整頁重載、不補寫。"""
    ctx = new_ctx(browser, dev)
    try:
        B = Tab(ctx)
        start(B); sel = prep_answer(B); l0 = log_len(B)
        B.ev("() => { window.__failSet = true; }"); B.p.locator(sel).click(); B.ev("() => { window.__failSet = false; }")
        B.p.locator("#maskHome").click()
        asked = B.has("#maskHomeYes") and B.has("#maskHomeNo")
        B.p.locator("#maskHomeNo").click()
        kept = B.has(MASK) and B.has("#retrySave")
        b0 = B.navs
        B.p.locator("#maskHome").click(); B.p.locator("#maskHomeYes").click()
        reloaded = B.wait_reload(b0)
        check(f"{label} A13 回首頁要確認；取消仍暫停；確定才重載、不補寫這一題",
              asked and kept and reloaded and log_len(B) == l0 and not B.has(MASK) and not B.errors, {"asked": asked, "kept": kept, "重載": reloaded, "log": [l0, log_len(B)]})
    finally:
        ctx.close()


def a14(browser, label, dev):
    """A14：開頁就讀不到（空白裝置）→ 暫停說讀不到、只給「重新整理」；恢復後重新整理：照常可用。"""
    ctx = new_ctx(browser, dev)
    try:
        B = Tab(ctx)
        B.ev("() => { localStorage.clear(); sessionStorage.setItem('__e2e', JSON.stringify({__failGet: true})); }")
        B.p.reload(); B.p.wait_for_selector(MASK)
        B.ev("() => sessionStorage.removeItem('__e2e')")
        txt = B.p.locator(MASK).inner_text()
        ok1 = "讀不到這台裝置的紀錄" in txt and B.has("#maskReload") and B.ev("window.__w") == 0
        b0 = B.navs
        B.ev("() => { window.__failGet = false; }"); B.p.locator("#maskReload").click()
        reloaded = B.wait_reload(b0)
        start(B); answer(B)
        check(f"{label} A14 開頁讀不到：暫停、只給重新整理、零寫入；恢復後重新整理照常作答", ok1 and reloaded and log_len(B) == 1 and not B.has(MASK) and not B.errors,
              {"txt": txt[:60], "重載": reloaded, "log": log_len(B), "errors": B.errors})
    finally:
        ctx.close()


def a16(browser, label, dev):
    """A16：壞存檔 → 暫停、作答不寫；家長在暫停畫面兩步清除 → 空白可作答。"""
    ctx = new_ctx(browser, dev)
    try:
        B = Tab(ctx)
        B.ev("() => { localStorage.setItem(G5Core.LS_KEY, '{壞掉'); }"); B.p.reload(); B.p.wait_for_selector(MASK)
        txt = B.p.locator(MASK).inner_text()
        B.p.locator("#discard").click(); B.p.locator("#discardYes").click()
        s = B.state()
        start(B); answer(B)
        check(f"{label} A16 壞存檔：暫停說讀不出來、有家長清除；清除後可作答", "存檔讀不出來" in txt and s is not None and log_len(B) == 1 and not B.has(MASK) and not B.errors,
              {"txt": txt[:60], "log": log_len(B), "errors": B.errors})
    finally:
        ctx.close()


def a21(browser, label, dev):
    """A21：作答寫失敗 → 恢復後連按兩次再試一次：只記一次、回饋只出現一次。"""
    ctx = new_ctx(browser, dev)
    try:
        B = Tab(ctx)
        start(B); sel = prep_answer(B); l0 = log_len(B)
        B.ev("() => { window.__failSet = true; }"); B.p.locator(sel).click(); B.ev("() => { window.__failSet = false; }")
        B.ev("() => { const b = document.querySelector('#retrySave'); b.click(); b.click(); }")
        nfb = B.ev("document.querySelectorAll('#main #next, #main #errq').length")
        check(f"{label} A21 連按兩次再試一次：只記一次、回饋一次", log_len(B) == l0 + 1 and nfb == 1 and not B.has(MASK) and not B.errors, {"log": [l0, log_len(B)], "fb": nfb, "errors": B.errors})
    finally:
        ctx.close()


def a22(browser, label, dev):
    """A22（Codex 審 0f1db5a #1）：點錯選項 → 公布回饋時點的那個選項要標 .wrong（只標一個），正解標 .right。"""
    ctx = new_ctx(browser, dev)
    try:
        B = Tab(ctx)
        start(B); hit = None
        for _ in range(30):
            if B.has("#main .opt"):
                q = B.p.locator("#main .q").first.inner_text(); n = B.p.locator("#main .opt").count()
                k = (KNOWN[q] + 1) % n if q in KNOWN else 0
                B.p.locator(f'#main .opt[data-i="{k}"]').click()
                right = int(B.p.locator("#main .opt.right").first.get_attribute("data-i")) if B.has("#main .opt.right") else None
                if right is not None:
                    KNOWN[q] = right
                if right is not None and right != k:
                    hit = {"點的": k, "點的標了wrong": B.ev("(k) => !!document.querySelector('#main .opt.wrong[data-i=\"' + k + '\"]')", str(k)),
                           "wrong數": B.ev("document.querySelectorAll('#main .opt.wrong').length")}
                    break
            else:
                answer(B)
            if B.has('#errq button[data-k=""]'):
                B.p.locator('#errq button[data-k=""]').click()
            if B.has("#next"):
                B.p.locator("#next").click()
            else:
                start(B)
        check(f"{label} A22 點錯選項：點的那個標 .wrong（只標一個）、正解標 .right",
              hit is not None and hit["點的標了wrong"] and hit["wrong數"] == 1 and not B.errors, {"hit": hit, "errors": B.errors})
    finally:
        ctx.close()


def a23(browser, label, dev):
    """A23（Codex 審 0f1db5a #2）：實驗停在「先預測」時切回分頁、tick 寫失敗 → 繞過遮罩按預測：不前進（任務不打開、預測不寫）；再試一次後才能預測。"""
    ctx = new_ctx(browser, dev)
    try:
        B = Tab(ctx)
        if not open_lab(B):
            check(f"{label} A23 找得到實驗", False, "沒有"); return
        B.ev("() => { window.__failSetV = 0; }"); B.ev(SYNC_VIS)
        B.ev("() => { const b = document.querySelector('#labPredict button[data-g]'); if (b) b.click(); }")
        stay = B.p.locator("#labTask").is_hidden() and B.has("#labPredict button[data-g]")
        pred = B.ev("() => { const s = JSON.parse(window.__rawGet(G5Core.LS_KEY)); const ids = Object.keys(s.labRuns); return s.labRuns[ids[ids.length - 1]].prediction; }")
        if B.has("#retrySave"):
            B.p.locator("#retrySave").click()
        if B.has("#labPredict button[data-g]:not([disabled])"):
            predict(B)
        check(f"{label} A23 tick 沒做完時預測不前進、不寫；再試一次後才打開任務", stay and pred is None and B.p.locator("#labTask").is_visible() and not B.errors,
              {"stay": stay, "prediction": pred, "errors": B.errors})
    finally:
        ctx.close()


FLOWS = [
    ("T01", t01, ()), ("T02", t02, ()), ("T03", t03, ()), ("T04", t04, ()),
    ("T05", t05, ("removeItem",)), ("T05", t05, ("clear",)),
    ("T07", t07, ("predict",)), ("T07", t07, ("task",)), ("T07", t07, ("complete",)), ("T08", t08, ()),
    ("T09", t09, ("別頁清除",)), ("T09", t09, ("切回頁面",)), ("T09", t09, ("點舊按鈕",)),
    ("T10", t10, ("answer",)), ("T10", t10, ("labTask",)),
    ("T11", t11_event, ("一般更新",)), ("T11", t11_event, ("清除全部紀錄",)), ("T11", t11_event, ("整個刪掉",)),
    ("T11", t11_trigger, ("retry",)), ("T11", t11_trigger, ("tick",)), ("T11", t11_trigger, ("新操作",)),
    ("T12", t12, ("dispatch",)), ("T12", t12, ("tick",)), ("T13", t13, ()),
    ("T14", t14_broken, ()), ("T14", t14_read, ()), ("T15", t15_pending, ()), ("T15", t15_burst, ()),
    ("M", m_save_fail, ()), ("M", m_retry_resume, ()), ("M", m_last_resume, ()),
    ("T08", t08b, ()), ("T15", t15_anim, ()),
    ("T17", t17, ()),
    ("T27", t27, ("未變",)), ("T27", t27, ("已刪",)), ("T28", t28, ()),
    ("R01", r01, ()), ("R02", r02, ()), ("R03", r03, ()), ("R04", r04, ("同日",)), ("R04", r04, ("跨日",)), ("R05", r05, ()),
    ("R27", r27, ()), ("R28", r28, ()), ("R29", r29, ()), ("R30", r30, ()), ("R31", r31, ()),
    ("A01", a01, ()), ("A02", a02, ()), ("A08", a08, ()), ("A09", a09, ()), ("A11", a11, ()), ("A12", a12, ()), ("A13", a13, ()), ("A14", a14, ()), ("A16", a16, ()), ("A21", a21, ()), ("A22", a22, ()), ("A23", a23, ()),
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
