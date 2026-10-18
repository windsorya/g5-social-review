"""單一寫入分頁（2026-10-18 第 3 輪，Codex 審 8364a83 T15／T18；同錯題站 g5wrong.v1:writer）：真瀏覽器、同一個瀏覽器開兩頁。

情境：
  ① 先開的 A 頁拿到寫入權：沒有唯讀提示；按「開始今天的練習」會寫進存檔
  ② 後開的 B 頁唯讀：提示「另一個分頁正在練習」；按「開始今天的練習」存檔逐字不變
  ③ 關掉 A：B 自動接手（唯讀提示消失），再按就寫得進去，而且 A 寫過的內容還在（先換成磁碟最新版）
  ④ 兩頁都沒有 JS 錯誤
自然、數學、國語、社會四站同一支（存檔 key 讀頁面上的 G5Core.LS_KEY）。
執行：python3.12 tests/e2e_writer.py
"""
import datetime
import sys
from pathlib import Path

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parent.parent
URL = (ROOT / "index.html").as_uri()
NOW = datetime.datetime(2026, 10, 20, 12, 0, tzinfo=datetime.timezone(datetime.timedelta(hours=8)))
results = []
RO = "另一個分頁正在練習"


def check(name, ok, info=""):
    results.append(ok)
    print(("PASS " if ok else "FAIL ") + name + ("" if ok else "  ← " + str(info)[:300]))


def page_of(ctx, errors):
    pg = ctx.new_page()
    pg.on("pageerror", lambda e: errors.append(str(e)))
    pg.clock.install(time=NOW)
    pg.goto(URL)
    pg.wait_for_selector("#main")
    pg.wait_for_timeout(400)          # 等 navigator.locks 回呼
    return pg


def raw(pg):
    return pg.evaluate("localStorage.getItem(window.G5Core.LS_KEY)")


def banner(pg):
    return pg.inner_text("#banners")


def start(pg):
    btn = pg.query_selector("#goAll")
    if not btn:
        return False
    btn.click()
    pg.wait_for_timeout(300)
    return True


def main():
    with sync_playwright() as p:
        for name in ("chromium", "webkit"):
            browser = getattr(p, name).launch()
            ctx = browser.new_context(viewport={"width": 1024, "height": 900})
            errors = []
            a = page_of(ctx, errors)
            b = page_of(ctx, errors)
            check(f"{name} ① A 頁沒有唯讀提示", RO not in banner(a), banner(a))
            check(f"{name} ② B 頁顯示唯讀提示", RO in banner(b), banner(b))
            before = raw(a)
            pressed_b = start(b)
            check(f"{name} ② B 頁按開始＝存檔逐字不變", pressed_b and raw(b) == before, (pressed_b, before, raw(b)))
            b.click("#home") if b.query_selector("#home") else b.goto(URL)
            b.wait_for_timeout(300)
            pressed_a = start(a)
            after_a = raw(a)
            check(f"{name} ① A 頁按開始＝寫進存檔", pressed_a and after_a is not None and after_a != before, (pressed_a, before, after_a))
            a.close()
            b.wait_for_timeout(800)
            check(f"{name} ③ 關掉 A：B 接手、唯讀提示消失", RO not in banner(b), banner(b))
            b.goto(URL)                   # 回首頁重新開始（同一頁重新載入＝重新拿寫入權）
            b.wait_for_selector("#main")
            b.wait_for_timeout(400)
            check(f"{name} ③ B 重新載入後可寫、A 寫的回合還在", RO not in banner(b) and raw(b) == after_a, (banner(b), after_a == raw(b)))
            check(f"{name} ④ 沒有 JS 錯誤", not errors, errors)
            browser.close()
    bad = results.count(False)
    print(f"{len(results) - bad}/{len(results)} PASS" if not bad else f"{bad} FAIL")
    sys.exit(1 if bad else 0)


if __name__ == "__main__":
    main()
