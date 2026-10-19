"""單元、安親班卷、闖關不再重出做過的題（2026-10-19 律師：「為何用單元方式測驗，每次都要重頭做，為何已做過的題目還要做？」
「已經用其他方式做過的題目（比如闖關或每日模式），能否不用再重複做？」）。

情境（存檔用真題庫＋core.reduce 造，等同她在別的模式做過）：第一個觀念的第 1–4 題——昨天答對、昨天答錯、今天答錯、今天答對。
  ① 首頁那個單元寫「練過 4／N 題・還沒做 N-4 題・待加強 2 題」，「練一段」只算沒做過的，「練待加強的 1 題」（今天答錯的那題今天不再出）
  ② 按「練一段」：這一段沒有任何做過的題
  ③ 按「練待加強的」：只出昨天答錯那 1 題
  ④ 觀念頁「直接闖關：還有 n-4 題沒做」，按下去也沒有做過的題；有「練待加強的 1 題」、沒有重複的「練這個觀念的全部」
  ⑤ 一個觀念每題都做過：觀念頁寫「這一站每題都做過了」、沒有闖關鈕
  ⑥ 頁面沒有 JS 錯誤
  ⑦ 「考前全部再練一遍」（律師 10-19 同意保留、要自己按）：做過的也出，但今天練過的不出；作答畫面標籤寫明是哪一種
自然、數學、國語、社會四站同一支（題庫取法同 tests/e2e_map_rule.py）。執行：python3.12 tests/e2e_review_no_repeat.py
"""
import json
import subprocess
from pathlib import Path

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parent.parent
URL = (ROOT / "index.html").as_uri()
Y, D = "2026-10-19", "2026-10-20"
SEED_JS = ("(function(C,cards,cons,all){var c0=Object.keys(cons)[0],cs=cards.filter(function(c){return c.concept===c0;});"
           "var B={cards:cards,concepts:cons,figs:{}},s=C.blankState(),n=0;s.settings.unit3=true;"
           "var go=function(d,id,ok){var r=C.reduce(s,{type:'answer',id:'seed'+(++n),cardId:id,ok:ok},{bank:B,now:Date.parse(d+'T12:00:00+08:00')});"
           "if(r.error)throw new Error(r.error);s=r.state;};"
           "if(all)cs.forEach(function(c){go('" + Y + "',c.id,true);});"
           "else{go('" + Y + "',cs[0].id,true);go('" + Y + "',cs[1].id,false);go('" + D + "',cs[2].id,false);go('" + D + "',cs[3].id,true);}"
           "return {key:C.LS_KEY,s:s,cid:c0,unit:cons[c0].unit,n0:cs.length,seeded:cs.slice(0,4).map(function(c){return c.id;})};})")


def seed_state(all_done=False):
    banks = sorted((ROOT / "src").glob("*bank.js"))
    arg = "true" if all_done else "false"
    if banks:
        js = ("const C=require('./src/core.js'),B=require('./src/" + banks[0].name + "');"
              "console.log(JSON.stringify(" + SEED_JS + "(C,B.CARDS,B.CONCEPTS," + arg + ")));")
    else:   # 自然站：題庫＝app.html 的 BASE_CARDS＋src/bank_extra.js，扣掉 src/merge.js 合併掉的（同 tests/e2e_map_rule.py）
        js = ("const fs=require('fs'),vm=require('vm'),C=require('./src/core.js');const h=fs.readFileSync('src/app.html','utf8');"
              "const grab=(a,b)=>{const i=h.indexOf(a),j=h.indexOf(b,i);if(i<0||j<i)throw new Error('找不到 '+a);return h.slice(i+a.length,j);};"
              "const base=Array.from(vm.runInNewContext('('+grab('var BASE_CARDS = ',';\\nvar ALL_CARDS')+')'));"
              "const M=require('./src/merge.js');const cards=base.concat(require('./src/bank_extra.js')).filter(c=>!M[c.id]);"
              "const cons=vm.runInNewContext('('+grab('var CONCEPTS = ',';\\nvar CIDS')+')');"
              "console.log(JSON.stringify(" + SEED_JS + "(C,cards,cons," + arg + ")));")
    return json.loads(subprocess.check_output(["node", "-e", js], cwd=ROOT))


FAILS = []


def check(name, ok, detail=""):
    print(("PASS " if ok else "FAIL ") + name + ("" if ok else f"  ← {detail}"))
    if not ok:
        FAILS.append(name)


def open_page(eng_b, vp, d):
    ctx = eng_b.new_context(viewport=vp)
    pg = ctx.new_page()
    errs = []
    pg.on("pageerror", lambda e: errs.append(str(e)))
    pg.clock.install(time=D + "T19:00:00+08:00")
    pg.add_init_script("if(!sessionStorage.getItem('s')){sessionStorage.setItem('s','1');localStorage.setItem(%s,%s);}"
                       % (json.dumps(d["key"]), json.dumps(json.dumps(d["s"]))))
    pg.goto(URL, wait_until="domcontentloaded")
    pg.wait_for_selector("#main")
    return ctx, pg, errs


