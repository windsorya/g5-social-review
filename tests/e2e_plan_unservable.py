"""計畫裡做不了的題（#3010；社會站 cf08dd8 的 Codex P1①）＋F4 首頁說法（2026-10-19）。

情境：今天的計畫是改版前排的，含一張現在「不再出新」的題 x（範圍稽核停出或重複題併掉，題目仍在目錄裡）＋兩張可做的題 a、b。
  A ① 首頁寫「今天要練 2 張」（x 不算）；按「開始今天的練習」，存檔裡的回合佇列只有 a、b
  B ② a、b 都做完：首頁大標題「今天能做的卡片都做完了」，並說明有題目「已停出或不在題庫，不用做」，不說「全部完成」
  ③ 頁面沒有 JS 錯誤
自然、數學、國語、社會四站同一支（題庫取法同 tests/e2e_review_no_repeat.py；x＝目錄裡第一張 active 以外的題）。
執行：python3.12 tests/e2e_plan_unservable.py
"""
import json
import subprocess
from pathlib import Path

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parent.parent
URL = (ROOT / "index.html").as_uri()
D = "2026-10-20"
SEED_JS = ("(function(C,all,active,done){var x=all.filter(function(c){return !active[c.id];})[0],ok=all.filter(function(c){return active[c.id];}).slice(0,2);"
           "var s=C.blankState();s.settings.unit3=true;var ids=[x.id,ok[0].id,ok[1].id];"
           "s.days['" + D + "']={planIds:ids,doneIds:[],touched:[],extraDone:false,labRuns:0,teach:0,mood:null};"
           "if(done){ok.forEach(function(c){s.cards[c.id]={seen:1,goodDays:['" + D + "'],blockedDay:null,due:'2026-10-23'};"
           "s.days['" + D + "'].doneIds.push(c.id);s.days['" + D + "'].touched.push(c.id);});}"
           "var e=C.checkState(s,{cards:all,concepts:new Proxy({},{get:function(){return {unit:'1'};}}),figs:{}});"
           "return {key:C.LS_KEY,s:s,x:x.id,ok:[ok[0].id,ok[1].id]};})")


def seed_state(done):
    banks = sorted((ROOT / "src").glob("*bank.js"))
    arg = "true" if done else "false"
    if banks:
        js = ("const C=require('./src/core.js'),B=require('./src/" + banks[0].name + "');const A={};B.CARDS.forEach(c=>{A[c.id]=1;});"
              "console.log(JSON.stringify(" + SEED_JS + "(C,B.ALL_GENERATED||B.ALL_CARDS||B.CARDS,A," + arg + ")));")   # 目錄取法同 app.html 的 BASE_CARDS（數學站叫 ALL_GENERATED）
    else:   # 自然站：目錄＝app.html 的 BASE_CARDS＋bank_extra.js；active＝扣掉 merge.js 併掉的與 retired.js 停出的（同 app.html 的 ACTIVE）
        js = ("const fs=require('fs'),vm=require('vm'),C=require('./src/core.js');const h=fs.readFileSync('src/app.html','utf8');"
              "const grab=(a,b)=>{const i=h.indexOf(a),j=h.indexOf(b,i);if(i<0||j<i)throw new Error('找不到 '+a);return h.slice(i+a.length,j);};"
              "const base=Array.from(vm.runInNewContext('('+grab('var BASE_CARDS = ',';\\nvar ALL_CARDS')+')'));"
              "const M=require('./src/merge.js'),R=require('./src/retired.js');const all=base.concat(require('./src/bank_extra.js'));const A={};all.forEach(c=>{if(!M[c.id]&&!R[c.id])A[c.id]=1;});"
              "console.log(JSON.stringify(" + SEED_JS + "(C,all,A," + arg + ")));")
    return json.loads(subprocess.check_output(["node", "-e", js], cwd=ROOT))


FAILS = []


def check(name, ok, detail=""):
    print(("PASS " if ok else "FAIL ") + name + ("" if ok else f"  ← {detail}"))
    if not ok:
        FAILS.append(name)


def open_page(b, vp, d):
    ctx = b.new_context(viewport=vp)
    pg = ctx.new_page()
    errs = []
    pg.on("pageerror", lambda e: errs.append(str(e)))
    pg.clock.install(time=D + "T19:00:00+08:00")
    pg.add_init_script("if(!sessionStorage.getItem('s')){sessionStorage.setItem('s','1');localStorage.setItem(%s,%s);}"
                       % (json.dumps(d["key"]), json.dumps(json.dumps(d["s"]))))
    pg.goto(URL, wait_until="domcontentloaded")
    pg.wait_for_selector("#main")
    return ctx, pg, errs


def main():
    a, b_done = seed_state(False), seed_state(True)
    with sync_playwright() as p:
        for eng, vp in ((p.chromium, {"width": 1280, "height": 900}), (p.webkit, {"width": 820, "height": 1180}), (p.chromium, {"width": 390, "height": 844})):
            br = eng.launch()
            tag = f"{eng.name} {vp['width']}px"
            ctx, pg, errs = open_page(br, vp, a)
            home = pg.inner_text("#main")
            pg.get_by_role("button", name="開始今天的練習").first.click()
            pg.wait_for_selector("#main .q")
            q = json.loads(pg.evaluate(f"localStorage.getItem({json.dumps(a['key'])})"))["session"]["queue"]
            check(f"{tag} ① 首頁「今天要練 2 張」；回合佇列只有可做的兩張、沒有不再出的 {a['x']}", "今天要練 2 張" in home and sorted(q) == sorted(a["ok"]), (home[:80], q))
            check(f"{tag} ③ 沒有 JS 錯誤（A）", not errs, errs)
            ctx.close()
            ctx, pg, errs = open_page(br, vp, b_done)
            home = pg.inner_text("#main")
            check(f"{tag} ② 能做的做完：大標題「今天能做的卡片都做完了」、說明已停出或不在題庫、不說全部完成",
                  "今天能做的卡片都做完了" in home and "已停出或不在題庫" in home and "全部完成" not in home and "今天的卡片都做完了" not in home, home[:200])
            check(f"{tag} ③ 沒有 JS 錯誤（B）", not errs, errs)
            ctx.close()
            br.close()
    print(f"\n{'ALL PASS' if not FAILS else str(len(FAILS)) + ' FAIL'}")
    return 1 if FAILS else 0


if __name__ == "__main__":
    raise SystemExit(main())
