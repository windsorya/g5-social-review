#!/usr/bin/env python3
"""父版補做存檔的真瀏覽器驗收（Codex 審 0f3f4f68 第 1 項，#2505；同國語站 #2498、數學站 #2500、自然站 #2502）。

逐題歸屬那三版（aa7a05a／f3ed703／a9a0882，2026-10-14 10:45–11:52 在線上）寫出的補做存檔，
現行版原本整份判成壞檔：頁首「存檔讀不出來」、不存任何作答、設定區只剩「清除壞掉的存檔，重新開始」。
存檔用當時的核心原封不動跑出來（tests/legacy_makeup_states.js，題庫換成本站頁面上的題庫），放進 localStorage 後開頁：
  ① 三版 × 補做剛開／答 1 題／做完：都沒有壞檔提示、沒有清除按鈕
  ② 補做剛開：日曆下有「補做 10/13」，按了真的開補做回合
  ③ 答 1 題（三版）：首頁有「繼續補做 10/13」，做完顯示「10/13 補做完成」、不說「這一天已經練過了」
  ④ 做完：不再列「補做 10/13」、日曆 13 號是補做色；開一段小考複習寫得進去、存檔變 v4
  每段都驗沒有 JS 錯誤。執行：python3.12 tests/e2e_legacy_makeup.py [--base https://windsorya.github.io/g5-social-review/]
"""
import json
import subprocess
import sys
import tempfile
from pathlib import Path

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parent.parent
BASE = sys.argv[sys.argv.index("--base") + 1].rstrip("/") + "/" if "--base" in sys.argv else ROOT.as_uri() + "/"
URL = BASE + "index.html"
NOW = "2026-10-14T20:00:00+08:00"
DAY = "2026-10-13"
KEY = "g5soc.v1"
results = []
# 社會站題庫在 window.G5SocBank：CARDS＝能排成新卡的題（停出題不在內）；再濾掉考不到的題（RETIRED kind:"out"，核心讀 BANK.out）。
# 只給父版核心「現在還會出」的題，免得父版排進現行版不出的題、讀進來後回合被篩空（自然站 #2502 坑）
SRC_JS = """(() => { const B = window.G5SocBank, R = B.RETIRED || window.G5_RETIRED || {}, c = {};
  Object.keys(B.CONCEPTS).forEach((k) => { c[k] = { unit: B.CONCEPTS[k].unit }; });
  return { cards: B.CARDS.filter((x) => !(R[x.id] && R[x.id].kind === "out")), concepts: c, figs: {} }; })()"""


def check(name, ok, info=""):
    results.append(bool(ok))
    print(("PASS " if ok else "FAIL ") + name + ("" if ok else "  ← " + str(info)[:300]))


def open_page(browser, state=None):
    ctx = browser.new_context(viewport={"width": 1024, "height": 900})
    page = ctx.new_page()
    errors = []
    page.on("pageerror", lambda e: errors.append(str(e)))
    page.clock.install(time=NOW)
    if state is not None:
        page.add_init_script("if(!sessionStorage.getItem('seeded')){sessionStorage.setItem('seeded','1');localStorage.setItem(%s,%s);}"
                             % (json.dumps(KEY), json.dumps(json.dumps(state))))
    page.goto(URL)
    page.wait_for_selector("#main .btn, #main .done")
    page.wait_for_timeout(300)   # 單一寫入分頁：等 navigator.locks 回呼
    return ctx, page, errors


def disk(page):
    return json.loads(page.evaluate("localStorage.getItem(%s)" % json.dumps(KEY)) or "null")


def answer_any(page, answers):
    """答對目前這題（存檔 queue[0] 就是畫面上這題）；答錯會進補救、題數會變，這裡一律答對。"""
    if page.locator("#main .opt").count():
        cid = disk(page)["session"]["queue"][0]
        page.locator(f'#main .opt[data-i="{answers.get(cid, 0)}"]').click()
    elif page.locator("#main .blank").count():   # 概念圖題：點開每個空格再自評
        for b in page.locator("#main .blank").all():
            b.click()
        page.locator("#grade button[data-g='1']").click()
    else:
        page.locator("#reveal").click(); page.locator("#selfGrade button").first.click()
    if page.locator("#errq").count():
        page.locator("#errq button[data-k='']").click()


