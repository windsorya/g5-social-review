"""探險地圖放書規則（2026-10-14 律師轉述孩子問「達成什麼條件才能放一本書」→「直接完成關卡題目，就過那一關放一本書」）。

情境：存檔裡第一站（第一個觀念）的題目每題都做過一次、第二站只做過 2 題，完全沒有考出口題（沒有開花）。
  ① 首頁地圖寫「走過 1 站」，書架是第 1 階（第 1 本書）
  ② 第一站標放好了（國語「放了一本書」；寬版靠打勾），第二站標「做過 2／N 題」（N＝第二站題數）
  ③ 地圖上有放書規則的說明
  ④ 頁面沒有 JS 錯誤
自然、數學、國語、社會四站同一支：題庫檔自動找 src/*bank.js；自然站題庫寫在 app.html 裡，改從 app.html＋bank_extra.js＋merge.js 組出來
（第三單元開關打開，其他三站不受影響）；放書（長大）說明讀頁面上的 G5Map.RULE／DONE。
執行：python3.12 tests/e2e_map_rule.py（Chromium 桌機、WebKit iPad、Chromium 手機三種尺寸）
"""
import json
import subprocess
import sys
from pathlib import Path

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parent.parent
URL = (ROOT / "index.html").as_uri()
# 造存檔：第一站的卡片全部做過一次、第二站做過 2 張；不碰出口題。node 與瀏覽器共用同一段（ES5，兩邊都能跑）
SEED_JS = ("(function(C,cards,ids){var s=C.blankState();s.settings.unit3=true;"
           "var card=function(){return {seen:1,goodDays:['2026-10-14'],blockedDay:null,due:'2026-10-15'};};"
           "var c1=cards.filter(function(c){return c.concept===ids[0];}),c2=cards.filter(function(c){return c.concept===ids[1];});"
           "c1.forEach(function(c){s.cards[c.id]=card();});c2.slice(0,2).forEach(function(c){s.cards[c.id]=card();});"
           "return {key:C.LS_KEY,s:s,ids:ids,n2:c2.length};})")


def seed_state():
    banks = sorted((ROOT / "src").glob("*bank.js"))
    if banks:
        js = ("const C=require('./src/core.js'),B=require('./src/" + banks[0].name + "');"
              "console.log(JSON.stringify(" + SEED_JS + "(C,B.CARDS,Object.keys(B.CONCEPTS))));")
    else:   # 自然站：題庫＝app.html 的 BASE_CARDS＋src/bank_extra.js，扣掉 src/merge.js 合併掉的（同 app.html 的 BANK；抽法同 tests/bank.test.js）
        js = ("const fs=require('fs'),vm=require('vm'),C=require('./src/core.js');const h=fs.readFileSync('src/app.html','utf8');"
              "const grab=(a,b)=>{const i=h.indexOf(a),j=h.indexOf(b,i);if(i<0||j<i)throw new Error('找不到 '+a);return h.slice(i+a.length,j);};"
              "const base=Array.from(vm.runInNewContext('('+grab('var BASE_CARDS = ',';\\nvar ALL_CARDS')+')'));"
              "const M=require('./src/merge.js');const cards=base.concat(require('./src/bank_extra.js')).filter(c=>!M[c.id]);"
              "const ids=Object.keys(vm.runInNewContext('('+grab('var CONCEPTS = ',';\\nvar CIDS')+')'));"
              "console.log(JSON.stringify(" + SEED_JS + "(C,cards,ids)));")
    return json.loads(subprocess.check_output(["node", "-e", js], cwd=ROOT))


FAILS = []


def check(name, ok, detail=""):
    print(("PASS " if ok else "FAIL ") + name + ("" if ok else f"  ← {detail}"))
    if not ok:
        FAILS.append(name)


