// Toolbar popup: overall status first, then what needs attention, what-if, pending items, settings.
const CUE_URL = "https://cue.christuniversity.in/main/attendence";
const ROMAN = { I: 1, II: 2, III: 3, IV: 4, V: 5, VI: 6, VII: 7, VIII: 8 };
const rank = (n) => ROMAN[/\b(VIII|VII|VI|V|IV|III|II|I)\s*$/.exec(n.toUpperCase())?.[1]] || 0;
const fmt = (n) => (Number.isInteger(n) ? String(n) : n.toFixed(1));
const tone = (pct, thr) => (pct < thr ? "bad" : pct < thr + 10 ? "warn" : "good");

const h = (tag, attrs = {}, ...kids) => {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k.startsWith("on")) el.addEventListener(k.slice(2), v);
    else if (k === "class") el.className = v;
    else if (v !== false && v != null) el.setAttribute(k, v === true ? "" : v);
  }
  el.append(...kids.flat().filter((x) => x != null && x !== false));
  return el;
};
const bar = (pct, thr) =>
  h("div", { class: "bar" }, h("i", { class: tone(pct, thr), style: `width:${Math.min(100, Math.max(0, pct))}%` }), h("b", { style: `left:${thr}%` }));
const ago = (t) => {
  const m = Math.round((Date.now() - t) / 60000);
  return m < 1 ? "just now" : m < 60 ? `${m} min ago` : m < 1440 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} d ago`;
};

let D = null;        // storage
let viewSem = null;  // semester shown (defaults to the highest one)
let skip = 0;        // what-if: classes skipped
const confirming = new Set(); // keys of inline "are you sure?" prompts

const save = (patch) => chrome.storage.local.set(patch).then(load);

function load() {
  return chrome.storage.local
    .get({ threshold: 75, alerts: true, snapshots: {}, latest: null, adjust: {}, excused: {}, timetable: null, bunkBasis: "now", eseTarget: undefined })
    .then((d) => {
      D = d;
      if (!viewSem || !d.snapshots[viewSem]) viewSem = d.latest || Object.keys(d.snapshots).sort((a, b) => rank(b) - rank(a))[0];
      draw();
    });
}

function setCourseAdj(sem, c, field, val) {
  const adjust = D.adjust;
  const s = (adjust[sem] = adjust[sem] || { cocurricular: 0, courses: {} });
  const x = (s.courses[c.key] = s.courses[c.key] || { att: 0, sch: 0 });
  x[field] = Math.max(0, parseFloat(val) || 0);
  x.baseSch = c.portalScheduled; // remember what the portal showed when this was entered
  save({ adjust });
}
const numInput = (value, onchange, title) =>
  h("input", { type: "number", min: 0, step: 1, value: value || 0, title, onchange: (e) => onchange(e.target.value) });

function draw() {
  const app = document.getElementById("app");
  const snap = D.snapshots[viewSem];
  if (!snap) {
    app.replaceChildren(
      h("div", { class: "card" }, h("div", { class: "title" }, "No attendance data yet"), h("p", { class: "sub" }, "Open the CUE attendance page once (table view) and it will appear here."), openBtn())
    );
    return;
  }
  const thr = D.threshold, t = thr / 100;
  const adj = D.adjust[viewSem] || { cocurricular: 0, courses: {} };
  const eff = Calc.effective(snap, adj, D.excused[viewSem]);
  const o = eff.overall;
  const op = Calc.percent(o.attended, o.scheduled);
  const courses = eff.courses.filter((c) => c.scheduled > 0); // portal order, on purpose
  const pc = (c) => Calc.percent(c.attended, c.scheduled);
  const low = courses.filter((c) => pc(c) < thr);
  const sems = Object.keys(D.snapshots).sort((a, b) => rank(b) - rank(a));

  // ---- 1. overall
  const header = h(
    "div",
    { class: "row", style: "margin-bottom:10px" },
    sems.length > 1
      ? h("select", { "aria-label": "Semester", onchange: (e) => { viewSem = e.target.value; draw(); } }, sems.map((s) => h("option", { value: s, selected: s === viewSem }, s)))
      : h("span", { class: "title" }, viewSem),
    h("span", { class: "sub" }, `synced ${ago(snap.syncedAt)}`)
  );
  const after = Calc.afterSkipping(o.attended, o.scheduled, skip);
  const overall = h(
    "div",
    { class: "card" },
    h("div", { class: "row" }, h("span", { class: `big ${tone(op, thr)}` }, `${op.toFixed(1)}%`), h("span", { class: "sub" }, `${fmt(o.attended)} / ${o.scheduled} hrs`)),
    bar(op, thr),
    h("div", { class: "note" }, low.length ? h("span", { class: "bad" }, `${low.length} course${low.length > 1 ? "s" : ""} below ${thr}%`) : h("span", { class: "good" }, `All courses are at or above ${thr}%`)),
    skip ? h("div", { class: "note muted" }, `After skipping ${skip}: overall ${after.toFixed(1)}%`) : null,
    o.medical ? h("div", { class: "note", style: "color:var(--primary)" }, `Medical ${fmt(o.medical)} h: ${Calc.medicalText(o)}`) : null,
    o.ccIncluded ? h("div", { class: "note muted" }, "Co-curricular is already included by the portal.") : null
  );

  // ---- best days to bunk (top 3; full planner lives in the drawer on CUE)
  let bestCard = null, examCard = null;
  if (viewSem === D.latest) {
    const n = new Date();
    const today = new Date(n.getFullYear(), n.getMonth(), n.getDate());
    const from = Cal.addDays(today, 1);
    const label = (d) => d.toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short" });
    const basis = Plan.resolveBasis(D.bunkBasis, from);
    const line = Plan.thresholdFor(basis, t, Math.min(100, Math.max(1, D.eseTarget ?? thr)));

    // ---- exam countdown + MSE budget summary
    const inDays = (d) => { const k = Math.round((d - today) / 86400000); return k === 1 ? "1 day" : `${k} days`; };
    const mse = Cal.mseWindow(today), mseCut = Cal.cutoff("mse", from), eseEnd = Cal.semesterEnd(from);
    const lines = [];
    if (mse && mse.from > today) lines.push(`MSE in ${inDays(mse.from)} (${label(mse.from)})${mseCut ? ` · attendance counts till ${label(mseCut)}` : ""}`);
    if (eseEnd) lines.push(`ESE cutoff in ${inDays(eseEnd)} (${label(eseEnd)})`);
    const mb = D.timetable && mseCut ? Plan.budgets({ eff, tt: D.timetable, basis: "mse", t: Plan.MSE_MIN, from }) : null;
    if (mb) {
      const sure = mb.rows.filter((r) => r.matched); // courses missing from the timetable can't be judged
      const none = sure.filter((r) => r.reachable && r.budget === 0).length, out = sure.filter((r) => !r.reachable).length;
      const parts = [none ? `${none} with no spare classes before MSE` : null, out ? `${out} out of reach for MSE` : null].filter(Boolean);
      if (parts.length) lines.push(parts.join(" · "));
    }
    if (lines.length) examCard = h("div", { class: "card" }, lines.map((x) => h("div", { class: "sub" }, x)));
    if (!D.timetable) {
      bestCard = h("div", {}, h("div", { class: "sec" }, "Best days to bunk"),
        h("div", { class: "sub" }, "Open your CUE timetable once to unlock bunk planning."));
    } else {
      const best = Plan.bestDays({ eff, tt: D.timetable, courses: eff.courses, basis, t: line, from, limit: 3 });
      bestCard = h("div", {},
        h("div", { class: "sec" }, "Best days to bunk"),
        h("div", { class: "card" },
          best.days.length
            ? best.days.map((b) => h("div", { class: "course" },
                h("div", { class: "row" }, h("b", {}, label(b.date)), h("span", { class: `chip ${b.safe ? "good" : "bad"}` }, b.safe ? "safe" : "risky")),
                h("div", { class: "sub" }, [`${b.classes} class${b.classes > 1 ? "es" : ""}`, ...b.tags].join(" · "))))
            : h("div", { class: "sub" }, basis === "mse" ? "No class days left before MSE." : "No class days left this semester."),
          h("div", { style: "margin-top:8px" }, openBtn("Plan on CUE"))));
    }
  }

  // ---- 2. needs attention (portal order)
  const needs = h(
    "div",
    {},
    h("div", { class: "sec" }, "Needs attention"),
    low.length
      ? h("div", { class: "card" }, low.map((c) => courseRow(c, thr, t, false)))
      : h("div", { class: "sub" }, "Nothing below the minimum.")
  );

  // ---- 3. safe to skip (top 3) + all courses
  const safe = courses.filter((c) => pc(c) >= thr).map((c) => ({ c, n: Calc.canSkip(c.attended, c.scheduled, t) })).filter((x) => x.n > 0).sort((a, b) => b.n - a.n).slice(0, 3);
  const safeBox = h(
    "div",
    {},
    h("div", { class: "sec" }, "Safe to skip"),
    safe.length ? h("div", { class: "card" }, safe.map(({ c }) => courseRow(c, thr, t, false))) : h("div", { class: "sub" }, "No spare hours right now."),
    h("details", {}, h("summary", {}, "Show all courses"), h("div", { class: "card" }, courses.map((c) => courseRow(c, thr, t, true))))
  );

  // ---- 4. what-if
  const whatIf = h(
    "div",
    { class: "row", style: "margin:10px 0" },
    h("span", {}, "If I skip the next"),
    h(
      "span",
      { class: "stepper" },
      h("button", { "aria-label": "Fewer", onclick: () => { skip = Math.max(0, skip - 1); draw(); } }, "−"),
      h("b", {}, String(skip)),
      h("button", { "aria-label": "More", onclick: () => { skip += 1; draw(); } }, "+")
    ),
    h("span", {}, "classes")
  );

  // ---- 5. pending on the portal
  const marked = courses.filter((c) => c.excusedHrs || c.goneHrs);
  const pending = marked.length
    ? h(
        "div",
        {},
        h("div", { class: "sec" }, "Your marks"),
        h(
          "div",
          { class: "card" },
          marked.map((c) => {
            const parts = [[c.laterHrs, "later"], [c.ccHrs, "co-curricular"], [c.medHrs, "medical"]].filter(([x]) => x).map(([x, n]) => `${fmt(x)} h ${n}`);
            const key = `clear:${c.key}`;
            return h(
              "div",
              { class: "course" },
              h("div", { class: "row" }, h("b", {}, c.code || c.name), c.excusedHrs
                ? confirming.has(key)
                  ? h("span", {}, h("span", { class: "bad" }, "Clear marks? "), h("button", { class: "link", onclick: () => { confirming.delete(key); delete D.excused[viewSem][c.key]; save({ excused: D.excused }); } }, "yes"), " · ", h("button", { class: "link", onclick: () => { confirming.delete(key); draw(); } }, "no"))
                  : h("button", { class: "link", onclick: () => { confirming.add(key); draw(); } }, "clear")
                : null),
              parts.length ? h("div", { class: "sub" }, parts.join(", ")) : null,
              c.goneHrs ? h("div", { class: "note warn" }, `${fmt(c.goneHrs)} h updated on the portal: open its View Details and press Confirm present.`) : null,
              c.stale && !c.goneHrs ? h("div", { class: "note warn" }, "The portal's numbers changed since you marked this. Check it.") : null
            );
          }),
          o.goneHrs ? openBtn("Open CUE to confirm") : null
        )
      )
    : null;

  // ---- 6. adjustments (rare path)
  const adjBox = h(
    "details",
    {},
    h("summary", {}, "Adjustments (hours not on the portal)"),
    h(
      "div",
      { class: "card" },
      D.snapshots[viewSem].hasCc
        ? h("div", { class: "sub" }, "Co-curricular claims aren't needed: the portal already includes them.")
        : h("div", { class: "row" }, h("span", {}, "Co-curricular claimed (hrs)"), numInput(adj.cocurricular, (v) => {
            const adjust = D.adjust; (adjust[viewSem] = adjust[viewSem] || { cocurricular: 0, courses: {} }).cocurricular = Math.max(0, parseFloat(v) || 0);
            save({ adjust });
          }, "Adds to the overall aggregate only")),
      h("div", { class: "sub", style: "margin:8px 0 2px" }, "Extra class or late entry: +attended / +held"),
      courses.map((c) =>
        h("div", { class: "row", style: "padding:2px 0" }, h("span", {}, c.code || c.name), h("span", {}, numInput(c.adj.att, (v) => setCourseAdj(viewSem, c, "att", v), "Hours you attended that the portal hasn't added"), " ", numInput(c.adj.sch, (v) => setCourseAdj(viewSem, c, "sch", v), "Hours held that the portal hasn't added")))
      )
    )
  );

  // ---- 7. footer / settings
  const settings = h(
    "details",
    {},
    h("summary", {}, "Settings"),
    h(
      "div",
      { class: "card" },
      h("div", { class: "row" }, h("span", {}, "Minimum attendance %"), h("input", { type: "number", min: 1, max: 100, value: D.threshold, onchange: (e) => save({ threshold: Math.min(100, Math.max(1, parseFloat(e.target.value) || 75)) }) })),
      h("label", { class: "row", style: "margin-top:8px" }, h("span", {}, "Daily alert if a course is low"), h("input", { type: "checkbox", checked: D.alerts !== false, onchange: (e) => save({ alerts: e.target.checked }) }))
    )
  );

  document.getElementById("app").replaceChildren(
    ...[header, overall, examCard, bestCard, whatIf, needs, safeBox, pending, adjBox, settings, h("div", { style: "margin-top:12px" }, openBtn())].filter(Boolean)
  );
}

function courseRow(c, thr, t, showAfter) {
  const pct = Calc.percent(c.attended, c.scheduled);
  const low = pct < thr;
  const skipN = Calc.canSkip(c.attended, c.scheduled, t);
  const chip = low
    ? h("span", { class: "chip bad" }, `attend next ${Calc.mustAttend(c.attended, c.scheduled, t)}`)
    : h("span", { class: `chip ${skipN ? "good" : "warn"}` }, `can skip ${skipN}`);
  const afterPct = Calc.afterSkipping(c.attended, c.scheduled, skip);
  const adjusted = !!(c.adj.att || c.adj.sch || c.excusedHrs);
  return h(
    "div",
    { class: "course", title: adjusted ? `Portal ${c.portalAttended}/${c.portalScheduled} → with your marks ${fmt(c.attended)}/${c.scheduled}` : "" },
    h(
      "div",
      { class: "row" },
      h("div", { class: "name" }, h("span", { class: "code" }, c.code || c.name), adjusted ? h("span", { class: "badge" }, "adj") : null, c.code ? h("div", { class: "full" }, c.name) : null),
      h("div", { style: "text-align:right" }, h("span", { class: `pct ${tone(pct, thr)}` }, `${pct.toFixed(0)}%`), skip && showAfter ? h("span", { class: `muted` }, ` → ${afterPct.toFixed(0)}%`) : null, " ", chip)
    ),
    bar(pct, thr)
  );
}

function openBtn(text = "Open CUE") {
  return h("button", { class: "btn solid", onclick: () => chrome.tabs.create({ url: CUE_URL }) }, text);
}

load();
