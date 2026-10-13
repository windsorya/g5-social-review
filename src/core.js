// g5soc 核心（2026-10-13 由數學站 g5-math-review fd585e3 的 src/core.js 複製；那份又源自自然站 e1aab80，含多分頁 refresh 與 M4/M5 修正）。
// 社會站只改：存檔 key、不搬家的舊 key、診斷期結束日；reducer 與存檔層邏輯一字不動。
// 原註：所有學習狀態只經由 reduce() 改變；畫面只讀 view() 的結果。
// 路徑固定為：操作 → 注入時鐘 → 純 reducer 產生候選狀態 → 驗證不變量 → 寫入成功 → 公布 → 畫面。
// 設計依據：~/scripts/state/autocont/g5-v3-design-spec-20261011.md（方案乙＋30 條驗收矩陣）。
(function (root) {
  "use strict";
  var LS_KEY = "g5soc.v1";    // 同步後端（g5-help/gas/core.js f53bd54）白名單已含這個 key
  var LS_V1 = null;                 // 設計 task-mv6srlue-pujdyl S0：本站沒有舊版存檔——load() 完全不碰舊版或 .fromV1／.noMigrate 標記 key（不讀 getItem(null)／"null"）
  var LS_ARC = LS_V1 === null ? null : LS_V1 + ".archived";   // 只有有舊版的站（自然站）才有封存
  var NEW_PER_DAY = 5;
  var NEW_PER_DAY_DIAG = 10;      // 診斷期：先把各觀念的卡各做一遍
  var DIAG_END = "2026-10-18";   // 社會站預計 10/14 起用：前 4 天（10/14–10/17）每天新卡 10 張
  var MIX_START = "2026-10-26";
  var EXAM = "2026-11-05";        // 期中考日（app.html 的倒數也用這個）
  var OPS_KEEP = 300;              // 去重用的操作 ID；一天最多約百筆操作
  var LOG_KEEP = 600;
  var RUNS_KEEP = 30;
  var TZ_MS = 8 * 3600 * 1000;     // Asia/Taipei，無日光節約

  /* ---------- 日期（一律台北日） ---------- */
  function dayKey(ms) { return new Date(ms + TZ_MS).toISOString().slice(0, 10); }
  function isDay(x) {
    if (typeof x !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(x)) return false;
    var p = x.split("-").map(Number), d = new Date(Date.UTC(p[0], p[1] - 1, p[2]));
    return d.getUTCFullYear() === p[0] && d.getUTCMonth() === p[1] - 1 && d.getUTCDate() === p[2];
  }
  function addDays(k, n) {
    var p = k.split("-").map(Number);
    return new Date(Date.UTC(p[0], p[1] - 1, p[2] + n)).toISOString().slice(0, 10);
  }
  function diffDays(a, b) {
    var pa = a.split("-").map(Number), pb = b.split("-").map(Number);
    return Math.round((Date.UTC(pb[0], pb[1] - 1, pb[2]) - Date.UTC(pa[0], pa[1] - 1, pa[2])) / 86400000);
  }
  function weekday(k) { var p = k.split("-").map(Number); return new Date(Date.UTC(p[0], p[1] - 1, p[2])).getUTCDay(); }

  /* ---------- 小工具 ---------- */
  function clone(x) { return JSON.parse(JSON.stringify(x)); }
  function isObj(x) { return !!x && typeof x === "object" && !Array.isArray(x); }
  function isStr(x) { return typeof x === "string" && x.trim().length > 0; }
  function isNat(x) { return typeof x === "number" && Number.isInteger(x) && x >= 0; }
  function isBool(x) { return typeof x === "boolean"; }
  function uniq(a) { var s = {}; return a.filter(function (v) { if (s[v]) return false; s[v] = 1; return true; }); }
  function pushCap(a, v, n) { a.push(v); if (a.length > n) a.splice(0, a.length - n); }

  /* ---------- 題卡 ---------- */
  function validCard(c, bank) {
    if (!isObj(c)) return false;
    if (!isStr(c.id) || !isStr(c.q) || !Object.prototype.hasOwnProperty.call(bank.concepts, c.concept)) return false;
    if (c.type === "choice" || c.type === "figure") {
      if (c.type === "figure" && !Object.prototype.hasOwnProperty.call(bank.figs, c.fig)) return false;
      return Array.isArray(c.opts) && c.opts.length >= 2 && c.opts.every(isStr) && Number.isInteger(c.a) && c.a >= 0 && c.a < c.opts.length;
    }
    if (c.type === "recall") return isStr(c.ans);
    if (c.type === "map") return isStr(c.center) && Array.isArray(c.branches) && c.branches.length > 0 &&
      c.branches.every(function (b) { return isObj(b) && isStr(b.k) && isStr(b.show) && isStr(b.blank); });
    return false;
  }
  // R6（4agent 2026-10-11 定案）D3 規格：匯入題（extra）與內建題同 id ⇒ 以內建題為準、匯入那張被遮蔽，存檔照常讀寫不卡住；
  // extra 自身重複才算 schema 錯（checkState「extra duplicate」）。理由：她不該因舊匯入資料而整個 app 停擺；
  // 匯入入口已藏起來（scope-cut），新衝突只會來自舊資料。測試：tests/core.test.js「D3 題卡 id」。
  function allCards(state, bank) {
    var seen = {};
    bank.cards.forEach(function (c) { seen[c.id] = 1; });
    return bank.cards.concat(state.extra.filter(function (c) { if (seen[c.id]) return false; seen[c.id] = 1; return true; }));
  }
  function cardById(state, bank, id) {
    var a = allCards(state, bank);
    for (var i = 0; i < a.length; i++) if (a[i].id === id) return a[i];
    return null;
  }
  function conceptOn(state, bank, cid) { return bank.concepts[cid].unit !== "3" || state.settings.unit3; }
  function enabledCards(state, bank) {
    return allCards(state, bank).filter(function (c) { return conceptOn(state, bank, c.concept); });
  }
  function cardState(state, id) { return state.cards[id] || { seen: 0, goodDays: [], blockedDay: null, due: null }; }
  function retired(cs) { return cs.goodDays.length >= 3; }

  /* ---------- 空白狀態 ---------- */
  function blankState() {
    return { v: 3, cards: {}, exits: {}, days: {}, labRuns: {}, session: null, log: [], ops: [],
             help: {}, extra: [], settings: { unit3: false, sound: true, tone: 0 } };
  }
  function blankDay() { return { planIds: [], doneIds: [], touched: [], extraDone: false, labRuns: 0, teach: 0, mood: null }; }

  /* ---------- 每日計畫 ---------- */
  function newQuota(day) { return day < DIAG_END ? NEW_PER_DAY_DIAG : NEW_PER_DAY; }
  function computePlan(state, bank, day) {
    var cards = enabledCards(state, bank), due = [], fresh = [];
    cards.forEach(function (c) {
      var cs = cardState(state, c.id);
      if (cs.seen > 0) { if (!retired(cs) && cs.due && cs.due <= day) due.push(c.id); }
      else fresh.push(c.id);
    });
    // 考前要每張卡都至少練過一次（Codex 審 e6c7ed6：固定每天 5 張，第六單元 18 題考前排不到）：
    // 新卡配額＝max(原配額, 剩下沒練過的 ÷ 到考前還有幾天)，無條件進位。
    var left = diffDays(day, EXAM), quota = newQuota(day);
    if (left > 0) quota = Math.max(quota, Math.ceil(fresh.length / left));
    var pick = {}; due.concat(fresh.slice(0, quota)).forEach(function (id) { pick[id] = 1; });
    return cards.filter(function (c) { return pick[c.id]; }).map(function (c) { return c.id; });   // 固定題庫順序
  }
  // 每日第一次操作就把當天計畫固定下來；之後匯入、開放單元都等隔天才納入（矩陣 29）
  function ensureDay(state, bank, day) {
    if (!state.days[day]) { var d = blankDay(); d.planIds = computePlan(state, bank, day); state.days[day] = d; }
    return state.days[day];
  }
  function dayCompleted(d) {
    return !!d && d.planIds.length > 0 && d.planIds.every(function (id) { return d.doneIds.indexOf(id) >= 0; });
  }
  function remainingOf(d) { return d.planIds.filter(function (id) { return d.doneIds.indexOf(id) < 0; }); }

  // 三單元交錯期：同一份計畫，改成輪流出不同概念（不隨機，重載後順序不變）
  function sessionOrder(state, bank, day, ids) {
    if (day < MIX_START) return ids.slice();
    var by = {}, order = [];
    ids.forEach(function (id) { var c = cardById(state, bank, id), k = c ? c.concept : "?"; if (!by[k]) { by[k] = []; order.push(k); } by[k].push(id); });
    var out = [];
    while (out.length < ids.length) order.forEach(function (k) { if (by[k].length) out.push(by[k].shift()); });
    return out;
  }
  // 小考複習排序（2026-10-11 律師：「每次複習都要從頭來一遍嗎？」）：不再照題庫順序從第 1 題開始。
  // 第 0 層＝練過但目前沒把握（答錯、提示、不確定後還沒答對過；或舊版畢業待確認）→ 第 1 層＝還沒練過 →
  // 第 2 層＝已經會的，最久沒練的先、有效日少的先。每一層裡觀念交錯（不同觀念輪流出，練辨別）。
  // 只用既有狀態（cards＋log）算，不新增存檔欄位；所以隔天、同一天再按都會「接著練」，不會從頭來。
  function reviewOrder(state, bank, ids) {
    var last = {};
    state.log.forEach(function (e) { if (!last[e.card] || e.d > last[e.card]) last[e.card] = e.d; });
    function tier(id) { var cs = cardState(state, id); return cs.seen === 0 ? 1 : (!cs.goodDays.length || cs.needsRecheck) ? 0 : 2; }
    var rows = ids.map(function (id, i) { return { id: id, i: i, t: tier(id), d: last[id] || "", g: cardState(state, id).goodDays.length }; });
    var out = [];
    [0, 1, 2].forEach(function (t) {
      var layer = rows.filter(function (r) { return r.t === t; })
        .sort(function (a, b) { return t === 1 ? a.i - b.i : (a.d < b.d ? -1 : a.d > b.d ? 1 : 0) || a.g - b.g || a.i - b.i; });
      var by = {}, order = [];
      layer.forEach(function (r) { var c = cardById(state, bank, r.id), k = c ? c.concept : "?"; if (!by[k]) { by[k] = []; order.push(k); } by[k].push(r.id); });
      var n = out.length + layer.length;
      while (out.length < n) order.forEach(function (k) { if (by[k].length) out.push(by[k].shift()); });
    });
    return out;
  }
  // 待協助的觀念排到這一輪最後：先別再刷她卡住的觀念（補救分支三）；穩定排序，其餘順序不動
  function stuckLast(state, bank, ids) {
    var stuck = function (id) { var c = cardById(state, bank, id), h = c && state.help[c.concept]; return h && h.needsHelp ? 1 : 0; };
    return ids.map(function (id, i) { return [stuck(id), i, id]; }).sort(function (a, b) { return a[0] - b[0] || a[1] - b[1]; }).map(function (x) { return x[2]; });
  }
  function planSession(state, bank, day) {
    var d = ensureDay(state, bank, day);
    // 題庫改版後消失的卡不排進回合。R7（4agent N6）：reduce／view 都先跑 pruneVanished，這個過濾目前是防禦性冗餘
    // （拿掉它的突變 N6 是等價突變、測不出來，屬預期）；留著是為了 planSession 將來被別處直接呼叫時仍安全
    var ids = remainingOf(d).filter(function (id) { return !!cardById(state, bank, id); });
    return { day: day, kind: "plan", queue: stuckLast(state, bank, sessionOrder(state, bank, day, ids)), answered: [], wrong: [], kinds: {} };
  }
  function pruneVanished(state, bank, day) {
    var ok = function (id) { return !!cardById(state, bank, id); }, d = state.days[day];
    if (d) { d.planIds = d.planIds.filter(ok); d.doneIds = d.doneIds.filter(ok); }
    if (state.session) {
      state.session.queue = state.session.queue.filter(ok);
      state.session.answered = state.session.answered.filter(ok);
      state.session.wrong = state.session.wrong.filter(ok);
    }
  }
  // 跨午夜：日期與任務一起切換（矩陣 16、17）
  function syncSession(state, bank, day) {
    if (state.session && state.session.day !== day) state.session = planSession(state, bank, day);
  }

  /* ---------- 出口題 ---------- */
  function openExit(state, cid, day) {
    var e = state.exits[cid];
    if (!e) state.exits[cid] = { status: "pending", due: addDays(day, 1), opened: day, last: null };
  }

  /* ---------- reducer ---------- */
  function fail(state, code) { return { state: state, error: code }; }

  function reduce(state0, action, env) {
    var bank = env.bank, today = dayKey(env.now);
    if (!isObj(action) || !isStr(action.type)) return fail(state0, "BAD_ACTION");
    if (action.type !== "tick" && !isStr(action.id)) return fail(state0, "BAD_ACTION");
    if (action.id && state0.ops.indexOf(action.id) >= 0) return { state: state0, dup: true };
    var s = clone(state0), info = {};
    var day = ensureDay(s, bank, today);
    syncSession(s, bank, today);
    pruneVanished(s, bank, today);
    var wasDone = dayCompleted(day);
    function extra() { if (wasDone) day.extraDone = true; }   // 只有計畫先完成，之後實際完成的才算加碼（矩陣 9、10、12）

    switch (action.type) {
      case "tick": break;

      case "sessionStart": {
        if (action.kind === "redo" || action.kind === "review") {
          // redo＝再練答錯的；review＝小考前把整個單元／觀念練一次。作答規則一樣，不改當日計畫與完成判定
          var ids = uniq((Array.isArray(action.ids) ? action.ids : []).filter(function (id) { return !!cardById(s, bank, id); }));
          var rq = stuckLast(s, bank, action.kind === "review" ? reviewOrder(s, bank, ids) : ids);
          if (action.kind === "review" && isNat(action.size) && action.size > 0) rq = rq.slice(0, action.size);   // 一段幾題（畫面給 20）；不給＝全部
          s.session = { day: today, kind: action.kind, queue: rq, answered: [], wrong: [], kinds: {} };
        } else {
          var sess = planSession(s, bank, today);
          var blocked = isStr(action.focus) && s.help[action.focus] && s.help[action.focus].needsHelp;
          if (blocked) info.focusBlocked = true;   // 待協助優先於概念入口：卡住的觀念不能被拉到最前面
          if (isStr(action.focus) && bank.concepts[action.focus] && !blocked) {
            // 概念入口：她選的觀念先練，只換順序、不改到期規則與當日計畫
            var mine = function (id) { var c = cardById(s, bank, id); return c && c.concept === action.focus ? 0 : 1; };
            sess.queue = sess.queue.map(function (id, i) { return [mine(id), i, id]; }).sort(function (x, y) { return x[0] - y[0] || x[1] - y[1]; }).map(function (x) { return x[2]; });
            sess.focus = action.focus;
          }
          if (isNat(action.size) && action.size > 0) sess.queue = sess.queue.slice(0, action.size);
          sess.size = sess.queue.length;
          s.session = sess;
        }
        break;
      }

      case "answer": {
        var card = cardById(s, bank, action.cardId);
        if (!card) return fail(state0, "NO_CARD");
        if (!isBool(action.ok)) return fail(state0, "BAD_ACTION");
        var cs = s.cards[card.id] = clone(cardState(s, card.id));
        var sessKind = s.session && s.session.kinds[card.id];
        var variation = !!action.variation || sessKind === "variation";
        var first = day.touched.indexOf(card.id) < 0;
        var shaky = !action.ok || !!action.hint || !!action.unsure;
        cs.seen++;
        if (cs.needsRecheck) delete cs.needsRecheck;
        if (shaky) {
          // 任何答錯、提示、不確定：清空有效日期，當天不得補回（矩陣 3、4）
          cs.goodDays = []; cs.blockedDay = today; cs.due = addDays(today, 1);
        } else if (first && !variation && cs.blockedDay !== today && cs.goodDays.indexOf(today) < 0) {
          cs.goodDays.push(today);
          var n = cs.goodDays.length;
          cs.due = n === 1 ? addDays(today, 1) : n === 2 ? addDays(today, 2) : null;
          info.graduated = n >= 3;
        } else if (cs.due === null && cs.goodDays.length === 0) {
          cs.due = addDays(today, 1);   // 第一次見到就是變式或重答：至少明天要回來
        }
        if (cs.goodDays.length > 3) cs.goodDays = cs.goodDays.slice(-3);
        if (first) day.touched.push(card.id);
        var inPlan = day.planIds.indexOf(card.id) >= 0;
        if (inPlan && day.doneIds.indexOf(card.id) < 0) day.doneIds.push(card.id);
        if (!inPlan || !first) extra();
        else if (wasDone) extra();
        openExit(s, card.concept, today);
        pushCap(s.log, { op: action.id, d: today, card: card.id, c: card.concept, ok: action.ok,
                         hint: !!action.hint, unsure: !!action.unsure, variation: variation, first: first }, LOG_KEEP);
        if (variation && !action.ok) {
          // 補救後換題仍錯：停止本輪、標「待協助」，交給爸媽陪她看（補救分支三）
          var hh = s.help[card.concept] || (s.help[card.concept] = { count: 0, last: null, way: 0, needsHelp: false });
          hh.needsHelp = true;
          if (s.session) s.session.halted = true;
          info.halted = true;
        }
        if (s.session) {
          var q = s.session.queue, at = q.indexOf(card.id);
          if (at >= 0) q.splice(at, 1);
          if (s.session.answered.indexOf(card.id) < 0) s.session.answered.push(card.id);
          if (!action.ok && s.session.wrong.indexOf(card.id) < 0) s.session.wrong.push(card.id);
          delete s.session.kinds[card.id];
        }
        info.first = first; info.variation = variation;
        break;
      }

      case "exit": {
        var cid = action.cid;
        if (!bank.concepts[cid]) return fail(state0, "NO_CONCEPT");
        if (action.result !== "pass" && action.result !== "fail") return fail(state0, "BAD_ACTION");
        var e = s.exits[cid];
        if (e && e.status === "pass") return fail(state0, "EXIT_CLOSED");   // 通過後只有明確重測才開新票
        e = s.exits[cid] = e || { status: "pending", due: today, opened: today, last: null };
        e.last = today;
        if (action.result === "pass") { e.status = "pass"; e.due = null; }
        else {
          e.status = "fail"; e.due = addDays(today, 1);
          // 只動已學卡：清掉掌握，到期日取「原到期日」與「明天」較早者；未學卡維持未學（矩陣 14）
          allCards(s, bank).forEach(function (c) {
            if (c.concept !== cid) return;
            var st = s.cards[c.id];
            if (!st || st.seen === 0) return;
            st.goodDays = [];
            var tm = addDays(today, 1);
            st.due = st.due && st.due < tm ? st.due : tm;
          });
        }
        break;
      }

      case "exitRetest": {
        if (!bank.concepts[action.cid]) return fail(state0, "NO_CONCEPT");
        var ex = s.exits[action.cid];
        if (ex && ex.status !== "pass") return fail(state0, "EXIT_OPEN");
        s.exits[action.cid] = { status: "pending", due: today, opened: today, last: ex ? ex.last : null };
        break;
      }

      case "labStart": {
        if (!isStr(action.runId) || !isStr(action.lab) || !isNat(action.tasks) || action.tasks < 1 || !isNat(action.answer))
          return fail(state0, "BAD_ACTION");
        if (s.labRuns[action.runId]) return fail(state0, "RUN_EXISTS");
        s.labRuns[action.runId] = { lab: action.lab, day: today, phase: "predict", prediction: null, predictionCorrect: null,
                                    answer: action.answer, tasks: action.tasks, tasksDone: [],
                                    from: action.from === "wrong" ? "wrong" : "menu", card: isStr(action.card) ? action.card : null };
        var keys = Object.keys(s.labRuns);
        if (keys.length > RUNS_KEEP) keys.slice(0, keys.length - RUNS_KEEP).forEach(function (k) { delete s.labRuns[k]; });
        break;
      }
      case "labPredict": {
        var r = s.labRuns[action.runId];
        if (!r) return fail(state0, "NO_RUN");
        if (r.phase !== "predict") return fail(state0, "ALREADY_PREDICTED");
        if (!isNat(action.choice)) return fail(state0, "BAD_ACTION");
        r.prediction = action.choice; r.predictionCorrect = action.choice === r.answer; r.phase = "observe";
        break;
      }
      case "labTask": {
        var r2 = s.labRuns[action.runId];
        if (!r2) return fail(state0, "NO_RUN");
        if (r2.phase === "predict") return fail(state0, "PREDICTION_REQUIRED");   // 先預測才能操作（矩陣 11）
        if (!isNat(action.task) || action.task >= r2.tasks) return fail(state0, "BAD_ACTION");
        if (r2.tasksDone.indexOf(action.task) < 0) r2.tasksDone.push(action.task);
        break;
      }
      case "labComplete": {
        var r3 = s.labRuns[action.runId];
        if (!r3) return fail(state0, "NO_RUN");
        if (r3.phase === "predict") return fail(state0, "PREDICTION_REQUIRED");
        if (r3.phase === "complete") return { state: state0, dup: true };          // 同一次實驗只算一次（矩陣 6、12）
        if (r3.tasksDone.length < r3.tasks) return fail(state0, "TASKS_LEFT");
        r3.phase = "complete";
        day.labRuns++;
        extra();
        if (r3.from === "wrong" && r3.card && s.session) {
          var orig = cardById(s, bank, r3.card);
          var v = orig ? pickVariation(s, bank, orig, action.variationId) : null;
          if (v) {
            var qq = s.session.queue, at2 = qq.indexOf(v);
            if (at2 >= 0) qq.splice(at2, 1);
            qq.unshift(v);                        // 已在佇列就移到前方，不複製（矩陣 6）
            s.session.kinds[v] = "variation";
            info.variation = v;
          }
        }
        break;
      }

      case "help": {
        // 「還不懂這個觀念」：只記求助紀錄、決定這次用哪一種解釋；不動任何卡片的掌握度（補救分支一、二）
        if (!bank.concepts[action.cid]) return fail(state0, "NO_CONCEPT");
        if (!isNat(action.ways) || action.ways < 1) return fail(state0, "BAD_ACTION");
        var h0 = s.help[action.cid];
        info.previous = h0 && h0.count ? { last: h0.last, way: h0.way } : null;
        var h = s.help[action.cid] = h0 ? clone(h0) : { count: 0, last: null, way: 0, needsHelp: false };
        h.way = h.count === 0 ? 0 : (h.way + 1) % action.ways;
        h.count++; h.last = today;
        info.way = h.way;
        break;
      }
      case "helped": {
        var hp = s.help[action.cid];
        if (!hp) return fail(state0, "NO_CONCEPT");
        hp.needsHelp = false;
        break;
      }
      case "teach": {
        if (!cardById(s, bank, action.cardId)) return fail(state0, "NO_CARD");
        day.teach++;
        extra();
        break;
      }
      case "mood": {
        if (["good", "ok", "tired"].indexOf(action.value) < 0) return fail(state0, "BAD_ACTION");
        day.mood = action.value;
        break;
      }
      case "settings": {
        if (action.unit3 !== undefined) { if (!isBool(action.unit3)) return fail(state0, "BAD_ACTION"); s.settings.unit3 = action.unit3; }
        if (action.sound !== undefined) { if (!isBool(action.sound)) return fail(state0, "BAD_ACTION"); s.settings.sound = action.sound; }
        // 答對提示音選哪一種（0–9，src/tones.js；2026-10-13 律師要 10 種可選）
        if (action.tone !== undefined) { if (!isTone(action.tone)) return fail(state0, "BAD_ACTION"); s.settings.tone = action.tone; }
        break;
      }
      case "import": {
        if (!Array.isArray(action.cards)) return fail(state0, "BAD_ACTION");
        var have = {}; allCards(s, bank).forEach(function (c) { have[c.id] = 1; });
        var acc = [], rej = [];
        action.cards.forEach(function (c) {
          var id = isObj(c) && isStr(c.id) ? c.id : "(無 id)";
          if (have[id] || !validCard(c, bank)) { rej.push(id); return; }
          have[id] = 1; acc.push(id);
          s.extra.push(clone(c));
        });
        info.acceptedIds = acc; info.rejectedIds = rej;
        break;
      }
      case "reset": {
        var keep = { extra: s.extra, settings: s.settings };
        s = blankState(); s.extra = keep.extra; s.settings = keep.settings;
        break;
      }
      default: return fail(state0, "BAD_ACTION");
    }
    if (action.id) pushCap(s.ops, action.id, OPS_KEEP);
    return { state: s, info: info };
  }

  // 變式：同概念、已學、不是原卡；優先已在佇列的（移到前方），否則挑最不熟的（矩陣 6）
  function pickVariation(s, bank, orig, wanted) {
    var cands = enabledCards(s, bank).filter(function (c) {
      return c.concept === orig.concept && c.id !== orig.id && cardState(s, c.id).seen > 0;
    });
    // 新使用者第一題就答錯時同觀念還沒有練過的卡（Codex 審 e6c7ed6）：退而用同觀念還沒練過的題，
    // 不然畫面說「換一題確認」實際卻沒有確認題，再錯也不會停下來找爸媽。
    if (!cands.length) cands = enabledCards(s, bank).filter(function (c) { return c.concept === orig.concept && c.id !== orig.id; });
    if (!cands.length) return null;
    if (wanted && cands.some(function (c) { return c.id === wanted; })) return wanted;
    var q = s.session ? s.session.queue : [];
    var inQ = cands.filter(function (c) { return q.indexOf(c.id) >= 0; });
    var pool = inQ.length ? inQ : cands;
    pool.sort(function (a, b) { return cardState(s, a.id).goodDays.length - cardState(s, b.id).goodDays.length; });
    return pool[0].id;
  }

  /* ---------- 檢視（純函式，不改狀態） ---------- */
  function view(state, env) {
    var bank = env.bank, today = dayKey(env.now);
    var s = clone(state);
    var d = ensureDay(s, bank, today);
    syncSession(s, bank, today);
    pruneVanished(s, bank, today);
    var exitPending = 0, exitLater = 0;
    Object.keys(s.exits).forEach(function (cid) {
      var e = s.exits[cid];
      if (!bank.concepts[cid] || !conceptOn(s, bank, cid) || e.status === "pass") return;
      if (e.due <= today) exitPending++; else exitLater++;
    });
    var stages = {};
    Object.keys(bank.concepts).forEach(function (cid) { stages[cid] = stageOf(s, bank, cid); });
    return {
      today: today, planIds: d.planIds.slice(), doneIds: d.doneIds.slice(), remainingIds: remainingOf(d),
      completed: dayCompleted(d), session: s.session, stages: stages, day: d,
      M: { cardProgress: { done: d.doneIds.length, planned: d.planIds.length }, exitPending: exitPending, extraDone: d.extraDone },
      exitLater: exitLater,
      needsHelp: Object.keys(s.help).filter(function (cid) { return s.help[cid].needsHelp && bank.concepts[cid] && conceptOn(s, bank, cid); })
    };
  }
  // 植物階段完全由狀態派生（矩陣 26）：0 種子＝沒見過；1 發芽＝見過部分；2 長葉＝全部見過；3 開花＝出口題通過；4 結果＝出口通過且全部畢業
  function stageOf(s, bank, cid) {
    var cards = enabledCards(s, bank).filter(function (c) { return c.concept === cid; });
    if (!cards.length) return 0;
    var seen = cards.filter(function (c) { return cardState(s, c.id).seen > 0; }).length;
    var e = s.exits[cid], pass = !!e && e.status === "pass";
    if (pass && cards.every(function (c) { return retired(cardState(s, c.id)); })) return 4;
    if (pass) return 3;
    if (seen === cards.length) return 2;
    return seen ? 1 : 0;
  }
  function endTitle(v) {
    // R9（4agent）：停輪是要爸媽陪看的訊號，優先於每日完成／空計畫，不能被蓋掉
    if (v.session && v.session.halted) return "這一輪先停在這裡";
    if (!v.planIds.length) return "今天沒有排定卡片";
    if (v.completed) return "今天的卡片都做完了";
    if (v.session && !v.session.queue.length && v.session.answered.length) return "這一輪完成了";
    return "";
  }
  function exitList(state, env) {
    var bank = env.bank, today = dayKey(env.now);
    return Object.keys(bank.concepts).filter(function (cid) { return state.exits[cid] && conceptOn(state, bank, cid); })
      .map(function (cid) { var e = state.exits[cid]; return { cid: cid, status: e.status, due: e.due, last: e.last, ready: e.status !== "pass" && e.due <= today }; });
  }

  /* ---------- 嚴格 schema（矩陣 19） ---------- */
  function uniqList(a) { return uniq(a).length === a.length; }
  function dayList(a) { return Array.isArray(a) && a.every(isDay) && uniq(a).length === a.length; }
  function strList(a) { return Array.isArray(a) && a.every(isStr); }
  function checkState(o, bank) {
    var errs = [];
    function bad(m) { errs.push(m); }
    if (!isObj(o) || o.v !== 3) { bad("v"); return errs; }
    if (!isObj(o.cards)) bad("cards"); else Object.keys(o.cards).forEach(function (k) {
      var c = o.cards[k];
      if (!isObj(c) || !isNat(c.seen) || !dayList(c.goodDays) || c.goodDays.length > 3 ||
          !(c.blockedDay === null || isDay(c.blockedDay)) || !(c.due === null || isDay(c.due)) ||
          (c.needsRecheck !== undefined && c.needsRecheck !== true)) bad("card " + k);
      else if (c.goodDays.length === 3 && c.due !== null) bad("card " + k + " retired with due");
      else if (c.goodDays.slice().sort().join() !== c.goodDays.join()) bad("card " + k + " order");
    });
    if (!isObj(o.exits)) bad("exits"); else Object.keys(o.exits).forEach(function (k) {
      var e = o.exits[k];
      if (!bank.concepts[k] || !isObj(e) || ["pending", "fail", "pass"].indexOf(e.status) < 0 ||
          !(e.due === null || isDay(e.due)) || !isDay(e.opened) || !(e.last === null || isDay(e.last)) ||
          ((e.status === "pass") !== (e.due === null))) bad("exit " + k);
    });
    if (!isObj(o.days)) bad("days"); else Object.keys(o.days).forEach(function (k) {
      var d = o.days[k];
      if (!isDay(k) || !isObj(d) || !strList(d.planIds) || !strList(d.doneIds) || !strList(d.touched) ||
          !isBool(d.extraDone) || !isNat(d.labRuns) || !isNat(d.teach) ||
          !(d.mood === null || ["good", "ok", "tired"].indexOf(d.mood) >= 0)) { bad("day " + k); return; }
      if (!d.doneIds.every(function (id) { return d.planIds.indexOf(id) >= 0; })) bad("day " + k + " done⊄plan");
      if (!uniqList(d.planIds) || !uniqList(d.doneIds) || !uniqList(d.touched)) bad("day " + k + " duplicate");
    });
    if (!isObj(o.labRuns)) bad("labRuns"); else Object.keys(o.labRuns).forEach(function (k) {
      var r = o.labRuns[k];
      if (!isObj(r) || !isStr(r.lab) || !isDay(r.day) || ["predict", "observe", "complete"].indexOf(r.phase) < 0 ||
          !(r.prediction === null || isNat(r.prediction)) || !(r.predictionCorrect === null || isBool(r.predictionCorrect)) ||
          !isNat(r.answer) || !isNat(r.tasks) || !Array.isArray(r.tasksDone) || !r.tasksDone.every(isNat) || !uniqList(r.tasksDone) ||
          ["wrong", "menu"].indexOf(r.from) < 0 || !(r.card === null || isStr(r.card))) bad("run " + k);
    });
    if (o.session !== null) {
      var se = o.session;
      if (!isObj(se) || !isDay(se.day) || ["plan", "redo", "review"].indexOf(se.kind) < 0 || !strList(se.queue) ||
          !strList(se.answered) || !strList(se.wrong) || !isObj(se.kinds) ||
          (se.size !== undefined && !isNat(se.size)) || (se.halted !== undefined && !isBool(se.halted)) ||
          (se.focus !== undefined && !bank.concepts[se.focus])) bad("session");
      else if (!uniqList(se.queue) || !uniqList(se.answered) || !uniqList(se.wrong)) bad("session duplicate");
    }
    if (!Array.isArray(o.log) || !o.log.every(function (e) {
      return isObj(e) && isStr(e.op) && isDay(e.d) && isStr(e.card) && isStr(e.c) &&
        isBool(e.ok) && isBool(e.hint) && isBool(e.unsure) && isBool(e.variation) && isBool(e.first);
    })) bad("log");
    if (!strList(o.ops) || !uniqList(o.ops)) bad("ops");
    if (!isObj(o.help)) bad("help"); else Object.keys(o.help).forEach(function (k) {
      var h = o.help[k];
      if (!bank.concepts[k] || !isObj(h) || !isNat(h.count) || !(h.last === null || isDay(h.last)) || !isNat(h.way) || !isBool(h.needsHelp)) bad("help " + k);
    });
    if (!Array.isArray(o.extra) || !o.extra.every(function (c) { return validCard(c, bank); })) bad("extra");
    else if (!uniqList(o.extra.map(function (c) { return c.id; }))) bad("extra duplicate");
    if (!isObj(o.settings) || !isBool(o.settings.unit3) || !isBool(o.settings.sound) || !(o.settings.tone === undefined || isTone(o.settings.tone))) bad("settings");
    return errs;
  }
  function isTone(x) { return typeof x === "number" && Number.isInteger(x) && x >= 0 && x <= 9; }   // 舊存檔沒有 tone 欄位＝第 0 種
  function decode(text, bank) {
    var o;
    try { o = JSON.parse(text); } catch (e) { return { accepted: false, error: "SCHEMA", detail: ["json"] }; }
    var errs = checkState(o, bank);
    return errs.length ? { accepted: false, error: "SCHEMA", detail: errs } : { accepted: true, state: o };
  }

  /* ---------- 舊資料遷移（v1 → v3，矩陣 28） ---------- */
  // v1 的連對次數可能是同一天累積的，不足以證明跨日掌握：一律不承認畢業、標「需重新確認」、最晚明天回來複習。
  // R5/R8（4agent）：搬之前先驗 v1 已知容器與欄位型別；型別不對就封鎖並記原因，不得靜默略過後寫出空白 v3
  function v1Problem(text) {
    var o;
    try { o = JSON.parse(text); } catch (e) { return "PARSE"; }
    if (!isObj(o) || o.v !== 1) return "VERSION";
    if (!isObj(o.cards) || (o.extra !== undefined && !Array.isArray(o.extra)) ||
        (o.unit3 !== undefined && !isBool(o.unit3)) || (o.prefs !== undefined && !isObj(o.prefs))) return "BAD_V1";
    var badCard = Object.keys(o.cards).some(function (k) {
      var c = o.cards[k];
      return !isObj(c) || !isNat(c.seen) || !(c.due === undefined || c.due === null || isStr(c.due));
    });
    return badCard ? "BAD_V1" : null;
  }
  function migrateV1(text, now, bank) {
    if (v1Problem(text)) return null;
    var o = JSON.parse(text);
    var today = dayKey(now), tm = addDays(today, 1), s = blankState();
    var ids = {}; bank.cards.forEach(function (c) { ids[c.id] = c; });
    if (Array.isArray(o.extra)) o.extra.forEach(function (c) { if (validCard(c, bank) && !ids[c.id]) { s.extra.push(clone(c)); ids[c.id] = c; } });
    if (isObj(o.cards)) Object.keys(o.cards).forEach(function (k) {
      var c = o.cards[k];
      if (!ids[k] || !isObj(c) || !isNat(c.seen) || c.seen === 0) return;
      var due = isDay(c.due) && c.due < tm ? c.due : tm;
      s.cards[k] = { seen: c.seen, goodDays: [], blockedDay: null, due: due, needsRecheck: true };
      openExit(s, ids[k].concept, today);
    });
    if (isBool(o.unit3)) s.settings.unit3 = o.unit3;
    if (isObj(o.prefs) && isBool(o.prefs.sound)) s.settings.sound = o.prefs.sound;
    return s;
  }

  /* ---------- 儲存層：寫入成功才公布（矩陣 27）；存檔被別處改掉就整頁失效（設計 external-change-codex-20261013 方案 A）；
     舊版紀錄改封存＋家長選擇恢復、READ 不前進（設計 task-mv6srlue-pujdyl S0–S3） ---------- */
  function createStore(opt) {
    var storage = opt.storage, bank = opt.bank, clock = opt.clock, session = opt.session || null;
    // loadError：SCHEMA（存檔讀得到但不合法）／READ（讀不到）／LEGACY（新版不存在、只剩舊版：等家長選「恢復」或「從頭開始」）——都封鎖寫入，絕不拿空白蓋掉看不到的資料
    // stale：這一頁開著時存檔被別處改了（別頁存檔、清除、整個刪掉、改壞、同步換掉）；之後一律回 STATE_CHANGED，只能整頁重載
    // reloadNotice：這次開頁是失效後的重載（畫面提示「紀錄已更新，請從這裡繼續」）
    // legacy（只有有舊版的站）：null，或 {src:"O"|"A", reason, conflict}——O＝舊版原 key、A＝舊版封存；reason＝舊版原文讀不懂的原因（PARSE／VERSION／BAD_V1），null＝可以恢復
    // archive（只有有舊版的站）：null／"done"／"pending"（進度已存，舊版封存未完成）／"conflict"（A 和 O 不一樣，兩份都不動）
    var st = { state: blankState(), saveStatus: "ok", pendingAction: null, loadError: null, migrateReason: null, syncMode: "local", migrated: false,
               stale: false, reloadNotice: false, legacy: null, archive: null };
    function env() { return { now: clock(), bank: bank }; }
    // 多分頁：每個分頁各有一份記憶體狀態，記住「最後讀到／寫入的原文」lastRaw，每次操作前先讀磁碟比對。
    // 不一樣＝存檔換代了：回 STATE_CHANGED、鎖定本頁失效；這次不跑 reducer、不寫入、不補寫待存操作，也不換掉記憶體快照
    // （舊畫面、閉包、按鈕還在讀它；換成空白會拋 TypeError）。上一版「換成磁碟版／空白再套用舊操作」會讓舊 runId、舊回合、
    // 待存操作失去前提還繼續跑（Codex 設計 20261013 根因），所以改成整頁重載，畫面狀態一起丟掉重來。
    // 舊版紀錄（設計 task-mv6srlue-pujdyl）：不再用 .fromV1／.noMigrate 標記判斷「可不可以自動搬」——只剩舊版時一律等家長明確選擇，
    // 重載、失效、待存重試都不會自動恢復。沒有舊版的站（LS_V1=null）完全不碰舊版或標記 key。
    var lastRaw = null, NOTICE = LS_KEY + ".reloaded";
    var legacyTxt = null;               // 開頁時讀到的舊版原文（O 或 A）；家長按下去時要確認它沒被換掉
    var oTxt = null;                    // 這一頁要封存的 O 原文；O 刪了但沒確認時，重試用它核對 A
    var mine = null;                    // 家長選擇後本頁寫出的新版 {txt, state, migrated}；寫後回讀失敗時，重試以它承認磁碟上那份是自己寫的
    function sGet(k) { try { return session ? session.getItem(k) : null; } catch (e) { return null; } }
    function sSet(k, v) { try { if (session) { if (v === null) session.removeItem(k); else session.setItem(k, v); } } catch (e) { /* 分頁暫存不能用：只是少了提示 */ } }
    function write(next) {
      if (st.stale) return "stale";
      var errs = checkState(next, bank);
      if (errs.length) return "invalid";
      if (st.loadError) return "blocked";
      var txt = JSON.stringify(next);
      try { storage.setItem(LS_KEY, txt); } catch (e) { return "failed"; }
      lastRaw = txt;
      if (st.legacy && st.legacy.src === "A") st.legacy = null;   // 已經開始新紀錄：「恢復封存」入口收起來，不能拿舊版蓋掉新紀錄
      return "ok";
    }
    // "ok"＝磁碟跟上次一樣；"fail"＝讀不到（不寫、待存留著重試，不當成空白）；"changed"＝被別處改了（本頁失效）
    function refresh() {
      if (st.stale) return "changed";
      var raw;
      try { raw = storage.getItem(LS_KEY); } catch (e) { return "fail"; }
      if (raw !== lastRaw) { st.stale = true; return "changed"; }
      return "ok";
    }
    function changed() {
      return { ok: false, error: "STATE_CHANGED", pending: !!st.pendingAction, pendingId: st.pendingAction ? st.pendingAction.id : null, state: st.state };
    }
    function readFail() { st.loadError = "READ"; st.saveStatus = "blocked"; return st; }
    // 設計 S2 步驟 4–6：新版 V 已確認之後，把 O 原文逐字寫進 A、讀回核對，再確認 O 沒被換掉才刪 O、讀回確認刪掉。
    // 只向前做完、不回滾：任何一步失敗就停在「pending」，V／O／已寫的 A 都留著，下次（再試一次或下次開頁）從頭冪等重做。
    function retire(o) {
      var a, now;
      oTxt = o;
      try { a = storage.getItem(LS_ARC); } catch (e) { return "pending"; }
      if (a !== null && a !== o) return "conflict";                 // 已有一份不一樣的封存：兩份都不動
      if (a === null) {
        try { storage.setItem(LS_ARC, o); } catch (e) { return "pending"; }
        try { if (storage.getItem(LS_ARC) !== o) return "pending"; } catch (e) { return "pending"; }
      }
      try { now = storage.getItem(LS_V1); } catch (e) { return "pending"; }
      if (now === null) return "done";
      if (now !== o) return "conflict";                              // O 在這期間被換掉：不刪別人寫的東西
      try { storage.removeItem(LS_V1); } catch (e) { return "pending"; }
      try { return storage.getItem(LS_V1) === null ? "done" : "pending"; } catch (e) { return "pending"; }
    }
    // 既有 V 的舊安裝（或上次封存沒做完）：只補封存，不重新搬移；讀不到就留到下次，不擋作答
    function archiveOld() {
      var o, a;
      try { o = storage.getItem(LS_V1); } catch (e) { st.archive = "pending"; return; }
      if (o !== null) { st.archive = retire(o); return; }
      if (oTxt === null) return;                                     // 這一頁沒有要封存的東西
      try { a = storage.getItem(LS_ARC); } catch (e) { st.archive = "pending"; return; }
      st.archive = a === oTxt ? "done" : a === null ? "pending" : "conflict";
    }
    function load() {
      var raw = null, o = null, a = null;
      st.reloadNotice = sGet(NOTICE) === "1"; if (st.reloadNotice) sSet(NOTICE, null);
      try { raw = storage.getItem(LS_KEY); } catch (e) { return readFail(); }
      lastRaw = raw;   // 壞掉的存檔也記原文：沒再變就不算外部變更（不會重載循環）
      if (raw !== null) {
        var r = decode(raw, bank);
        if (r.accepted) { st.state = r.state; if (LS_V1 !== null) archiveOld(); }
        else { st.loadError = r.error; st.saveStatus = "blocked"; }
        return st;
      }
      if (LS_V1 === null) return st;                                 // 設計 S0：本站沒有舊版存檔
      try { o = storage.getItem(LS_V1); a = storage.getItem(LS_ARC); } catch (e) { return readFail(); }
      if (o !== null) {                                              // 設計 S1：V 不存在、O 存在——包括真正第一次搬移，也等家長選
        legacyTxt = o;
        st.legacy = { src: "O", reason: v1Problem(o), conflict: a !== null && a !== o };
        st.loadError = "LEGACY"; st.saveStatus = "blocked";
      } else if (a !== null) {                                       // 只剩封存：照常開始新紀錄；家長另有明確的恢復入口
        legacyTxt = a;
        st.legacy = { src: "A", reason: v1Problem(a), conflict: false };
      }
      return st;
    }
    // 家長明確選擇（設計 S2）：choice＝"restore"（把舊版恢復成新版）或 "fresh"（從空白開始）；只有新版寫入並讀回確認才公布成功。
    // 回傳 {ok:true, archive} 或 {ok:false, error}：READ 讀不到／STATE_CHANGED 期間被別處改了／SAVE_FAILED 寫不進／
    // UNCONFIRMED 已寫但讀回失敗（V、O 都不刪，再按一次先讀現況）／BAD_V1 舊版讀不懂／CONFLICT 封存衝突／NOTHING 沒有可選的
    function restoreLegacy(choice) {
      if (st.stale) return changed();
      var lg = st.legacy;
      if (LS_V1 === null || !lg || (choice !== "restore" && choice !== "fresh") || (lg.src === "A" && choice !== "restore") ||
          (lg.src === "A" && lastRaw !== null)) return { ok: false, error: "NOTHING", state: st.state };
      var v, o, a, next, txt;
      try { v = storage.getItem(LS_KEY); o = storage.getItem(LS_V1); a = storage.getItem(LS_ARC); } catch (e) { return { ok: false, error: "READ", state: st.state }; }
      var ours = v !== null && mine !== null && v === mine.txt;
      if (v !== null && !ours) { st.stale = true; return changed(); }            // 步驟 2：新版已經在了（別處寫的）→ 方案 A
      if ((lg.src === "O" ? o : a) !== legacyTxt) { st.stale = true; return changed(); }   // 舊版原文被換掉
      if (ours) { next = mine.state; txt = mine.txt; }
      else {
        if (choice === "restore" && lg.src === "O" && lg.conflict) return { ok: false, error: "CONFLICT", state: st.state };
        next = choice === "restore" ? migrateV1(legacyTxt, clock(), bank) : blankState();
        if (!next) return { ok: false, error: "BAD_V1", state: st.state };
        if (checkState(next, bank).length) return { ok: false, error: "INVARIANT", state: st.state };
        txt = JSON.stringify(next);
        try { storage.setItem(LS_KEY, txt); } catch (e) { return { ok: false, error: "SAVE_FAILED", state: st.state }; }
        mine = { txt: txt, state: next, migrated: choice === "restore" };
      }
      var back;
      try { back = storage.getItem(LS_KEY); } catch (e) { return { ok: false, error: "UNCONFIRMED", state: st.state }; }   // 不刪 V、不刪 O
      if (back !== txt) { st.stale = true; return changed(); }
      lastRaw = txt; st.state = next; st.loadError = null; st.saveStatus = "ok"; st.migrated = mine.migrated; st.legacy = null; mine = null;
      st.archive = lg.src === "O" ? (lg.conflict ? "conflict" : retire(o)) : null;
      return { ok: true, archive: st.archive, state: st.state };
    }
    // 「進度已存，舊版封存未完成」的再試一次：先確認新版沒被別處改，再冪等地做完封存
    function retryArchive() {
      if (st.stale) return changed();
      if (LS_V1 === null || st.loadError) return { ok: false, error: "NOTHING", state: st.state };
      var f = refresh();
      if (f === "changed") return changed();
      if (f === "fail") return { ok: false, error: "READ", state: st.state };
      archiveOld();
      return { ok: st.archive === null || st.archive === "done", archive: st.archive, state: st.state };
    }
    // 先把待重試的操作補寫；補不進去就不接受新操作（不讓 tick 之類的操作把它沖掉）。
    // 存檔已換代（changed）就不補寫：待存操作不跨換代重播，留給畫面明確告訴孩子「這一步需要重做」。
    function flushPending() {
      if (!st.pendingAction) return "ok";
      var f = refresh();
      if (f !== "ok") { if (f === "fail") st.saveStatus = "failed"; return f; }
      var a = st.pendingAction, r = reduce(st.state, a, env());
      if (r.error || r.dup) { st.pendingAction = null; return "ok"; }   // 磁碟沒換代，跟當初算的一樣：重複或不成立就不必再存
      var w = write(r.state);
      if (w !== "ok") { st.saveStatus = w; return "fail"; }
      st.state = r.state; st.saveStatus = "ok"; st.pendingAction = null;
      return "ok";
    }
    function dispatch(action) {
      if (st.stale) return changed();
      // 先處理既有的待存操作（它自己會先讀磁碟）；補不進去就照舊回 SAVE_PENDING，畫面才會保留原本那筆
      // （Codex 審 2e70601：上一版先 refresh、失敗就回 SAVE_FAILED，畫面把待存換成新的那筆，恢復後重試只存舊的）。
      if (st.pendingAction && !(action && action.id && action.id === st.pendingAction.id)) {
        var fp = flushPending();
        if (fp === "changed") return changed();
        if (fp !== "ok") return { ok: false, error: "SAVE_PENDING", pendingId: st.pendingAction.id, state: st.state };
      }
      var f = refresh();
      if (f === "changed") return changed();
      if (f !== "ok") {   // 磁碟讀不到：這次不寫（不拿舊的記憶體狀態蓋掉），有 id 的留著重試
        st.saveStatus = "failed";
        if (action && action.id) st.pendingAction = action;
        return { ok: false, error: "SAVE_FAILED", state: st.state };
      }
      var r = reduce(st.state, action, env());
      if (r.error || r.dup) {
        if (r.dup && st.pendingAction && action.id === st.pendingAction.id) st.pendingAction = null;
        return { ok: !r.error, error: r.error, dup: !!r.dup, info: r.info, state: st.state };
      }
      var w = write(r.state);
      if (w !== "ok") {
        st.saveStatus = w;
        if (action.id) st.pendingAction = action;   // tick 沒有 id：失敗就算了，下次再 tick
        return { ok: false, error: w === "invalid" ? "INVARIANT" : "SAVE_" + w.toUpperCase(), state: st.state };
      }
      st.state = r.state; st.saveStatus = "ok"; if (st.pendingAction && st.pendingAction.id === action.id) st.pendingAction = null;
      return { ok: true, info: r.info, state: st.state };
    }
    function retry() {
      if (st.stale) return changed();
      if (st.pendingAction) return dispatch(st.pendingAction);
      var f = refresh();   // 沒有待存也要檢查失效（T12）
      if (f === "changed") return changed();
      if (f === "fail") return { ok: false, error: "READ", state: st.state };   // 設計 S3：讀不到不是「沒事」，不能回成功讓畫面前進
      return { ok: true, nothing: true, state: st.state };
    }
    // storage 事件、切回頁面時呼叫：事件只當通知，一律重讀當下的原文比對（事件可能延後，事件裡的值可能過期）
    // 設計 S3：只有 ok===true 才能讓畫面前進；error＝"READ" 時畫面停在原處、顯示「暫時讀不到紀錄，請再試一次」
    function check() {
      var f = refresh();
      return f === "changed" ? changed() : { ok: f === "ok", error: f === "fail" ? "READ" : null, state: st.state };
    }
    function invalidate() { st.stale = true; return changed(); }   // 同步程式已經換掉存檔（onReplaced）：不必比對，直接失效
    function watches(key) { return key === null || key === LS_KEY; }   // clear() 的事件 key 是 null；別站 key、probe、舊版 key 都不理
    // 孩子按「載入最新紀錄」或自動重載前：明確取消舊的待存操作；在這個分頁記下「重載後提示」（寫不進只是少了提示，安全不靠它）
    function prepareReload() { st.pendingAction = null; sSet(NOTICE, "1"); }
    function accepted(id) { return st.state.ops.indexOf(id) >= 0; }   // 畫面只在「這個操作 ID 真的寫進去了」才公布結果
    function discardBroken() {   // 家長明確按「清除壞掉的存檔，重新開始」：一樣先驗證、寫入成功才公布
      if (st.loadError !== "SCHEMA") return false;
      if (refresh() !== "ok") return false;   // 壞存檔在這期間被別處換掉了：不蓋掉，讓畫面重載
      var b0 = blankState();
      if (checkState(b0, bank).length) return false;
      try { storage.setItem(LS_KEY, JSON.stringify(b0)); lastRaw = JSON.stringify(b0); } catch (e) { st.saveStatus = "failed"; return false; }
      st.loadError = null; st.migrateReason = null; st.state = b0; st.saveStatus = "ok"; st.pendingAction = null;
      return true;
    }
    return { get: function () { return st; }, load: load, dispatch: dispatch, retry: retry, accepted: accepted, discardBroken: discardBroken,
             check: check, invalidate: invalidate, watches: watches, prepareReload: prepareReload,
             restoreLegacy: restoreLegacy, retryArchive: retryArchive,
             view: function () { return view(st.state, env()); }, env: env };
  }

  /* ---------- 溶解帳本（矩陣 21–23）：重量由物質帳本算，溶解按經過時間，不按幀數 ---------- */
  var DISSOLVE = { base: 210, cube: 10, spoon: 6, saltCap: 30, coldRate: 1, hotRate: 2, stirFactor: 2 };
  function dissolveNew() {
    return { base: DISSOLVE.base, sugarTotal: 0, sugarDissolved: 0, saltTotal: 0, hot: false, stir: false, last: null, sugarDoneAt: null, sugarStart: null };
  }
  function dissolveRate(m) { return (m.hot ? DISSOLVE.hotRate : DISSOLVE.coldRate) * (m.stir ? DISSOLVE.stirFactor : 1); }
  function dissolveAddSugar(m, now) {
    var n = clone(m); n.sugarTotal += DISSOLVE.cube; n.last = now; n.sugarStart = now; n.sugarDoneAt = null; return n;
  }
  function dissolveAddSalt(m) { var n = clone(m); n.saltTotal += DISSOLVE.spoon; return n; }
  function dissolveStep(m, now) {
    var n = clone(m);
    if (n.last === null) { n.last = now; return n; }
    var dt = Math.max(0, now - n.last) / 1000, left = n.sugarTotal - n.sugarDissolved, r = dissolveRate(n);
    if (left > 0 && dt > 0) {
      if (r * dt >= left - 1e-9) { n.sugarDissolved = n.sugarTotal; n.sugarDoneAt = n.last + left / r * 1000; }
      else n.sugarDissolved += r * dt;
    }
    n.last = now;
    return n;
  }
  function dissolveRead(m) {
    var saltDissolved = Math.min(m.saltTotal, DISSOLVE.saltCap);
    return { sugarSolid: round6(m.sugarTotal - m.sugarDissolved), sugarDissolved: round6(m.sugarDissolved),
             saltDissolved: saltDissolved, saltSolid: m.saltTotal - saltDissolved,
             scaleMass: m.base + m.sugarTotal + m.saltTotal, sugarTotal: m.sugarTotal, saltTotal: m.saltTotal };
  }
  function round6(x) { return Math.round(x * 1e6) / 1e6; }

  /* ---------- 影子（矩陣 24） ---------- */
  // 方位以北 0°、東 90° 順時針；影子在太陽的對面，長度＝竿高÷tan(高度角)；太陽在地平線下就沒有影子
  function shadowFromSun(az, alt, h) {
    h = h === undefined ? 1 : h;
    if (!(alt > 0)) return { az: null, len: null };
    var len = h / Math.tan(alt * Math.PI / 180);
    return { az: ((az + 180) % 360 + 360) % 360, len: Math.abs(len) < 1e-12 ? 0 : len };
  }
  function dirName(az) { var D = ["北", "東北", "東", "東南", "南", "西南", "西", "西北"]; return D[Math.round((((az % 360) + 360) % 360) / 45) % 8]; }

  var api = {
    LS_KEY: LS_KEY, LS_V1: LS_V1, LS_ARC: LS_ARC, DISSOLVE: DISSOLVE, EXAM: EXAM,
    dayKey: dayKey, isDay: isDay, addDays: addDays, diffDays: diffDays, weekday: weekday,
    validCard: validCard, blankState: blankState, reduce: reduce, view: view, endTitle: endTitle, exitList: exitList,
    checkState: checkState, decode: decode, migrateV1: migrateV1, createStore: createStore,
    cardState: cardState, cardById: cardById, conceptOn: conceptOn, allCards: allCards,
    dissolveNew: dissolveNew, dissolveAddSugar: dissolveAddSugar, dissolveAddSalt: dissolveAddSalt,
    dissolveStep: dissolveStep, dissolveRead: dissolveRead, shadowFromSun: shadowFromSun, dirName: dirName
  };
  if (typeof module !== "undefined" && module.exports) module.exports = api; else root.G5Core = api;
})(typeof window !== "undefined" ? window : this);