def queue(pg, key):
    return json.loads(pg.evaluate(f"localStorage.getItem({json.dumps(key)})"))["session"]["queue"]


def main():
    d, full = seed_state(), seed_state(True)
    assert d["n0"] >= 5, d["n0"]
    seeded, key, uk = set(d["seeded"]), d["key"], "u" + d["unit"]
    with sync_playwright() as p:
        for eng, vp in ((p.chromium, {"width": 1280, "height": 900}), (p.webkit, {"width": 820, "height": 1180}), (p.chromium, {"width": 390, "height": 844})):
            b = eng.launch()
            tag = f"{eng.name} {vp['width']}px"
            ctx, pg, errs = open_page(b, vp, d)
            row = pg.locator(f'button[data-rv="{uk}"]').locator("xpath=ancestor::div[contains(@class,'rv')][1]")
            txt = row.inner_text()
            total = int(txt.split("（")[1].split(" 題")[0])
            fresh = total - 4
            seg = pg.locator(f'button[data-rv="{uk}"]').inner_text()
            weak = pg.locator(f'button[data-rvweak="{uk}"]')
            check(f"{tag} ① 單元列：練過 4／{total}・還沒做 {fresh}・待加強 2；練一段 {min(20, fresh)} 題；練待加強的 1 題",
                  f"練過 4／{total} 題・還沒做 {fresh} 題・待加強 2 題" in txt and seg == f"練一段 {min(20, fresh)} 題"
                  and weak.count() == 1 and weak.inner_text() == "練待加強的 1 題", (txt, seg, weak.count() and weak.inner_text()))
            pg.locator(f'button[data-rv="{uk}"]').click()
            pg.wait_for_selector("#main .q")
            q = queue(pg, key)
            check(f"{tag} ② 練一段：{len(q)} 題、沒有任何做過的題", len(q) == min(20, fresh) and not (set(q) & seeded), (len(q), sorted(set(q) & seeded)))
            pg.reload(); pg.wait_for_selector("#main")
            pg.locator(f'button[data-rvweak="{uk}"]').click()
            pg.wait_for_selector("#main .q")
            q = queue(pg, key)
            check(f"{tag} ③ 練待加強的：只出昨天答錯那 1 題", q == [d["seeded"][1]], q)
            pg.reload(); pg.wait_for_selector("#main")
            pg.locator(f'button[data-rvagain="{uk}"]').click()
            pg.wait_for_selector("#main .q")
            q = queue(pg, key)
            head = pg.locator("#main .qhead").first.inner_text()
            check(f"{tag} ⑦ 考前全部再練一遍：一段 {min(20, total - 2)} 題、今天練過的 2 題不出、標籤寫明", len(q) == min(20, total - 2)
                  and not (set(q) & {d["seeded"][2], d["seeded"][3]}) and "全部再練一遍" in head, (len(q), head))
            pg.reload(); pg.wait_for_selector("#main")
            pg.locator(f'#concepts .ccard[data-cid="{d["cid"]}"]').click()
            pg.wait_for_selector("#cGoRow")
            go = pg.locator("#cGo").inner_text() if pg.locator("#cGo").count() else ""
            cw = pg.locator("#cWeak").inner_text() if pg.locator("#cWeak").count() else ""
            check(f"{tag} ④ 觀念頁：直接闖關：還有 {d['n0'] - 4} 題沒做、練待加強的 1 題、沒有「練這個觀念的全部」",
                  go == f"直接闖關：還有 {d['n0'] - 4} 題沒做" and cw == "練待加強的 1 題" and pg.locator("#cAll").count() == 0, (go, cw))
            pg.locator("#cGo").click()
            pg.wait_for_selector("#main .q")
            q = queue(pg, key)
            check(f"{tag} ④ 闖關：{len(q)} 題、沒有任何做過的題", len(q) == d["n0"] - 4 and not (set(q) & seeded), (len(q), sorted(set(q) & seeded)))
            check(f"{tag} ⑥ 沒有 JS 錯誤", not errs, errs)
            ctx.close()
            ctx, pg, errs = open_page(b, vp, full)
            pg.locator(f'#concepts .ccard[data-cid="{full["cid"]}"]').click()
            pg.wait_for_selector("#cGoRow")
            row = pg.locator("#cGoRow").inner_text()
            check(f"{tag} ⑤ 每題都做過的觀念：寫「這一站每題都做過了」、沒有闖關鈕", "這一站每題都做過了" in row and pg.locator("#cGo").count() == 0, row)
            check(f"{tag} ⑥ 沒有 JS 錯誤（全做過）", not errs, errs)
            ctx.close()
            b.close()
    print(f"\n{'ALL PASS' if not FAILS else str(len(FAILS)) + ' FAIL'}")
    return 1 if FAILS else 0


if __name__ == "__main__":
    raise SystemExit(main())
