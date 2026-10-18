#!/usr/bin/env python3
"""補做功能本身的 e2e（2026-10-18 起補做預設關閉，本檔以 localStorage g5.makeupOn=1 打開後測）。
補做 e2e（2026-10-14 律師：「有辦法補做之前沒做的天數嗎」）。數學、國語、社會三站共用同一份（逐字相同）。
真流程：時鐘固定 10/14 晚上、空白紀錄 → 做完今天的卡 → 日曆下方出現「補做 10/13」→ 補完 → 13 號變補做色、連續 2 天。
用 python3.12 執行：python3.12 tests/e2e_makeup.py [--base https://windsorya.github.io/<站>/]"""
import json
import re
import sys
from pathlib import Path

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parent.parent
BASE = sys.argv[sys.argv.index("--base") + 1].rstrip("/") + "/" if "--base" in sys.argv else ROOT.as_uri() + "/"
URL = BASE + "index.html"
KEY = re.search(r'var LS_KEY = "([^"]+)"', (ROOT / "src" / "core.js").read_text(encoding="utf-8")).group(1)
RESULTS = []


def check(name, cond, detail=""):
    RESULTS.append((name, bool(cond)))
    print(("PASS " if cond else "FAIL ") + name + ("" if cond else f"  ← {detail}"))


def answer_and_next(page):
    """隨便作答一題並前進：選擇題按第一個選項、其他題型按顯示答案再自評；答錯選「先跳過」，再按下一題。"""
    if page.locator("#main .opt").count():
        page.locator("#main .opt").first.click()
    elif page.locator("#reveal").count():
        page.locator("#reveal").click(); page.locator("#selfGrade button").first.click()
    if page.locator("#errq").count():
        page.locator("#errq button[data-k='']").click()
    nx = page.locator("#next")
    (nx if nx.count() else page.get_by_role("button", name="下一題").first).click()


def finish(page, done_text):
    for _ in range(60):
        if done_text in page.inner_text("#main"):
            return True
        answer_and_next(page)
    return done_text in page.inner_text("#main")


def flow(browser, label, device=None):
    ctx = browser.new_context(**(device or {}))
    page = ctx.new_page()
    errors = []
    page.on("pageerror", lambda e: errors.append(str(e)))
    page.clock.install(time="2026-10-14T20:00:00+08:00")
    page.add_init_script("localStorage.setItem('g5.makeupOn','1')")   # 補做預設關閉（2026-10-18 縮範圍）；本檔測的是功能本身
    page.goto(URL, wait_until="domcontentloaded")
    page.wait_for_selector("#main .btn, #main .done")
    txt = page.inner_text("#makeup")
    check(f"{label} 補做1 今天還沒做完：說前面 1 天沒練、做完可補，沒有補做按鈕", "1 天沒練" in txt and page.locator("#makeup button").count() == 0, txt)
    page.locator("#goAll").click()
    check(f"{label} 補做2 做完今天的卡", finish(page, "今天的卡片都做完了"), page.inner_text("#main")[:160])
    page.get_by_role("button", name="回首頁").first.click()
    bs = page.locator("#makeup button[data-mk]")
    check(f"{label} 補做3 今天做完：出現「補做 10/13」", bs.count() == 1 and bs.first.inner_text() == "補做 10/13", [b.inner_text() for b in bs.all()])
    today = json.loads(page.evaluate(f"localStorage.getItem('{KEY}')"))["days"]["2026-10-14"]
    bs.first.click()
    check(f"{label} 補做4 題目上方標「補做 10/13」", "補做 10/13" in page.inner_text("#main .qhead"), page.inner_text("#main")[:120])
    answer_and_next(page)
    page.reload(); page.wait_for_selector("#main .btn, #main .done")
    check(f"{label} 補做4b 做到一半重新整理：沒有補做按鈕、說還沒做完、有「繼續補做 10/13」",
          page.locator("#makeup button[data-mk]").count() == 0 and "還沒做完" in page.inner_text("#makeup") and "繼續補做 10/13" in page.inner_text("#main"), (page.inner_text("#makeup"), page.inner_text("#main")[:200]))
    page.get_by_role("button", name="繼續補做 10/13").first.click()
    check(f"{label} 補做5 做完顯示「10/13 補做完成」", finish(page, "10/13 補做完成"), page.inner_text("#main")[:160])
    st = json.loads(page.evaluate(f"localStorage.getItem('{KEY}')"))
    d13 = st["days"]["2026-10-13"]
    check(f"{label} 補做6 存檔：10/13 結算成練過（madeUp＝10/14、touched＝doneIds）、今天計畫不變", len(d13["touched"]) > 0 and d13.get("madeUp") == "2026-10-14" and sorted(d13["touched"]) == sorted(d13["doneIds"]) and st["days"]["2026-10-14"]["planIds"] == today["planIds"], st["days"])
    page.get_by_role("button", name="回首頁").first.click()
    cls = page.locator("#cal i").first.get_attribute("class") or ""
    check(f"{label} 補做7 日曆 13 號變補做色（on mk）、沒有補做按鈕了", "on" in cls and "mk" in cls and page.locator("#makeup button").count() == 0, cls)
    check(f"{label} 補做8 連續練習 2 天", page.inner_text("#streak") == "連續練習 2 天", page.inner_text("#streak"))
    page.reload(); page.wait_for_selector("#main .btn, #main .done")
    check(f"{label} 補做9 重新整理後仍是 2 天、13 號仍是補做色", page.inner_text("#streak") == "連續練習 2 天" and "mk" in (page.locator("#cal i").first.get_attribute("class") or ""))
    check(f"{label} 補做 沒有 JS 錯誤", not errors, errors)
    ctx.close()


def main():
    with sync_playwright() as p:
        cr = p.chromium.launch()
        flow(cr, "桌機", {"viewport": {"width": 1280, "height": 900}})
        flow(cr, "手機390", {"viewport": {"width": 390, "height": 844}, "is_mobile": True, "has_touch": True})
        cr.close()
        wk = p.webkit.launch()
        flow(wk, "iPad", p.devices["iPad (gen 7)"])
        wk.close()
    bad = [r for r in RESULTS if not r[1]]
    print(f"\n{len(RESULTS) - len(bad)}/{len(RESULTS)} PASS")
    sys.exit(1 if bad else 0)


if __name__ == "__main__":
    main()
