"""題庫拿掉卡之後，她已經練過的紀錄要照常運作（2026-10-18 四站裁重複題；Codex 審 g5-math-review 9af8526 兩項）。

情境（存檔裡放一張題庫已經沒有的卡 gone，其餘用這站真的題號）：
  ① 再練答錯的：這一輪答錯過 r1 和 gone ⇒ 按鈕寫「再練答錯的 1 張」，按下去真的出 r1 那一題
  ② 補做做到一半、剩下的題只剩 gone：重新整理後 10/18 已結算成補做（touched＝已答的 r2），首頁沒有卡住的「繼續補做」
  ③ 頁面沒有 JS 錯誤
自然、數學、國語、社會四站同一支（核心 G5Core、存檔 key 讀頁面上的 G5Core.LS_KEY；題號取頁面上題庫全域物件的前兩張選擇題）。
執行：python3.12 tests/e2e_vanish.py
"""
import datetime
import json
import sys
from pathlib import Path

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parent.parent
URL = (ROOT / "index.html").as_uri()
TODAY = "2026-10-20"
NOW = datetime.datetime(2026, 10, 20, 12, 0, tzinfo=datetime.timezone(datetime.timedelta(hours=8)))
results = []


def check(name, ok, info=""):
    results.append(ok)
    print(("PASS " if ok else "FAIL ") + name + ("" if ok else "  ← " + str(info)[:300]))


def entry(card, cid, op):
    return {"op": op, "d": TODAY, "card": card, "c": cid, "ok": True, "hint": False, "unsure": False, "variation": False, "first": True}


def open_page(browser, state=None):
    ctx = browser.new_context(viewport={"width": 1024, "height": 900})
    page = ctx.new_page()
    errors = []
    page.on("pageerror", lambda e: errors.append(str(e)))
    page.clock.install(time=NOW)
    if state is not None:
        page.add_init_script("if(!sessionStorage.getItem('seeded')){sessionStorage.setItem('seeded','1');localStorage.setItem(%s,%s);}"
                             % (json.dumps(state[0]), json.dumps(json.dumps(state[1]))))
    page.goto(URL)
    page.wait_for_selector("#main")
    return ctx, page, errors


def main():
    with sync_playwright() as p:
        browser = p.chromium.launch()
        ctx, page, _ = open_page(browser)
        info = page.evaluate("""(() => { const C = window.G5Core, B = window.G5MathBank || window.G5ChiBank || window.G5SocBank, M = window.G5_MERGED || {};
          const cards = B ? B.CARDS : window.G5_EXTRA_CARDS.filter((c) => !M[c.id] && c.concept[0] !== "3");   // 自然站：加題檔裡留下的卡（第三單元預設沒開）
          const ids = cards.filter((c) => c.type === "choice").slice(0, 2);
          return { key: C.LS_KEY, blank: C.blankState(), r1: ids[0].id, c1: ids[0].concept, r2: ids[1].id, c2: ids[1].concept, q1: ids[0].q }; })()""")
        ctx.close()
        r1, r2, c1, c2 = info["r1"], info["r2"], info["c1"], info["c2"]
        day = {"planIds": [r1], "doneIds": [r1], "touched": [r1], "extraDone": False, "labRuns": 0, "teach": 0, "mood": None}
        learned = {"seen": 1, "goodDays": [TODAY], "blockedDay": None, "due": "2026-10-21"}

        s = json.loads(json.dumps(info["blank"]))
        s["days"][TODAY] = dict(day); s["cards"][r1] = dict(learned); s["log"] = [entry(r1, c1, "x1")]
        s["session"] = {"day": TODAY, "kind": "plan", "queue": [], "answered": [r1, "gone"], "wrong": [r1, "gone"], "kinds": {}}
        ctx, page, errors = open_page(browser, (info["key"], s))
        home = page.inner_text("#main")
        check("① 再練答錯的只算題庫裡還在的卡：寫「再練答錯的 1 張」", "再練答錯的 1 張" in home and "再練答錯的 2 張" not in home, home[-300:])
        page.locator("#goRedo").first.click()
        m = page.inner_text("#main")
        check("① 按下去真的出那一題（不是空的一輪）", info["q1"][:12] in m and "這一輪做了 0 張" not in m, m[:200])
        check("① 沒有 JS 錯誤", not errors, errors)
        ctx.close()

        s = json.loads(json.dumps(info["blank"]))
        s["days"][TODAY] = dict(day); s["cards"][r1] = dict(learned); s["cards"][r2] = dict(learned)
        s["log"] = [entry(r1, c1, "x1"), entry(r2, c2, "x2")]
        s["session"] = {"day": TODAY, "kind": "review", "queue": ["gone"], "answered": [r2], "wrong": [], "kinds": {}, "makeup": "2026-10-18"}
        ctx, page, errors = open_page(browser, (info["key"], s))
        page.evaluate("document.dispatchEvent(new Event('visibilitychange')); 0")
        disk = json.loads(page.evaluate("localStorage.getItem(window.G5Core.LS_KEY)"))
        shown = page.inner_text("#main")
        d = disk["days"].get("2026-10-18") or {}
        check("② 剩下的補做題只剩被拿掉的卡：開頁後 10/18 已結算（madeUp＝今天、touched＝已答的那張）",
              d.get("madeUp") == TODAY and d.get("touched") == [r2], json.dumps(disk["days"], ensure_ascii=False)[:300])
        check("② 首頁沒有卡住的「繼續補做」", "繼續補做" not in shown, shown[:200])
        check("② 沒有 JS 錯誤", not errors, errors)
        ctx.close()
        browser.close()
    print("%d/%d PASS" % (sum(results), len(results)))
    return 0 if all(results) else 1


if __name__ == "__main__":
    sys.exit(main())
