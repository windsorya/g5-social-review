"""第 3 輪 Codex FAIL 的真瀏覽器重現（審 281d271／56710b2／f5f2cf0：A2／M01、B7／M03）。

情境：
  ① 今天的計畫裡有一張題目已不在題庫（gone），其他都做完：首頁大標題不得說「今天的卡片都做完了」，要說「今天能做的」並講明缺題
  ② 重新整理後（本頁沒有自己開的補做），共用回合裡有一份還沒結算的 10/18 補做：按「開始今天的練習」不得把它蓋掉，
     提示先結算；回合與作答都留著；按首頁「結算」才記到 10/18
  ③ 補做預設關閉（2026-10-18 縮範圍）：只有說明、沒有補做按鈕
  ④ 關閉前就開始、還沒做完的補做回合：按「開始今天的練習」不得蓋掉它，提示先做完
  ⑤ 補做關閉、今天還沒做完：說明照樣是「暫停使用」
  ⑥ 補做開了、一題都還沒答就重新整理：開新回合不被擋（沒有作答可遺失）
  每段都驗沒有 JS 錯誤
四站同一支（核心 G5Core、存檔 key 讀頁面上的 G5Core.LS_KEY；題號取頁面題庫）。
執行：python3.12 tests/e2e_missing.py
"""
import datetime
import json
import re
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
          const cards = B ? B.CARDS : window.G5_EXTRA_CARDS.filter((c) => !M[c.id] && c.concept[0] !== "3");
          const ids = cards.filter((c) => c.type === "choice").slice(0, 3);
          return { key: C.LS_KEY, blank: C.blankState(), r1: ids[0].id, c1: ids[0].concept, r2: ids[1].id, c2: ids[1].concept, r3: ids[2].id }; })()""")
        ctx.close()
        r1, r2, r3, c1, c2 = info["r1"], info["r2"], info["r3"], info["c1"], info["c2"]
        learned = {"seen": 1, "goodDays": [TODAY], "blockedDay": None, "due": "2026-10-23"}

        s = json.loads(json.dumps(info["blank"]))
        s["days"][TODAY] = {"planIds": ["gone", r1], "doneIds": [r1], "touched": [r1], "extraDone": False, "labRuns": 0, "teach": 0, "mood": None}
        s["cards"][r1] = dict(learned); s["log"] = [entry(r1, c1, "x1")]
        ctx, page, errors = open_page(browser, (info["key"], s))
        home = page.inner_text("#main")
        check("① 缺題：大標題不說「今天的卡片都做完了」", "今天的卡片都做完了" not in home and "今天能做的卡片都做完了" in home, home[:200])
        check("① 缺題：講明有題目已不在題庫、不說全部完成", "不在題庫" in home and "全部完成" not in home, home[:300])
        check("① 沒有 JS 錯誤", not errors, errors)
        ctx.close()

        s = json.loads(json.dumps(info["blank"]))
        s["days"][TODAY] = {"planIds": [r1, r3], "doneIds": [r1], "touched": [r1, r2], "extraDone": False, "labRuns": 0, "teach": 0, "mood": None}
        s["cards"][r1] = dict(learned); s["cards"][r2] = dict(learned)
        s["log"] = [entry(r1, c1, "x1"), entry(r2, c2, "x2")]
        s["session"] = {"day": TODAY, "kind": "review", "queue": [], "answered": [r2], "wrong": [], "kinds": {}, "makeup": "2026-10-18"}
        ctx, page, errors = open_page(browser, (info["key"], s))
        page.wait_for_timeout(300)
        page.locator("#goAll").first.click()
        page.wait_for_timeout(300)
        disk = json.loads(page.evaluate("localStorage.getItem(window.G5Core.LS_KEY)"))
        se = disk.get("session") or {}
        check("② 別頁留下的未結算補做：開新回合不蓋掉它（回合仍是 10/18 補做、已答還在）", se.get("makeup") == "2026-10-18" and se.get("answered") == [r2], json.dumps(se, ensure_ascii=False)[:200])
        check("② 沒有自動記到 10/18（只記明確請求）", not (disk["days"].get("2026-10-18") or {}).get("touched"), json.dumps(disk["days"], ensure_ascii=False)[:200])
        check("② 提示先結算", "還沒結算" in page.inner_text("#main"), page.inner_text("#main")[:200])
        btn = page.locator("#goSettle")
        if btn.count():
            btn.click()
        disk = json.loads(page.evaluate("localStorage.getItem(window.G5Core.LS_KEY)"))
        d = disk["days"].get("2026-10-18") or {}
        check("② 按首頁「結算」才記到 10/18", d.get("madeUp") == TODAY and d.get("touched") == [r2], json.dumps(disk["days"], ensure_ascii=False)[:300])
        check("② 沒有 JS 錯誤", not errors, errors)
        ctx.close()
        # ③ 補做預設關閉（2026-10-18 縮範圍）：前面有沒練的日子，也只看到說明、沒有「補做 x/y」按鈕
        s = json.loads(json.dumps(info["blank"]))
        s["days"][TODAY] = {"planIds": [r1], "doneIds": [r1], "touched": [r1], "extraDone": False, "labRuns": 0, "teach": 0, "mood": None}
        s["cards"][r1] = dict(learned); s["log"] = [entry(r1, c1, "x1")]
        ctx, page, errors = open_page(browser, (info["key"], s))
        page.wait_for_timeout(300)
        mk = page.inner_text("#makeup") if page.locator("#makeup").count() else ""
        check("③ 補做預設關閉：只顯示說明、沒有補做按鈕", "補做暫停使用" in mk and page.locator("button[data-mk]").count() == 0, mk[:200])
        check("③ 沒有 JS 錯誤", not errors, errors)
        ctx.close()

        # ④ 還沒做完的補做回合（關閉前就開始的）：按「開始今天的練習」不得蓋掉它（Codex 審 670a476 B7）
        s = json.loads(json.dumps(info["blank"]))
        s["days"][TODAY] = {"planIds": [r1, r3], "doneIds": [r1], "touched": [r1, r2], "extraDone": False, "labRuns": 0, "teach": 0, "mood": None}
        s["cards"][r1] = dict(learned); s["cards"][r2] = dict(learned)
        s["log"] = [entry(r1, c1, "x1"), entry(r2, c2, "x2")]
        s["session"] = {"day": TODAY, "kind": "review", "queue": [r3], "answered": [r2], "wrong": [], "kinds": {}, "makeup": "2026-10-18"}
        ctx, page, errors = open_page(browser, (info["key"], s))
        page.wait_for_timeout(300)
        page.locator("#goAll").first.click()
        page.wait_for_timeout(300)
        se = json.loads(page.evaluate("localStorage.getItem(window.G5Core.LS_KEY)")).get("session") or {}
        check("④ 做到一半的補做回合沒被新回合蓋掉", se.get("makeup") == "2026-10-18" and se.get("answered") == [r2] and se.get("queue") == [r3], json.dumps(se, ensure_ascii=False)[:200])
        check("④ 提示先把補做做完", "還沒做完" in page.inner_text("#main"), page.inner_text("#main")[:200])
        check("④ 沒有 JS 錯誤", not errors, errors)
        ctx.close()
        # ⑤ 補做關閉、今天還沒做完：說明照樣是「暫停使用」，不說「做完後可以補做」（Codex 審 e2df182 ②）
        s = json.loads(json.dumps(info["blank"]))
        s["days"][TODAY] = {"planIds": [r1, r3], "doneIds": [r1], "touched": [r1], "extraDone": False, "labRuns": 0, "teach": 0, "mood": None}
        s["cards"][r1] = dict(learned); s["log"] = [entry(r1, c1, "x1")]
        ctx, page, errors = open_page(browser, (info["key"], s))
        page.wait_for_timeout(300)
        mk = page.inner_text("#makeup") if page.locator("#makeup").count() else ""
        check("⑤ 補做關閉、今天沒做完：只說暫停使用", "補做暫停使用" in mk and "可以在這裡補做" not in mk, mk[:200])
        ctx.close()

        # ⑥ 補做開了、一題都還沒答就重新整理：不得卡死——開新回合要能成功（沒有作答可遺失；Codex 審 e2df182 ③）
        s = json.loads(json.dumps(info["blank"]))
        s["days"][TODAY] = {"planIds": [r1, r3], "doneIds": [r1], "touched": [r1], "extraDone": False, "labRuns": 0, "teach": 0, "mood": None}
        s["cards"][r1] = dict(learned); s["log"] = [entry(r1, c1, "x1")]
        s["session"] = {"day": TODAY, "kind": "review", "queue": [r2], "answered": [], "wrong": [], "kinds": {}, "makeup": "2026-10-18"}
        ctx, page, errors = open_page(browser, (info["key"], s))
        page.wait_for_timeout(300)
        page.locator("#goAll").first.click()
        page.wait_for_timeout(300)
        se = json.loads(page.evaluate("localStorage.getItem(window.G5Core.LS_KEY)")).get("session") or {}
        check("⑥ 一題都沒答的補做不擋：開得了今天的練習", not se.get("makeup") and "還沒做完" not in page.inner_text("#main"), json.dumps(se, ensure_ascii=False)[:200])
        check("⑤⑥ 沒有 JS 錯誤", not errors, errors)
        ctx.close()
        browser.close()
    print("%d/%d PASS" % (sum(results), len(results)))
    return 0 if all(results) else 1


if __name__ == "__main__":
    sys.exit(main())