def main():
    with sync_playwright() as p:
        browser = p.chromium.launch()
        ctx, page, _ = open_page(browser)
        bank = page.evaluate(SRC_JS)
        ctx.close()
        answers = {c["id"]: c.get("a", 0) for c in bank["cards"] if c.get("type") == "choice"}
        with tempfile.NamedTemporaryFile("w", suffix=".json", delete=False, encoding="utf-8") as f:
            json.dump(bank, f, ensure_ascii=False)
        legs = json.loads(subprocess.run(["node", str(ROOT / "tests" / "legacy_makeup_states.js"), f.name],
                                         check=True, capture_output=True, text=True).stdout)
        Path(f.name).unlink()
        check("前置：三版 × 三階段共 9 份父版存檔、父版自己都驗得過、都是 kind:plan＋makeup",
              len(legs) == 9 and all(x["oldErrors"] == [] and x["state"]["session"]["kind"] == "plan" for x in legs), [(x["version"], x["stage"], x["oldErrors"]) for x in legs])

        for x in legs:
            tag = f'{x["version"]} {x["stage"]}'
            ctx, page, errors = open_page(browser, x["state"])
            body = page.inner_text("body")
            check(f"① {tag}：沒有「存檔讀不出來」、沒有清除按鈕", "存檔讀不出來" not in body and page.locator("#discard").count() == 0, body[:200])
            if x["stage"] == "opened":
                b = page.locator(f"#makeup button[data-mk='{DAY}']")
                check(f"② {tag}：日曆下有「補做 10/13」", b.count() == 1, page.inner_text("#makeup")[:200])
                if b.count():
                    b.click(); page.wait_for_timeout(200)
                se = (disk(page) or {}).get("session") or {}
                check(f"② {tag}：按了真的開補做回合、存檔寫成 v4", se.get("makeup") == DAY and se.get("kind") == "review" and len(se.get("queue") or []) > 0 and disk(page)["v"] == 4, json.dumps(se, ensure_ascii=False)[:200])
            elif x["stage"] == "one":   # 三版都測（國語站 Codex 審 9baf334 F2：只測最後一版會漏掉最早那版 aa7a05a 沒寫 madeUp）
                go = page.locator("#goOn")
                check(f"③ {tag}：首頁有「繼續補做 10/13」", go.count() == 1 and "繼續補做 10/13" in go.inner_text(), page.inner_text("#main")[:200])
                if go.count():
                    go.click()
                    for _ in range(40):
                        if "補做完成" in page.inner_text("#main") or not page.locator("#main .q").count():
                            break
                        answer_any(page, answers)
                        nx = page.locator("#next")
                        if nx.count():
                            nx.first.click()
                end = page.inner_text("#main")
                check(f"③ {tag}：做完顯示「10/13 補做完成」、沒有「這一天已經練過了」", "10/13 補做完成" in end and "已經練過了" not in end, end[:200])
            elif x["stage"] == "done":
                check(f"④ {tag}：不再列「補做 10/13」", page.locator(f"#makeup button[data-mk='{DAY}']").count() == 0, page.inner_text("#makeup")[:200])
                cal = page.locator("#cal i[title^='10/13']")   # 補做過的格子標題是「10/13（補做）」
                cls = cal.first.get_attribute("class") if cal.count() else ""
                check(f"④ {tag}：日曆 13 號是補做色（on mk）", "on" in (cls or "") and "mk" in (cls or ""), cls)
                rv = page.locator("button[data-rv]").first
                if rv.count():
                    rv.click(); page.wait_for_timeout(200)
                    seg = page.locator("#main button", has_text="練一段")
                    if not page.locator("#main .q").count() and seg.count():
                        seg.first.click(); page.wait_for_timeout(200)
                d = disk(page) or {}
                se = d.get("session") or {}
                check(f"④ {tag}：開一段小考複習寫得進去（不是補做回合、存檔 v4）", d.get("v") == 4 and not se.get("makeup") and len(se.get("queue") or []) > 0, json.dumps(se, ensure_ascii=False)[:200])
            check(f"{tag} 沒有 JS 錯誤", not errors, errors)
            ctx.close()
        browser.close()
    print("%d/%d PASS" % (sum(results), len(results)))
    return 0 if all(results) else 1


if __name__ == "__main__":
    sys.exit(main())
