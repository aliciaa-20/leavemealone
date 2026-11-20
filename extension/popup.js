// Toolbar popup: overall status first, then what needs attention, what-if, pending items, settings.
const CUE_URL = "https://cue.christuniversity.in/main/attendence";
const ROMAN = { I: 1, II: 2, III: 3, IV: 4, V: 5, VI: 6, VII: 7, VIII: 8 };
const rank = (n) => ROMAN[/\b(VIII|VII|VI|V|IV|III|II|I)\s*$/.exec(n.toUpperCase())?.[1]] || 0;
const { h, plural, fmt, tone, bar, dayLabel, ico, sep, chip, stepper, toggle, acc, absentSummary, absentDays, spotlight } = UI;
const ago = (t) => {
  const m = Math.round((Date.now() - t) / 60000);
  return m < 1 ? "just now" : m < 60 ? `${m} min ago` : m < 1440 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} d ago`;
};

let D = null;        // storage
let viewSem = null;  // semester shown (defaults to the highest one)
let skip = 0;        // what-if: classes skipped
const confirming = new Set(); // keys of inline "are you sure?" prompts
const accOpen = new Set();    // open accordions ("all", "adj", "settings")

const save = (patch) => chrome.storage.local.set(patch).then(load);

function load() {
  return chrome.storage.local
    .get({ threshold: 75, alerts: true, snapshots: {}, latest: null, adjust: {}, excused: {}, timetable: null, bunkBasis: "now", eseTarget: undefined, absentList: null })
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
function draw() {
  const app = document.getElementById("app");
  const y = document.documentElement.scrollTop; // a redraw rebuilds everything: keep the scroll position
  const snap = D.snapshots[viewSem];
  if (!snap) {
    app.replaceChildren(
      h("div", { class: "blk free" }, h("div", { class: "h3" }, "No attendance data yet"), h("p", { class: "sub" }, "Open the CUE attendance page once (table view) and it will appear here."), openBtn())
    );
    return;
  }
  const thr = D.threshold, t = thr / 100;
  const adj = D.adjust[viewSem] || { cocurricular: 0, courses: {} };
  const eff = Calc.effective(snap, adj, {}); // the portal's own numbers (plus typed adjustments) drive everything on screen
  const effM = Calc.effective(snap, adj, D.excused[viewSem]); // the same with your reclassified hours: only the Reclassified card shows it
  const o = eff.overall;
  const op = Calc.percent(o.attended, o.scheduled);
  const courses = eff.courses.filter((c) => c.scheduled > 0); // portal order, on purpose
  const pc = (c) => Calc.percent(c.attended, c.scheduled);
  const low = courses.filter((c) => pc(c) < thr);
  const sems = Object.keys(D.snapshots).sort((a, b) => rank(b) - rank(a));
  const tn = tone(op, thr);
  const toggleAcc = (id) => (v) => { v ? accOpen.add(id) : accOpen.delete(id); draw(); };

  // ---- 1. overall
  const header = h("div", { class: "top" },
    sems.length > 1
      ? h("select", { "aria-label": "Semester", onchange: (e) => { viewSem = e.target.value; draw(); } }, sems.map((s) => h("option", { value: s, selected: s === viewSem }, s)))
      : h("span", { class: "t" }, viewSem),
    h("span", { class: "sub" }, `synced ${ago(snap.syncedAt)}`));
  const after = Calc.afterSkipping(o.attended, o.scheduled, skip);
  const overall = h("div", { class: `hero w-${tn}` },
    h("div", { class: "row" }, h("span", { class: "v", style: `color:var(--${tn})` }, `${op.toFixed(1)}%`), h("span", { class: "sub" }, `${fmt(o.attended)} / ${o.scheduled}h`)),
    bar(op, thr),
    low.length ? h("p", {}, h("b", {}, plural(low.length, "course")), ` ${low.length > 1 ? "are" : "is"} below ${thr}%.`) : h("p", {}, `All courses are at or above ${thr}%.`),
    skip ? h("p", { class: "sub" }, `After skipping ${skip}: overall ${after.toFixed(1)}%.`) : null,
    o.medical ? h("p", { class: "sub" }, `Medical ${fmt(o.medical)}h: ${Calc.medicalText(o)}`) : null,
    o.ccIncluded ? h("p", { class: "sub" }, "Co-curricular is already included by the portal.") : null);

  // ---- exam countdown, best days to bunk (top 3; the full planner lives in the drawer on CUE)
  let examCard = null, bestCard = null;
  if (viewSem === D.latest) {
    const n = new Date();
    const today = new Date(n.getFullYear(), n.getMonth(), n.getDate());
    const from = Cal.addDays(today, 1);
    const basis = Plan.resolveBasis(D.bunkBasis, from);
    const esePct = Math.min(100, Math.max(1, D.eseTarget ?? thr));
    const line = Plan.thresholdFor(basis, t, esePct);

    const days = (d) => plural(Math.round((d - today) / 86400000), "day");
    const mse = Cal.mseWindow(today), mseCut = Cal.cutoff("mse", from), eseEnd = Cal.semesterEnd(from);
    const tiles = [];
    if (mse && mse.from > today) tiles.push(h("div", {}, h("b", {}, days(mse.from)), h("span", {}, "to MSE", sep(), `need ${Math.round(Plan.MSE_MIN * 100)}%`)));
    if (eseEnd) tiles.push(h("div", {}, h("b", {}, days(eseEnd)), h("span", {}, "to ESE", sep(), `target ${esePct}%`)));
    const notes = [];
    if (mse && mse.from > today && mseCut) notes.push(`MSE starts ${dayLabel(mse.from)}, attendance counts till ${dayLabel(mseCut)}.`);
    const mb = D.timetable && mseCut ? Plan.budgets({ eff, tt: D.timetable, basis: "mse", t: Plan.MSE_MIN, from }) : null;
    if (mb) {
      const sure = mb.rows.filter((r) => r.matched); // courses missing from the timetable can't be judged
      const none = sure.filter((r) => r.reachable && r.budget === 0).length, out = sure.filter((r) => !r.reachable).length;
      if (none) notes.push(`${plural(none, "course")} with no spare classes before MSE.`);
      if (out) notes.push(`${plural(out, "course")} out of reach for MSE.`);
    }
    if (tiles.length || notes.length) examCard = h("div", {}, tiles.length ? h("div", { class: "exam" }, tiles) : null, notes.map((x) => h("div", { class: "sub note" }, x)));

    if (!D.timetable) {
      bestCard = h("div", {}, h("div", { class: "sec" }, "Best days to bunk"), h("div", { class: "sub" }, "Open your CUE timetable once to unlock bunk planning."));
    } else if (basis !== "now") { // before an exam any safe day is as good as another, so no list: just the planner
      bestCard = openBtn("Plan on CUE");
    } else {
      const best = Plan.bestDays({ eff, tt: D.timetable, courses: eff.courses, basis, t: line, from, limit: 3 });
      bestCard = h("div", {},
        h("div", { class: "sec" }, best.days.some((b) => b.safe) ? "Best days to bunk" : "Least risky days"),
        best.days.length
          ? h("div", { class: "blk" }, best.days.map((b) => {
              return h("div", { class: "it2" },
                h("div", { class: "row" }, h("b", {}, dayLabel(b.date)), chip(b.safe ? "good" : "bad", b.safe ? "safe" : "risky")),
                h("div", { class: "sub" }, plural(b.classes, "class")),
                b.breakDays >= 3 ? h("div", { class: "brk" }, chip("mute", `${b.breakDays}-day break`, `${b.breakDays} days off in a row if you skip this day`), b.breakNames.length ? h("span", { class: "sub" }, b.breakNames.join(", ")) : null) : null);
            }))
          : h("div", { class: "sub" }, basis === "mse" ? "No class days left before MSE." : "No class days left this semester."),
        openBtn("Plan on CUE"));
    }
  }

  // ---- what-if
  const whatIf = h("div", { class: "row", style: "margin-top:16px" },
    h("span", {}, "If I skip the next"),
    h("span", { class: "row" }, stepper(skip, { min: 0, max: 999, label: "classes to skip", onchange: (v) => { skip = v; draw(); } }), h("span", {}, "classes")));

  // ---- needs attention, then safe to skip (top 3) and every course
  const needs = h("div", {},
    h("div", { class: "sec" }, "Needs attention"),
    low.length ? h("div", { class: "blk" }, low.map((c) => courseRow(c, thr, t, false))) : h("div", { class: "sub" }, `Nothing below ${thr}%.`));
  const safe = courses.filter((c) => pc(c) >= thr).map((c) => ({ c, n: Calc.canSkip(c.attended, c.scheduled, t) })).filter((x) => x.n > 0).sort((a, b) => b.n - a.n).slice(0, 3);
  const safeBox = h("div", {},
    h("div", { class: "sec" }, "Safe to skip"),
    safe.length ? h("div", { class: "blk" }, safe.map(({ c }) => courseRow(c, thr, t, false))) : h("div", { class: "sub" }, "No spare hours right now."),
    acc({ title: "All courses", icon: "list", tone: "pick", sub: `${plural(courses.length, "course")}, including the ones above`, open: accOpen.has("all"), ontoggle: toggleAcc("all") }, courses.map((c) => courseRow(c, thr, t, true))));

  // ---- your marks (pending on the portal)
  const marked = effM.courses.filter((c) => c.scheduled > 0 && (c.excusedHrs || c.goneHrs));
  const markedHrs = marked.reduce((n, c) => n + (c.excusedHrs || 0) + (c.goneHrs || 0), 0);
  const pending = marked.length
    ? acc({ title: "Reclassified absences", icon: "checks", tone: "blue", sub: [`${fmt(markedHrs)}h moved out of absent`, sep(), plural(marked.length, "course")], open: accOpen.has("marks"), ontoggle: toggleAcc("marks") },
        h("div", { class: "sub", style: "padding: 12px 0 4px" }, "Absent hours you reclassified on the portal. Everything else here uses the portal's own numbers; this card shows what they would be with your marks.",
          h("div", { style: "margin-top:6px" }, "Overall: ", h("b", { class: tone(Calc.percent(effM.overall.attended, effM.overall.scheduled), thr) }, `${Calc.percent(effM.overall.attended, effM.overall.scheduled).toFixed(1)}%`), ` with marks, ${op.toFixed(1)}% on the portal`)),
        marked.map((c) => {
          const parts = [[c.laterHrs, "later"], [c.ccHrs, "co-curricular"], [c.medHrs, "medical"]].filter(([x]) => x).map(([x, n]) => `${fmt(x)}h ${n}`);
          const key = `clear:${c.key}`;
          return h("div", { class: "it2" },
            h("div", { class: "row" }, h("span", {}, h("b", {}, c.code || c.name)), c.excusedHrs
              ? confirming.has(key)
                ? h("span", {}, h("span", { class: "bad" }, "Clear marks? "), h("button", { class: "link", onclick: () => { confirming.delete(key); delete D.excused[viewSem][c.key]; save({ excused: D.excused }); } }, "yes"), sep(), h("button", { class: "link", onclick: () => { confirming.delete(key); draw(); } }, "no"))
                : h("button", { class: "link", onclick: () => { confirming.add(key); draw(); } }, "clear")
              : null),
            parts.length ? h("div", { class: "sub" }, parts.join(", "), c.excusedHrs ? [sep(), `${pc(courses.find((x) => x.key === c.key) || c).toFixed(1)}% → `, h("b", { class: tone(pc(c), thr) }, `${pc(c).toFixed(1)}%`)] : null) : null,
            c.goneHrs ? h("div", { class: "sub warn" }, `${fmt(c.goneHrs)}h updated on the portal: open its View Details and press Confirm present.`) : null,
            c.stale && !c.goneHrs ? h("div", { class: "sub warn" }, "The portal's numbers changed since you marked this. Check it.") : null);
        }),
        effM.overall.goneHrs ? openBtn("Open CUE to confirm") : null)
    : null;

  // ---- absent hours day by day (saved when the all-courses absent list is opened on CUE)
  const al = D.absentList && D.absentList.sem === viewSem && D.absentList.rows.length ? D.absentList : null;
  const absBox = acc({
    title: "Absent hours", icon: "userx", tone: "bad", sub: al ? absentSummary(al.rows) : "Not saved yet",
    open: accOpen.has("abs"), ontoggle: toggleAcc("abs") },
    al ? absentDays(al.rows) : h("div", { class: "sub", style: "padding-top:12px" }, "Open the Absent card on the CUE attendance page once and the list will appear here."));

  // ---- holidays and the MSE week, month by month, from today to the end of the semester
  let holBox = null;
  {
    const n = new Date(), today = new Date(n.getFullYear(), n.getMonth(), n.getDate());
    const to = Cal.semesterEnd(today) || Cal.addDays(today, 150);
    const events = Cal.holidays(today, to).map((x) => ({ date: x.date, name: x.name }));
    const mse = Cal.mseWindow(today);
    if (mse && mse.from >= today) events.push({ date: mse.from, name: `MSE begins, until ${dayLabel(mse.to)}`, tag: "MSE" });
    events.sort((a, b) => a.date - b.date);
    if (events.length) {
      const months = [];
      for (const e of events) {
        const label = e.date.toLocaleDateString("en-IN", { month: "long", year: "numeric" });
        let m = months[months.length - 1];
        if (!m || m.label !== label) months.push((m = { label, rows: [] }));
        m.rows.push(e);
      }
      const next = events[0];
      const daysTo = (d) => Math.round((d - today) / 86400000);
      const when = (d) => (daysTo(d) === 0 ? "today" : daysTo(d) === 1 ? "tomorrow" : `in ${daysTo(d)} days`);
      let i = 0;
      holBox = acc({ title: "Holidays", sub: [`Next: ${dayLabel(next.date)}`, sep(), when(next.date)], icon: "cal", tone: "gold",
        open: accOpen.has("hol"), ontoggle: toggleAcc("hol") },
        months.map((m) => [
          h("div", { class: "pday" }, h("b", {}, m.label), h("span", { class: "sub" }, plural(m.rows.length, "date"))),
          m.rows.map((e) => {
            const br = Plan.breakLength(e.date), tn = e.tag ? "blue" : e === next ? "gold" : "mute";
            return h("div", { class: `hrow${e === next ? " next" : ""}`, style: `--i:${i++}` },
              h("span", { class: `dbadge t-${tn}` }, h("small", {}, e.date.toLocaleDateString("en-IN", { month: "short" })), h("b", {}, String(e.date.getDate()))),
              h("span", { class: "hx" }, h("b", {}, e.name), h("span", { class: "sub" }, e.date.toLocaleDateString("en-IN", { weekday: "long" }), e.tag ? chip("blue", e.tag) : br.n >= 3 ? chip("mute", `${br.n}-day break`, `${br.n} days off in a row`) : null)),
              h("span", { class: "hr sub" }, when(e.date)));
          }),
        ]));
    }
  }

  // ---- adjustments (rare path) and settings
  const num = (v, label, onchange) => stepper(v || 0, { min: 0, max: 999, label, onchange });
  const adjBox = acc({ title: "Add hours the portal is missing", icon: "clock", tone: "good", sub: "For a class the portal has not counted", open: accOpen.has("adj"), ontoggle: toggleAcc("adj") },
    D.snapshots[viewSem].hasCc
      ? h("div", { class: "sub", style: "padding-top:12px" }, "Co-curricular claims aren't needed: the portal already includes them.")
      : h("div", { class: "row", style: "padding-top:12px" }, h("span", { class: "lbl" }, "Co-curricular hours pending"), num(adj.cocurricular, "co-curricular hours", (v) => {
          const adjust = D.adjust; (adjust[viewSem] = adjust[viewSem] || { cocurricular: 0, courses: {} }).cocurricular = v;
          save({ adjust });
        })),
    h("div", { class: "th" }, h("span", {}, "Attended"), h("span", {}, "Held")),
    courses.map((c) => h("div", { class: "row", style: "padding:3px 0" }, h("span", { class: "lbl", title: c.name }, c.code || c.name),
      h("span", { class: "row" }, num(c.adj.att, `${c.code || c.name} attended`, (v) => setCourseAdj(viewSem, c, "att", v)), num(c.adj.sch, `${c.code || c.name} held`, (v) => setCourseAdj(viewSem, c, "sch", v))))),
    h("div", { class: "sub", style: "margin-top:8px" }, "Went to an extra class the portal hasn't counted? Add 1 under Attended and 1 under Held."));

  const settings = acc({ title: "Settings", icon: "sliders", tone: "mute", sub: "Your minimum and the daily alert", open: accOpen.has("settings"), ontoggle: toggleAcc("settings") },
    h("div", { class: "row", style: "padding-top:12px" }, h("span", {}, "Minimum attendance %"), stepper(D.threshold, { min: 1, max: 100, label: "minimum attendance", onchange: (v) => save({ threshold: v }) })),
    h("div", { class: "row", style: "margin-top:12px" }, h("span", {}, "ESE target %"), stepper(Math.min(100, Math.max(1, D.eseTarget ?? D.threshold)), { min: 1, max: 100, label: "ESE target", onchange: (v) => save({ eseTarget: v }) })),
    h("div", { class: "row", style: "margin-top:12px" }, h("span", {}, "Daily alert if a course is low"), toggle(D.alerts !== false, (v) => save({ alerts: v }), "Daily alert")),
    h("div", { class: "it2", style: "margin-top:12px" },
      h("div", { class: "row" }, h("span", {}, "Saved attendance data"),
        confirming.has("wipe")
          ? h("span", {}, h("span", { class: "bad" }, "Erase? "), h("button", { class: "link", onclick: () => { confirming.delete("wipe"); viewSem = null; chrome.storage.local.remove(["snapshots", "latest", "adjust", "excused", "lastCourse", "timetable", "absentList"]).then(load); } }, "yes"), sep(), h("button", { class: "link", onclick: () => { confirming.delete("wipe"); draw(); } }, "no"))
          : h("button", { class: "btn danger sm", onclick: () => { confirming.add("wipe"); draw(); } }, "Erase")),
      h("div", { class: "sub", style: "margin-top:4px" }, "Removes synced attendance, your marks, adjustments and timetable from this browser. Settings stay, and the portal is untouched.")));

  app.replaceChildren(...[header, overall, examCard, bestCard, whatIf, needs, safeBox, absBox, pending, holBox, adjBox, settings, bestCard && D.timetable ? null : openBtn(), h("div", { class: "tagline" }, "Vibecoded UI just like this website, but better")].filter(Boolean));
  document.documentElement.scrollTop = y;
}

function courseRow(c, thr, t, showAfter) {
  const pct = Calc.percent(c.attended, c.scheduled);
  const skipN = Calc.canSkip(c.attended, c.scheduled, t);
  const adjusted = !!(c.adj.att || c.adj.sch || c.excusedHrs);
  const tip = adjusted ? `Includes your own changes. Portal ${c.portalAttended}/${c.portalScheduled}, with your marks ${fmt(c.attended)}/${c.scheduled}` : "";
  const status = pct < thr ? chip("bad", `attend next ${Calc.mustAttend(c.attended, c.scheduled, t)}`) : chip(skipN ? "good" : "warn", skipN ? `can skip ${skipN}` : "no spare");
  const num = h("span", { class: "p", style: `color:var(--${tone(pct, thr)})` }, `${pct.toFixed(0)}%`);
  const afterN = skip && showAfter ? h("span", { class: "to" }, `→ ${Calc.afterSkipping(c.attended, c.scheduled, skip).toFixed(0)}%`) : null;
  return h("div", { class: "it2" },
    h("div", { class: "row" },
      h("span", {}, h("b", { class: "nm", title: c.name }, c.name || c.code),
        c.code || adjusted ? h("div", { class: "cl" }, c.code ? h("span", { class: "sub" }, c.code) : null, adjusted ? chip("mute", "adj", tip) : null) : null),
      afterN ? h("span", { class: "rr" }, h("span", {}, num, afterN), status) : h("span", {}, num, " ", status)),
    bar(pct, thr));
}

function openBtn(text = "Open CUE") {
  return h("button", { class: "btn solid cta", onclick: () => chrome.tabs.create({ url: CUE_URL }) }, text, ico("out"));
}

spotlight(document.body);
load();
