/* 探險地圖＋成長圖（2026-10-14 律師：「數學、國語、社會是否也建議比照這種養成機制」→ 建議並實作）
 * 規則與自然站 g5-sci-review/src/map.js 同一份（trail／readSeen／writeSeen／growth 逐字相同，tests/map.test.js 會比對）：
 *   走過一站＝觀念卡到「開花了」以上；一站長一階；階數＝走過站數。差別只在長出來的東西（本站：ART.title）。
 * 純函式：只讀畫面算好的觀念階段（core.js view().stages），不讀不寫作答存檔；「上次看到第幾階」存在獨立 key g5soc.mapSeen。
 */
(function (root) {
  "use strict";
  var SEEN_KEY = "g5soc.mapSeen";
  var BLOOM = 3;
// 三科成長圖（數學蓋房子／國語書架／社會臺灣地圖）。每科：NAMES[0]＝空的、NAMES[n]＝走過 n 站；art(level, part, col)
  var ARTS = {
  math: {
    title: "房子", empty: "一塊空地，走過第一站就打地基",
    NAMES: ["一塊空地", "打好地基", "左邊的牆", "右邊的牆", "裝上門", "左邊窗戶", "右邊窗戶", "加上煙囪", "蓋好屋頂", "圍上籬笆", "種一棵樹", "插上旗子"],
    art: function (level, part, col) {
      var s = '<rect x="0" y="130" width="120" height="20" rx="4" fill="' + col("var(--grass)") + '"/>';
      s += '<path d="M28 130 V122 M92 130 V122 M28 124 H92" stroke="' + col("var(--soil)") + '" stroke-width="2" stroke-dasharray="4 4" fill="none"/>';
      s += part(1, '<rect x="26" y="124" width="68" height="8" rx="2" fill="' + col("var(--muted)") + '"/>');
      s += part(2, '<rect x="32" y="84" width="28" height="40" fill="' + col("var(--sun-soft)") + '" stroke="' + col("var(--soil)") + '" stroke-width="2"/>');
      s += part(3, '<rect x="60" y="84" width="28" height="40" fill="' + col("var(--sun-soft)") + '" stroke="' + col("var(--soil)") + '" stroke-width="2"/>');
      s += part(4, '<rect x="53" y="102" width="14" height="22" rx="2" fill="' + col("var(--soil)") + '"/><circle cx="64" cy="114" r="1.6" fill="' + col("var(--sunball)") + '"/>');
      s += part(5, '<rect x="37" y="92" width="14" height="12" fill="' + col("var(--waterfill)") + '" stroke="' + col("var(--ink)") + '" stroke-width="1.5"/><path d="M44 92 V104 M37 98 H51" stroke="' + col("var(--ink)") + '" stroke-width="1"/>');
      s += part(6, '<rect x="69" y="92" width="14" height="12" fill="' + col("var(--waterfill)") + '" stroke="' + col("var(--ink)") + '" stroke-width="1.5"/><path d="M76 92 V104 M69 98 H83" stroke="' + col("var(--ink)") + '" stroke-width="1"/>');
      s += part(7, '<rect x="74" y="56" width="9" height="22" fill="' + col("var(--soil)") + '"/>');
      s += part(8, '<path d="M24 86 L60 56 L96 86 Z" fill="' + col("var(--red)") + '"/>');
      s += part(9, '<path d="M4 132 V114 M10 132 V114 M16 132 V114 M22 132 V114 M98 132 V114 M104 132 V114 M110 132 V114 M116 132 V114 M2 119 H24 M2 127 H24 M96 119 H118 M96 127 H118" stroke="' + col("var(--soil)") + '" stroke-width="2.4" stroke-linecap="round"/>');
      s += part(10, '<rect x="11" y="86" width="5" height="28" fill="' + col("var(--soil)") + '"/><circle cx="13.5" cy="80" r="12" fill="' + col("var(--leaf)") + '"/>');
      s += part(11, '<path d="M60 56 V30" stroke="' + col("var(--ink)") + '" stroke-width="2"/><path d="M60 30 L78 36 L60 42 Z" fill="' + col("var(--sunball)") + '"/>');
      return s;
    }
  },
  chi: {
    title: "書架", empty: "一個空書架，走過第一站就放上第一本書",
    NAMES: ["空書架", "第 1 本書", "第 2 本書", "第 3 本書", "第 4 本書", "第 5 本書", "第 6 本書", "第 7 本書", "第 8 本書", "第 9 本書", "書架放滿了"],
    art: function (level, part, col) {
      var s = '<rect x="12" y="16" width="96" height="128" rx="4" fill="none" stroke="' + col("var(--soil)") + '" stroke-width="5"/>' +
              '<path d="M12 80 H108" stroke="' + col("var(--soil)") + '" stroke-width="5"/>';
      var X = [18, 36, 54, 72, 90], H = [52, 44, 54, 46, 50], C = ["var(--red)", "var(--pri)", "var(--leaf)", "var(--sunball)", "var(--sun)"];
      for (var i = 0; i < 10; i++) {
        var r = i < 5 ? 0 : 1, k = i % 5, base = r ? 141 : 77, h = H[(k + r * 2) % 5], c = C[(k + r * 3) % 5];
        s += part(i + 1, '<rect x="' + X[k] + '" y="' + (base - h) + '" width="14" height="' + h + '" rx="2" fill="' + col(c) + '"/>' +
                          '<path d="M' + (X[k] + 3) + ' ' + (base - h + 8) + ' H' + (X[k] + 11) + '" stroke="' + col("var(--card)") + '" stroke-width="2"/>');
      }
      return s;
    }
  },
  soc: {
    title: "臺灣地圖", empty: "一張還沒點亮的臺灣地圖，走過第一站就點亮最北邊",
    NAMES: ["還沒點亮的臺灣地圖", "點亮第 1 塊", "點亮第 2 塊", "點亮第 3 塊", "點亮第 4 塊", "點亮第 5 塊", "點亮第 6 塊", "點亮第 7 塊", "整個臺灣都亮了"],
    art: function (level, part, col) {
      // 主島海岸線（經緯度概略點，由北往東、南、西繞一圈）；投影 x=(lon-119.95)*41+10、y=(25.35-lat)*41*1.1+3
      var P = [[121.54,25.30],[121.69,25.21],[121.75,25.15],[121.92,25.13],[122.00,25.01],[121.83,24.86],[121.86,24.60],[121.80,24.45],[121.66,24.20],[121.62,23.98],[121.52,23.60],[121.38,23.10],[121.20,22.88],[121.15,22.75],[121.00,22.60],[120.90,22.34],[120.88,22.20],[120.86,21.90],[120.73,21.93],[120.70,22.00],[120.71,22.08],[120.65,22.26],[120.59,22.37],[120.45,22.46],[120.38,22.50],[120.27,22.62],[120.18,22.88],[120.15,23.00],[120.08,23.15],[120.11,23.27],[120.15,23.38],[120.15,23.46],[120.17,23.58],[120.25,23.80],[120.30,23.96],[120.40,24.07],[120.50,24.27],[120.58,24.38],[120.62,24.43],[120.67,24.50],[120.77,24.62],[120.85,24.70],[120.92,24.83],[121.00,24.93],[121.10,25.05],[121.30,25.12],[121.40,25.18],[121.52,25.29]];
      var d = P.map(function (p, i) { return (i ? "L" : "M") + ((p[0] - 119.95) * 41 + 10).toFixed(1) + " " + ((25.35 - p[1]) * 41 * 1.1 + 3).toFixed(1); }).join(" ") + " Z";
      var top = (25.35 - 25.30) * 41 * 1.1 + 3, bot = (25.35 - 21.90) * 41 * 1.1 + 3, bh = (bot - top) / 8;
      var id = "tw" + Math.random().toString(36).slice(2, 8);
      var s = '<defs><clipPath id="' + id + '"><path d="' + d + '"/></clipPath></defs>' +
              '<path d="' + d + '" fill="' + col("var(--leaf-soft)") + '"/>';
      for (var i = 0; i < 8; i++)
        s += part(i + 1, '<rect x="0" y="' + (top + i * bh - 0.5).toFixed(1) + '" width="120" height="' + (bh + 1).toFixed(1) + '" fill="' + col("var(--leaf)") + '" clip-path="url(#' + id + ')"/>');
      s += '<path d="' + d + '" fill="none" stroke="' + col("var(--leaf)") + '" stroke-width="2" stroke-linejoin="round"/>';
      return s;
    }
  }
};

  var ART = ARTS.soc;
  var PLANT = ART.NAMES;
  var MAX = PLANT.length - 1;

  // o.cids：觀念依程式順序；o.stages：{cid: 0–4}；o.on(cid)：這個觀念開放了沒（未開放＝鎖頭、不算分母）
  function trail(o) {
    var stations = o.cids.map(function (cid, i) {
      var on = !!o.on(cid), st = (o.stages && o.stages[cid]) || 0;
      return { cid: cid, n: i + 1, on: on, done: on && st >= BLOOM, now: false };
    });
    var first = stations.filter(function (s) { return s.on && !s.done; })[0];
    if (first) first.now = true;
    var total = stations.filter(function (s) { return s.on; }).length;
    var walked = stations.filter(function (s) { return s.done; }).length;
    var locked = stations.length - total;
    return {
      stations: stations, walked: walked, total: total, left: total - walked, locked: locked,
      level: Math.min(walked, MAX),
      allDone: stations.length > 0 && locked === 0 && walked === stations.length
    };
  }

  function readSeen(storage) {
    try {
      var v = storage.getItem(SEEN_KEY);
      if (typeof v !== "string" || !/^(0|[1-9][0-9]?)$/.test(v)) return null;   // 只認自己寫的整數（0–99，不帶前導零）；空字串、小數、負數都當沒有（2026-10-14 Codex：數學 11 階、國語 10 階，一位數判準讀不回第 10、11 階）
      var n = Number(v);
      return n <= MAX ? n : null;
    } catch (e) { return null; }
  }
  function writeSeen(storage, n) {
    try { storage.setItem(SEEN_KEY, String(n)); return true; } catch (e) { return false; }
  }
  // 本次比上次看到的大才長大；沒看過當 0（第一次打開也看得到它長出來）；變小（重新開始）不動畫
  function growth(seen, level, allDone) {
    var prev = seen === null || seen === undefined ? 0 : seen;
    var grow = level > prev;
    return { grow: grow, celebrate: !!allDone && grow };
  }

  // 成長圖 SVG（不用 emoji）。ghost＝下一階的灰色剪影；fresh＝這一階新長出來的部位加 class="newpart"（給長大動畫）
  function plantSvg(level, opts) {
    opts = opts || {};
    var ghost = !!opts.ghost, fresh = !!opts.fresh;
    level = Math.max(0, Math.min(MAX, level));
    function col(c) { return ghost ? "var(--muted)" : c; }
    function part(from, svg) {
      if (level < from) return "";
      return fresh && level === from && !ghost ? '<g class="newpart">' + svg + "</g>" : svg;
    }
    return '<svg class="' + (ghost ? "ghost" : "pl") + '" viewBox="0 0 120 150" role="img" aria-label="' + (ghost ? "下一階還看不出來" : ART.title + "：" + PLANT[level]) + '"' +
      (ghost ? ' opacity=".4"' : "") + ">" + ART.art(level, part, col) + "</svg>";
  }

  var api = { SEEN_KEY: SEEN_KEY, BLOOM: BLOOM, PLANT: PLANT, TITLE: ART.title, EMPTY: ART.empty, trail: trail, readSeen: readSeen, writeSeen: writeSeen, growth: growth, plantSvg: plantSvg };
  if (typeof module !== "undefined" && module.exports) module.exports = api; else root.G5Map = api;
})(typeof window !== "undefined" ? window : this);