def main():
    url = URL
    total = 0
    d = seed_state()
    with sync_playwright() as p:
        init = ("if(!sessionStorage.getItem('s')){sessionStorage.setItem('s','1');localStorage.setItem(%s,%s);}"
                % (json.dumps(d["key"]), json.dumps(json.dumps(d["s"]))))
        for eng, vp in ((p.chromium, {"width": 1280, "height": 900}), (p.webkit, {"width": 820, "height": 1180}), (p.chromium, {"width": 390, "height": 844})):
            b = eng.launch()
            pg = b.new_page(viewport=vp)
            phone = vp["width"] <= 700   # 手機版一站一行，寫完整說法；寬版一列 7 站，寫短的「2／10 題」、放了書的站靠打勾
            errs = []
            pg.on("pageerror", lambda e: errs.append(str(e)))
            pg.add_init_script(init)
            pg.goto(url)
            pg.wait_for_selector("#mapBox .stn")
            head = pg.locator("#mapCount").inner_text()
            label = pg.locator("#mapPlant svg.pl").get_attribute("aria-label") or ""
            tag = f"{eng.name} {vp['width']}px"
            lv1 = pg.evaluate("G5Map.TITLE+'：'+G5Map.PLANT[1]")
            check(f"{tag} ① 第一站做完、沒考出口題：走過 1 站、成長圖第 1 階（{lv1}）", head.startswith("走過 1 站") and label == lv1, (head, label))
            st1 = pg.locator(f'#mapBox .stn[data-cid="{d["ids"][0]}"]')
            s1, s2 = st1.inner_text(), pg.locator(f'#mapBox .stn[data-cid="{d["ids"][1]}"]').inner_text()
            if phone:
                done = pg.evaluate("G5Map.DONE")
                check(f"{tag} ② 第一站標「{done}」、第二站標「做過 2／{d['n2']} 題」", bool(done) and done in s1 and f"做過 2／{d['n2']} 題" in s2, (s1, s2))
            else:
                check(f"{tag} ② 第一站打勾（done）、第二站標「2／{d['n2']} 題」", "done" in (st1.get_attribute("class") or "") and f"2／{d['n2']} 題" in s2, (s1, s2))
            rule = pg.locator("#mapRule").inner_text() if pg.locator("#mapRule").count() else ""
            check(f"{tag} ③ 地圖寫出放書規則", "每一題都做過一次" in rule and rule == pg.evaluate("G5Map.RULE"), rule)
            # ④ 站與站不重疊：量每一站「文字實際畫出來的範圍」——逐個文字節點取字形外框（溢出外框的字也算；
            #    不能整個元素一起量：撐滿一欄的方框也會被算進去，相鄰兩站永遠量成剛好相接），左右不能壓到同一列的下一站
            boxes = pg.evaluate("""Array.from(document.querySelectorAll('#mapBox .stn')).map(e=>{
              const w=document.createTreeWalker(e,NodeFilter.SHOW_TEXT);let L=1e9,R=-1e9,n;
              while((n=w.nextNode())){if(!n.textContent.trim())continue;const g=document.createRange();g.selectNodeContents(n);
                for(const r of g.getClientRects()){if(r.width>0){L=Math.min(L,r.left);R=Math.max(R,r.right);}}}
              return [Math.round(e.getBoundingClientRect().top),L,R,e.dataset.cid||'goal'];})""")
            over = [(a[3], b2[3], round(a[2] - b2[1], 1)) for a, b2 in zip(boxes, boxes[1:]) if abs(a[0] - b2[0]) < 5 and a[2] > b2[1] - 2]
            check(f"{tag} ④ 同一列的站名、進度不互相重疊", not over, over[:3])
            # ⑥ 2026-10-14 律師（孩子要「直接闖關」）：點地圖的站 → 觀念頁標題下面、說明之前就有「直接闖關」，按下去開始這一站全部題目
            pg.locator(f'#mapBox .stn[data-cid="{d["ids"][1]}"]').click()
            pg.wait_for_selector("#cGo")
            gy = pg.locator("#cGo").bounding_box()["y"]
            ey = pg.locator("#main .remedy").first.bounding_box()["y"] if pg.locator("#main .remedy").count() else 1e9
            pg.locator("#cGo").click()
            pg.wait_for_selector("#main .q")
            qh = pg.locator("#main .qhead").inner_text()
            check(f"{tag} ⑥ 觀念頁說明之前就有「直接闖關」，按下去開始這站全部 {d['n2']} 題", gy < ey and f"1 / {d['n2']}" in qh, (gy, ey, qh[-24:]))
            check(f"{tag} ⑤ 頁面沒有 JS 錯誤", not errs, errs)
            total += 6
            b.close()
    print(f"{total - len(FAILS)}/{total} PASS")
    return 1 if FAILS else 0


if __name__ == "__main__":
    sys.exit(main())
