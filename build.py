#!/usr/bin/env python3
"""（2026-10-13 由數學站 g5-math-review fd585e3 複製；只改主畫面標題）
把 src/app.html（Artifact 格式：沒有 doctype/head）包成可直接開啟的 index.html。

為什麼分兩份：同一份內容可以發成 claude.ai Artifact，也可以放 GitHub Pages
讓孩子的 iPad 不登入就能開；Pages 需要自己帶 viewport 與 noindex。
"""
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent
HEAD = ('<!doctype html><html lang="zh-Hant"><head><meta charset="utf-8">'
        '<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">'
        '<meta name="robots" content="noindex,nofollow">'
        '<link rel="icon" type="image/svg+xml" href="favicon.svg">'
        '<link rel="apple-touch-icon" href="apple-touch-icon.png">'
        '<meta name="theme-color" content="#1f5f8b">'
        '<meta name="apple-mobile-web-app-capable" content="yes">'
        '<meta name="apple-mobile-web-app-title" content="社會複習">'
        '</head><body>')


INLINE = re.compile(r"<!--@INLINE (src/[A-Za-z0-9_.-]+\.js)-->")


def inline(body: str) -> str:
    """把 <!--@INLINE src/x.js--> 換成 <script> 內容；核心邏輯（src/core.js）與 node 測試共用同一份檔。"""
    def sub(m: re.Match) -> str:
        js = (ROOT / m.group(1)).read_text(encoding="utf-8")
        if "</script" in js.lower():
            raise SystemExit(f"{m.group(1)} 含 </script，不能內嵌")
        return "<script>\n" + js + "\n</script>"
    out = INLINE.sub(sub, body)
    if "<!--@INLINE" in out:
        raise SystemExit("還有沒換掉的 @INLINE 標記")
    return out


JS_INLINE = re.compile(r"^/\*@INLINE (src/[A-Za-z0-9_.-]+\.js)\*/$", re.M)


def weak_export() -> str:
    """錯題站讀的 weak-export.js（交辦 #4027）：樣板 src/weakexport.js 的 /*@INLINE src/x.js*/ 換成原文。
    題庫組法與判定都是 app 用的同一份 socbank.js／core.js，不另寫第二份。"""
    tpl = (ROOT / "src" / "weakexport.js").read_text(encoding="utf-8")
    out = JS_INLINE.sub(lambda m: (ROOT / m.group(1)).read_text(encoding="utf-8"), tpl)
    if "@INLINE" in out:
        raise SystemExit("weak-export.js 還有沒換掉的 @INLINE 標記")
    return "// 由 build.py 從 src/weakexport.js＋src/socbank.js＋src/core.js 產生，勿手改（交辦 #4027）\n" + out


def main() -> None:
    app_src = (ROOT / "src" / "app.html").read_text(encoding="utf-8")
    body = inline(app_src)
    (ROOT / "index.html").write_text(HEAD + body + "</body></html>", encoding="utf-8")
    print(f"built index.html ({len(body)} chars)")
    we = weak_export()
    (ROOT / "weak-export.js").write_text(we, encoding="utf-8")
    print(f"built weak-export.js ({len(we)} chars)")


if __name__ == "__main__":
    main()
