"""探險地圖：從 #c/<觀念> 連結開頁時，首頁背景畫的那一次不得把「看過第幾階」記掉（Codex 審 g5-social-review 8066e66）。

情境：存檔裡前 N 站都開花、mapSeen 還沒有 → 以 #c/<第一個觀念> 開頁（首頁先畫一次就立刻切觀念頁）；沒有 #c/ 觀念連結的站（自然站）只驗 ③
  ① 1.5 秒後 mapSeen 仍是空的（孩子沒看到長大動畫，不能算看過）
  ② 回首頁（清掉 hash）→ 地圖看得到、正在播長大動畫、mapSeen 才寫成 N
  ③ 對照：直接開首頁 → 動畫播完後 mapSeen＝N（一般路徑不受影響）
四站同一支（g5-sci／math／chinese／social-review 各放一份）。執行：python3.12 tests/e2e_map_deeplink.py
"""
import json
import subprocess
import sys
from pathlib import Path

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parent.parent
SCI_ORDER = ["1-1", "1-3", "1-2", "2-1", "2-2", "2-3", "3-1"]   # 自然站觀念在 app.html，程式順序同 tests/map.test.js


def seed_state():
    bank = next((f.stem for f in (ROOT / "src").glob("*bank.js")), None)
    js = ("const C=require('./src/core.js');const s=C.blankState();"
          + (f"const ids=Object.keys(require('./src/{bank}.js').CONCEPTS);" if bank else f"const ids={json.dumps(SCI_ORDER)};s.settings.unit3=true;")
          + "ids.forEach(c=>{s.exits[c]={status:'pass',due:null,opened:'2026-10-13',last:'2026-10-13'};});"
          + "const k=require('./src/map.js').SEEN_KEY;console.log(JSON.stringify({key:C.LS_KEY,seen:k,s,ids}));")
    return json.loads(subprocess.check_output(["node", "-e", js], cwd=ROOT))


FAILS, DONE = [], []
# 本站有沒有 #c/ 觀念連結（開頁時 openFromHash 切到觀念頁）。自然站沒有這個功能（src/app.html 的地圖註解也寫「沒有 #c/ 連結的站
# （自然站）沒有 booted，這段不作用」）⇒ ①② 不適用，只驗 ③（2026-10-14 交辦 #2136：這支 15:03 複製到自然站後 ① 一直失敗，原因在此）
DEEPLINK = "openFromHash" in (ROOT / "src" / "app.html").read_text(encoding="utf-8")


def check(name, ok, detail=""):
    print(("PASS " if ok else "FAIL ") + name + ("" if ok else f"  ← {detail}"))
    DONE.append(name)
    if not ok:
        FAILS.append(name)


def main():
    d = seed_state()
    init = ("if(!sessionStorage.getItem('s')){sessionStorage.setItem('s','1');localStorage.setItem(%s,%s);localStorage.removeItem(%s);}"
            % (json.dumps(d["key"]), json.dumps(json.dumps(d["s"])), json.dumps(d["seen"])))
    n = len(d["ids"])
    url = (ROOT / "index.html").as_uri()
    with sync_playwright() as p:
        for eng in (p.chromium, p.webkit):
            b = eng.launch()
            pg = b.new_page(viewport={"width": 820, "height": 1180})
            errs = []
            pg.on("pageerror", lambda e: errs.append(str(e)))
            pg.add_init_script(init)
            if DEEPLINK:
                pg.goto(url + "#c/" + d["ids"][0])
                pg.wait_for_timeout(1500)
                seen = pg.evaluate(f"localStorage.getItem({json.dumps(d['seen'])})")
                check(f"{eng.name} ① 連結開觀念頁：地圖收著、看過紀錄沒被記掉", pg.locator("#mapBox").is_hidden() and seen is None, seen)
                pg.evaluate("location.hash=''")
                pg.wait_for_timeout(300)
                grow = pg.locator("#mapBox svg.pl.grow").count()
                seen2 = pg.evaluate(f"localStorage.getItem({json.dumps(d['seen'])})")
                check(f"{eng.name} ② 回首頁：地圖出現且播長大動畫，看過紀錄＝{n}", pg.locator("#mapBox").is_visible() and grow == 1 and seen2 == str(n), (grow, seen2))
            else:
                print(f"SKIP {eng.name} ①② 本站沒有 #c/ 觀念連結（src/app.html 沒有 openFromHash），只驗 ③")
            pg.close()
            pg = b.new_page(viewport={"width": 820, "height": 1180})
            pg.on("pageerror", lambda e: errs.append(str(e)))
            pg.add_init_script(init)
            pg.goto(url)
            pg.wait_for_timeout(1800)
            seen3 = pg.evaluate(f"localStorage.getItem({json.dumps(d['seen'])})")
            check(f"{eng.name} ③ 直接開首頁：動畫播完後看過紀錄＝{n}", seen3 == str(n), seen3)
            check(f"{eng.name} 頁面沒有 JS 錯誤", not errs, errs)
            b.close()
    print(f"{len(DONE) - len(FAILS)}/{len(DONE)} PASS" if not FAILS else f"{len(FAILS)} FAIL")
    return 1 if FAILS else 0


if __name__ == "__main__":
    sys.exit(main())
