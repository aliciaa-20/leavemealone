// CUE attendance helper. Runs on the whole portal host (it is a single-page app, so
// pages change without a reload) and acts by route:
//   /main/attendence    -> parse the course table, save a snapshot, show a pill + drawer,
//                          remember which course's "View Details" you click
//   /main/AbsentDetails -> mark each absent hour as absent / co-curricular / medical / later
//   /main/absence       -> the all-courses absent list: a summary pill; with one course picked in the filter, the same marking panel
//   /main/timeTable     -> save the weekly timetable for the "Plan a bunk" tab
// All UI lives in one Shadow DOM host so the portal's CSS and ours never touch.
(() => {
  // After the extension is reloaded or updated, tabs that were already open keep this script but lose the chrome.* APIs.
  const alive = () => { try { return !!chrome.runtime?.id; } catch { return false; } };
  const store = {
    get: (d) => (alive() ? chrome.storage.local.get(d) : Promise.resolve(d)),
    set: (o) => (alive() ? chrome.storage.local.set(o) : Promise.resolve()),
  };
  const route = () => {
    const p = location.pathname.toLowerCase();
    return p.includes("/main/attendence") ? "att" : p.includes("/main/absentdetails") ? "abs" : p.includes("/main/absence") ? "absall" : p.includes("/main/timetable") ? "tt" : null;
  };
  const pair = (txt) => {
    const m = /(\d+(?:\.\d+)?)\s*\/\s*(\d+(?:\.\d+)?)/.exec(txt || "");
    return m ? [parseFloat(m[1]), parseFloat(m[2])] : null;
  };
  const semester = () => document.querySelector('[role="combobox"]')?.textContent.trim() || "unknown";
  const COURSE_TABLE = 'table[aria-label="coursewise attendance table"]';
  const { h, plural, fmt, tone, mustText, bar, dayLabel, niceDate, nicePeriod, startTime, ico, sep, chip, pills, stepper, acc, tween, placeThumb, absentSummary, absentDays, hrsOf, spotlight } = UI;

  // ---------------------------------------------------------------- parsing
  function parseRow(tr) {
    const th = tr.querySelector("th");
    const tds = tr.querySelectorAll("td");
    if (!th || tds.length < 3) return null;
    const spans = th.querySelectorAll("span.MuiTypography-root");
    const p = pair(tds[0].textContent);
    if (!p) return null;
    let code = (spans[1]?.textContent || "").trim();
    if (code.toUpperCase() === "N/A") code = "";
    const name = (spans[0]?.textContent || "").trim();
    const absent = parseFloat(tds[1].textContent);
    return {
      name, code, key: code || name,
      type: (th.querySelector(".MuiChip-label")?.textContent || "").trim(),
      attended: p[0], scheduled: p[1], absent: Number.isFinite(absent) ? absent : null,
    };
  }

  function parseCourses() {
    const table = document.querySelector(COURSE_TABLE);
    if (!table) return null;
    const courses = [...table.querySelectorAll("tbody tr")].map(parseRow).filter(Boolean);
    if (!courses.length) return null;
    const overallText = document.querySelector('[aria-label^="Overall attendance"]')?.textContent;
    // At semester end the portal adds a "Co-curricular" column and folds those hours into attended.
    const hasCc = [...table.querySelectorAll("thead th")].some((x) => /co-?\s*curricular/i.test(x.textContent));
    return { semester: semester(), syncedAt: Date.now(), overall: pair(overallText), courses, hasCc };
  }

  // Remember which course's details the user is opening (the Absent Details page doesn't say).
  document.addEventListener(
    "click",
    (e) => {
      if (route() !== "att") return;
      const b = e.target.closest?.('button,[role="button"]');
      if (!b) return;
      const label = b.getAttribute("aria-label") || b.textContent || "";
      const tr = b.closest(`${COURSE_TABLE} tr`);
      if (tr && /view details/i.test(label)) {
        const c = parseRow(tr);
        if (c) store.set({ lastCourse: { semester: semester(), key: c.key, name: c.name, at: Date.now() } });
      } else if (/^view absent details/i.test(label)) {
        store.set({ lastCourse: null }); // overall list: not tied to one course
      }
    },
    true
  );

  // ---------------------------------------------------------------- shadow host
  let host, dock, hostPromise, cssText = "";
  async function buildHost() {
    if (!alive()) return; // the extension was reloaded under this tab: tick() shows the notice
    if (!cssText) {
      try { cssText = await (await fetch(chrome.runtime.getURL("ui.css"))).text(); } catch { cssText = ""; }
    }
    // A shadow root cannot load fonts, so declare the bundled Space Grotesk in the page itself (no network, own file).
    if (!document.getElementById("cue-att-font")) {
      const f = document.createElement("style");
      f.id = "cue-att-font";
      f.textContent = `@font-face{font-family:"LMA Space Grotesk";font-weight:300 700;font-style:normal;font-display:swap;src:url("${chrome.runtime.getURL("fonts/SpaceGrotesk.woff2")}") format("woff2")}`;
      document.head.append(f);
    }
    host = document.createElement("div");
    host.id = "cue-att-host";
    const shadow = host.attachShadow({ mode: "open" });
    dock = h("div", { class: "cue dock" });
    const style = document.createElement("style");
    style.textContent = cssText;
    shadow.append(style, dock);
    spotlight(dock);
    document.body.append(host);
    syncGutter();
  }
  // The portal scrolls inside its own container, so its scrollbar sits inside the viewport. Measure it and keep
  // the dock the same 16px from it as from the bottom edge.
  function syncGutter() {
    if (!host?.isConnected) return;
    let w = 0;
    for (let el = document.elementFromPoint(innerWidth - 3, Math.round(innerHeight / 2)); el && !w; el = el.parentElement) w = el.offsetWidth - el.clientWidth;
    host.style.setProperty("--sb", `${Math.max(0, Math.round(w || innerWidth - document.documentElement.clientWidth))}px`);
  }
  addEventListener("resize", syncGutter);
  function ensureHost() {
    if (host?.isConnected) return Promise.resolve();
    hostPromise ||= buildHost().finally(() => { hostPromise = null; });
    return hostPromise;
  }
  // ---------------------------------------------------------------- attendance page
  // A = everything the drawer needs: { snap, threshold, adj, exc, open, sortBy, tt, basis }
  let attOpen = false;
  let attSig = "";
  let A = null;
  let effPortal = null;          // the portal's own numbers, nothing of yours added: the "Actual" tab compares it with effMarks
  let effMarks = null;           // same numbers WITH the hours you reclassified: only used for the review notice, everything else shows the portal's data
  let tab = "overview";          // "overview" | "plan" | "actual"
  let planSel = new Map();       // dayKey -> Set(periods SKIPPED) | null (whole day skipped). The view shows ticked = attending.
  let planMonth = 0;             // months after the first plannable month
  let todayPick = new Set();     // periods ticked on the "skip today?" card
  let todayFor = "";             // which day that selection belongs to
  const courseOpen = new Set();  // Overview rows opened to show what each course needs
  const accOpen = new Set();     // which accordions are open ("per", "budget")
  let growBars = true;           // bars grow once when the drawer opens or the tab changes, not on every click
  let calShown = null;           // month the calendar last drew, to slide when it changes
  let lastPicked = null;         // day just picked, for the springy pop

  // one-shot ring on the pill's status dot when it is clicked (re-triggerable)
  const ping = (pill) => { pill.classList.remove("clicked"); void pill.offsetWidth; pill.classList.add("clicked"); };
  const rerender = () => { if (A) { attSig = ""; renderAtt(A); } };
  function setOpen(v) {
    if (!v && shell && host?.shadowRoot?.activeElement && shell.drawer.contains(host.shadowRoot.activeElement)) shell.pill.focus(); // don't strand focus in a hidden drawer
    attOpen = v;
    if (v) growBars = true;
    if (A) { A.open = v; rerender(); }
  }
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") { if (attOpen) setOpen(false); else if (absOpen) setAbsOpen(false); } });
  document.addEventListener("click", (e) => {
    if (host && !e.composedPath().includes(host)) { if (attOpen) setOpen(false); else if (absOpen) setAbsOpen(false); }
  });

  // Sort options for the course list (default: same order as the portal's table).
  const SORTS = [
    { v: "portal", label: "Portal order" },
    { v: "low", label: "Lowest % first" },
    { v: "high", label: "Highest % first" },
    { v: "az", label: "Course name (A-Z)" },
  ];
  function sortCourses(list, by) {
    const pct = (c) => Calc.percent(c.attended, c.scheduled);
    const out = [...list];
    if (by === "low") out.sort((a, b) => pct(a) - pct(b));
    else if (by === "high") out.sort((a, b) => pct(b) - pct(a));
    else if (by === "az") out.sort((a, b) => a.name.localeCompare(b.name));
    return out;
  }

  const today0 = () => { const n = new Date(); return new Date(n.getFullYear(), n.getMonth(), n.getDate()); };

  // A course as "NAME / code" (students know the subject, not the code). `extra` goes after the code.
  const nameCell = (c, ...extra) => h("span", {}, h("b", { class: "nm", title: c.name }, c.name || c.code),
    c.code || extra.length ? h("div", { class: "cl" }, c.code ? h("span", { class: "sub" }, c.code) : null, extra) : null);

  // "Skip today?": the next class day's classes, which of them you can skip, and what ticking some would cost.
  function todayCard(eff, threshold, t) {
    if (!A.tt) return h("div", { class: "blk today" }, h("div", { class: "thead" }, h("b", { class: "h3" }, "Skip today?")), h("p", { class: "sub" }, "Open your timetable once and this will tell you which classes you can skip."));
    const now = new Date(), nowMin = now.getHours() * 60 + now.getMinutes(), t0 = today0();
    let date = Plan.upcomingFrom(A.tt, now), cls = [];
    for (let i = 0; i < 30; i++, date = Cal.addDays(date, 1)) {
      cls = Plan.classesOn(date, A.tt).filter((x) => +date !== +t0 || !(Plan.endMinutes(x.time) <= nowMin));
      if (cls.length) break;
    }
    if (!cls.length) return null;
    const dkey = Cal.key(date);
    if (todayFor !== dkey) { todayFor = dkey; todayPick = new Set(); }
    const num = (x) => parseInt(/\d+/.exec(x || "")?.[0], 10) || 0;
    cls = [...cls].sort((a, b) => num(a.period) - num(b.period));
    const byName = new Map(eff.courses.map((c) => [c.name.trim().toUpperCase(), c]));
    const courseOf = (x) => byName.get(x.name.trim().toUpperCase());
    const impactOf = (list) => { const m = {}; for (const x of list) { const c = courseOf(x); if (c) m[c.key] = (m[c.key] || 0) + 1; } return Plan.impact(eff, m, "now", {}, t); };
    const okAlone = (x) => { const c = courseOf(x); if (!c) return null; const r = impactOf([x]).rows[0]; return !r || r.safe; };
    const picked = cls.filter((x) => todayPick.has(x.period));
    const nOk = cls.filter((x) => okAlone(x)).length;
    const when = +date === +t0 ? "Today" : +date === +Cal.addDays(t0, 1) ? "Tomorrow" : "Next class day";
    const flip = (period) => { todayPick.has(period) ? todayPick.delete(period) : todayPick.add(period); rerender(); };

    let result;
    if (!picked.length) result = h("p", { class: "sub" }, nOk ? `You can skip ${nOk} of ${plural(cls.length, "class")} and stay at ${threshold}% or more. Tap classes to see what skipping them costs.` : `Skipping any of these would put a course below ${threshold}%.`);
    else {
      const im = impactOf(picked), bad = im.rows.filter((r) => !r.safe);
      result = h("div", { class: "tres" },
        h("div", { class: "row" }, h("span", {}, `Skip ${plural(picked.length, "class")}`), h("span", {}, h("span", { class: "sub" }, `${im.overall.before.toFixed(1)}% to `), h("b", { class: bad.length ? "bad" : "good" }, `${im.overall.after.toFixed(1)}%`))),
        h("p", { class: "sub" }, bad.length ? `${bad.map((r) => `${r.code || r.name} drops to ${r.after.toFixed(0)}%`).join(", ")}: below ${threshold}%.` : `Every course stays at ${threshold}% or more.`));
    }
    const canPlan = +date > +t0;
    return h("div", { class: "blk today" },
      h("div", { class: "thead" }, h("b", { class: "h3" }, when), h("span", { class: "sub" }, `${plural(cls.length, "class")}, ${dayLabel(date)}`)),
      cls.map((x) => {
        const c = courseOf(x), ok = okAlone(x), on = todayPick.has(x.period);
        return h("button", { class: `trow${on ? " on" : ""}`, role: "checkbox", "aria-checked": String(on), "data-key": `today-${x.period}`, onclick: () => flip(x.period) },
          h("span", {}, nicePeriod(x.period)),
          h("span", { class: "ac", title: x.name }, h("b", {}, c ? (c.code || c.name) : x.name), c && c.code ? h("small", {}, c.name) : null),
          ok === null ? chip("mute", "not in table") : chip(ok ? "good" : "bad", ok ? "can skip" : "attend"),
          h("span", { class: "bx" }));
      }),
      result,
      h("div", { class: "tact" },
        nOk && picked.length < nOk ? h("button", { class: "btn sm", "data-key": "today-safe", onclick: () => { todayPick = new Set(cls.filter((x) => okAlone(x)).map((x) => x.period)); rerender(); } }, "Pick the ones I can skip") : null,
        picked.length ? h("button", { class: "btn sm", "data-key": "today-clear", onclick: () => { todayPick = new Set(); rerender(); } }, "Clear") : null,
        canPlan ? h("button", { class: "btn sm", "data-key": "today-plan", onclick: () => { planSel = new Map([[dkey, picked.length ? new Set(picked.map((x) => x.period)) : null]]); planMonth = monthOffset(Cal.addDays(today0(), 1), date); tab = "plan"; growBars = true; calShown = null; rerender(); } }, "Open in planner") : null));
  }

  // What a course needs, in plain words, with the real dates of its next classes when the timetable is saved.
  function needView(c, pct, skip, t, threshold) {
    const day = (x) => `${dayLabel(x.date)} ${nicePeriod(x.period)}`;
    const need = Calc.mustAttend(c.attended, c.scheduled, t);
    const low = pct < threshold;
    const head = low ? (Number.isFinite(need) ? `Attend the next ${plural(need, "class")} to get back to ${threshold}%.` : `${threshold}% is out of reach for this course now.`)
      : skip ? `You can skip ${plural(skip, "class")} and stay at ${threshold}% or more.` : "No spare classes: attend every one to stay at the minimum.";
    const lines = [h("p", {}, head)];
    if (!A.tt) lines.push(h("p", { class: "sub" }, "Open your timetable once to see the dates."));
    else {
      const n = low ? (Number.isFinite(need) ? need : 0) : 1;
      const dates = n ? Plan.courseClasses(A.tt, c, Plan.upcomingFrom(A.tt, new Date()), Math.min(n, 12)) : [];
      if (!dates.length && n) lines.push(h("p", { class: "sub" }, "This course isn't on your timetable, so there are no dates to show."));
      else if (dates.length) lines.push(h("div", { class: "cdates" }, low ? "" : h("span", { class: "sub" }, "Next class"), dates.map((x) => h("span", { class: "dt" }, day(x))), low && need > dates.length ? h("span", { class: "dt more" }, `+${need - dates.length} more`) : null));
    }
    return lines;
  }

  // ---- Overview tab
  function overviewView(eff, threshold, t) {
    const o = eff.overall;
    const op = Calc.percent(o.attended, o.scheduled);
    const tn = tone(op, threshold);
    const courses = eff.courses.filter((c) => c.scheduled > 0);

    const heroNum = h("span", { class: "v", style: `color:var(--${tn})` });
    tween(heroNum, "hero", op, (x) => `${x.toFixed(1)}%`, { animate: A.open, countUp: true });
    const hero = h("div", { class: `hero w-${tn}` },
      h("div", { class: "row" }, heroNum, h("span", { class: "sub" }, `${fmt(o.attended)} / ${o.scheduled}h`)),
      bar(op, threshold),
      h("p", { class: "sub" }, op >= threshold ? h("b", {}, `${(op - threshold).toFixed(1)} points above`) : h("b", {}, `${(threshold - op).toFixed(1)} points below`), ` your ${threshold}% minimum`),
      h("p", { class: "sub" }, op < threshold ? (Number.isFinite(Calc.mustAttend(o.attended, o.scheduled, t)) ? `Attend the next ${plural(Calc.mustAttend(o.attended, o.scheduled, t), "class")} to get back to ${threshold}%` : `${threshold}% is out of reach now: a missed class stays missed`)
        : Calc.canSkip(o.attended, o.scheduled, t) ? `You can skip ${plural(Calc.canSkip(o.attended, o.scheduled, t), "class")} and stay above it` : "No spare classes: skipping any would put you below it"),
      o.medical ? h("p", { class: "sub" }, `Medical ${fmt(o.medical)}h: ${Calc.medicalText(o)}`) : null,
      o.ccIncluded ? h("p", { class: "sub" }, "Co-curricular is already included by the portal.")
        : o.cocurricular ? h("p", { class: "sub" }, `Includes ${fmt(o.cocurricular)}h co-curricular claimed.`) : null);

    const review = effMarks.courses.filter((c) => c.stale || c.goneHrs);
    const reviewBox = review.length
      ? h("div", { class: "warnbox" }, h("b", {}, "Needs review"),
          review.map((c) => h("div", { class: "sub" }, `${c.code || c.name}: `,
            c.goneHrs ? `${fmt(c.goneHrs)}h updated on the portal. Open View Details and press Confirm present.` : "the portal's numbers changed since you adjusted this. Check it.")))
      : null;

    const sortBar = h("div", { class: "sec" },
      h("span", {}, "Courses"),
      h("label", { class: "sub sortl" }, "Sort by",
        h("select", { "aria-label": "Sort courses", "data-key": "sort", onchange: (e) => { A.sortBy = e.target.value; store.set({ sortBy: A.sortBy }); rerender(); } },
          SORTS.map((s) => h("option", { value: s.v, selected: s.v === A.sortBy }, s.label)))));

    const list = sortCourses(courses, A.sortBy).map((c) => {
      const pct = Calc.percent(c.attended, c.scheduled);
      const adjusted = !!(c.adj.att || c.adj.sch || c.excusedHrs);
      const skip = Calc.canSkip(c.attended, c.scheduled, t);
      const tip = adjusted ? `Includes your own changes. Portal ${c.portalAttended}/${c.portalScheduled}, with your marks ${fmt(c.attended)}/${c.scheduled}` : "";
      const open = courseOpen.has(c.key);
      const toggle = () => { open ? courseOpen.delete(c.key) : courseOpen.add(c.key); rerender(); };
      return h("div", { class: `it2 cx${open ? " open" : ""}`, role: "button", tabindex: "0", "aria-expanded": String(open), "data-key": `cx-${c.key}`, onclick: toggle,
          onkeydown: (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); toggle(); } } },
        h("div", { class: "row" },
          h("span", {}, h("b", { class: "nm", title: c.name }, c.name || c.code),
            c.code || adjusted ? h("div", { class: "cl" }, c.code ? h("span", { class: "sub" }, c.code) : null, adjusted ? chip("mute", "adj", tip) : null) : null),
          h("span", {}, h("span", { class: "p", style: `color:var(--${tone(pct, threshold)})` }, `${pct.toFixed(0)}%`), " ",
            pct < threshold ? chip("bad", mustText(Calc.mustAttend(c.attended, c.scheduled, t))) : chip(skip ? "good" : "warn", skip ? `can skip ${skip}` : "no spare"))),
        h("div", { class: "cbar" }, bar(pct, threshold), ico("chev", "ic chev")),
        h("div", { class: "cdet", inert: open ? null : "" }, h("div", {}, needView(c, pct, skip, t, threshold))));
    });

    return [hero, todayCard(eff, threshold, t), reviewBox, sortBar, h("div", { class: "blk" }, list)];
  }

  // ---- Actual tab: the portal as-is next to the numbers with your typed hours and marks. Only offered when they differ.
  const SAME = (a, b) => Math.abs(a - b) < 1e-9;
  const differs = (p, m) => !SAME(p.attended, m.attended) || !SAME(p.scheduled, m.scheduled);
  const deltaTxt = (d) => h("span", { class: `dl ${d > 0.049 ? "good" : d < -0.049 ? "bad" : ""}` }, `${d > 0 ? "+" : ""}${d.toFixed(1)}%`);
  const deltaChip = (d) => chip(d > 0.049 ? "good" : d < -0.049 ? "bad" : "mute", `${d > 0 ? "+" : ""}${d.toFixed(1)}%`);
  function actualView(threshold) {
    const po = effPortal.overall, mo = effMarks.overall;
    const pp = Calc.percent(po.attended, po.scheduled), mp = Calc.percent(mo.attended, mo.scheduled);
    const tn = tone(mp, threshold);
    const sc = (txt) => h("div", { class: "sec" }, h("span", {}, txt));

    // 1. The answer: your actual attendance. The bar shows the portal's part and, in gold, what you added on top.
    const added = mo.attended - po.attended;
    const clamp = (x) => Math.min(100, Math.max(0, x));
    const abar = h("div", { class: "abar" },
      h("i", { style: `width:${clamp(Math.min(pp, mp))}%;background:var(--${tn})` }),
      mp > pp ? h("s", { style: `left:${clamp(pp)}%;width:${clamp(mp) - clamp(pp)}%` }) : null,
      h("u", { style: `left:${threshold}%` }));
    const heroNum = h("span", { class: "v", style: `color:var(--${tn})` });
    tween(heroNum, "actual-hero", mp, (x) => `${x.toFixed(1)}%`, { animate: A.open, countUp: true });
    const hero = h("div", { class: `hero w-${tn}` },
      h("div", { class: "row" }, heroNum, h("span", { class: "sub" }, `${fmt(mo.attended)} / ${mo.scheduled}h`)),
      abar,
      h("div", { class: "alegend" },
        h("span", {}, h("i", { style: `--c:var(--${tn})` }), `Portal ${pp.toFixed(1)}%`),
        h("span", {}, h("i", { style: "--c:var(--gold)" }), `You added ${added > 0 ? "+" : ""}${fmt(added)}h`, " ", deltaTxt(mp - pp))));

    // 3. Where the extra hours come from: day by day like the absent list, one row per hour with what you did to it.
    const items = [];
    const typedCc = mo.ccIncluded ? 0 : (A.adj && A.adj.cocurricular) || 0;
    if (typedCc) items.push({ typed: true, code: "Overall", name: "Co-curricular hours you typed in", hrs: typedCc, kind: "tcc" });
    for (const c of effMarks.courses) {
      const rows = (A.exc && A.exc[c.key] && A.exc[c.key].rows || []).filter((r) => !r.gone);
      for (const kind of ["later", "cc", "med"]) {
        const eff = kind === "later" ? c.laterHrs : kind === "cc" ? c.ccHrs : c.medHrs;
        const mine = rows.filter((r) => (r.s === "cc" || r.s === "med" ? r.s : "later") === kind);
        const raw = mine.reduce((n, r) => n + r.h, 0), f = raw ? eff / raw : 1; // scaled like Calc.effective: never above the portal's absent count
        if (eff) for (const r of mine) { const [date, period] = String(r.k).split("|"); items.push({ date, period, code: c.code || c.name, name: c.code ? c.name : "", hrs: r.h * f, kind, off: kind === "med" && !mo.medicalApplies }); }
      }
      if (c.adj.att) items.push({ typed: true, code: c.code || c.name, name: c.code ? c.name : "", hrs: c.adj.att, kind: "tatt" });
      if (c.adj.sch) items.push({ typed: true, code: c.code || c.name, name: c.code ? c.name : "", hrs: c.adj.sch, kind: "tsch" });
    }
    const MON = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 };
    const dayKey = (d) => { const m = /^([A-Za-z]{3})[A-Za-z]*\s+(\d{1,2})/.exec(d || ""); return m ? ((MON[m[1].toLowerCase()] + 7) % 12) * 100 + +m[2] : -1; }; // the academic year starts in June, newest first
    const days = new Map();
    for (const it of items.filter((x) => !x.typed)) { if (!days.has(it.date)) days.set(it.date, []); days.get(it.date).push(it); }
    const dayList = [...days.entries()].sort((a, b) => dayKey(b[0]) - dayKey(a[0]));
    const CHIP = { later: ["mute", "later", "You marked it as present on the portal's way: it counts as present here"], cc: ["gold", "co-curricular"], med: ["blue", "medical"], tcc: ["gold", "co-curricular"], tatt: ["mute", "typed in"] };
    const chipFor = (it) => it.kind === "tsch" ? chip("mute", `+${fmt(it.hrs)}h scheduled`) : it.off ? chip("mute", "not counted", "Medical hours only count between 74.5% and 85% overall") : chip(...CHIP[it.kind]);
    const codeCell = (it) => h("span", { class: "ac", title: it.name }, h("b", {}, it.code), it.name ? h("small", {}, it.name) : null);
    const total = (list) => fmt(list.filter((x) => x.kind !== "tsch" && !x.off).reduce((n, x) => n + x.hrs, 0));
    const typedItems = items.filter((x) => x.typed);
    const extra = items.filter((x) => x.kind !== "tsch" && !x.off).reduce((n, x) => n + x.hrs, 0);
    const srcList = [
      ...dayList.map(([d, list]) => [
        h("div", { class: "pday" }, h("b", {}, niceDate(d)), h("span", { class: "sub" }, `${total(list)}h`)),
        list.map((it) => h("div", { class: "arow nt" }, h("span", {}, nicePeriod(it.period)), codeCell(it), chipFor(it)))]),
      typedItems.length ? [
        h("div", { class: "pday" }, h("b", {}, "Typed in by you"), h("span", { class: "sub" }, `${total(typedItems)}h`)),
        typedItems.map((it) => h("div", { class: "arow nt" }, h("span", {}), codeCell(it), chipFor(it)))] : null];
    const hasSrc = items.length > 0;

    // 4. Course by course, only the ones that differ. For reference, co-curricular hours you marked also count in their own course here.
    const act = (m) => ({ ...m, attended: m.attended + m.ccHrs });
    const shift = (p, m) => Math.abs(Calc.percent(m.attended, m.scheduled) - Calc.percent(p.attended, p.scheduled)) >= 0.05; // same % before and after is not a change worth a row
    const rows = effMarks.courses.map((m, i) => [effPortal.courses[i], act(m)]).filter(([p, m]) => differs(p, m) && shift(p, m) && m.scheduled > 0);
    const same = effMarks.courses.filter((c) => c.scheduled > 0).length - rows.length;
    const list = rows.map(([p, m]) => {
      const a = Calc.percent(p.attended, p.scheduled), b = Calc.percent(m.attended, m.scheduled);
      return h("div", { class: "it2" },
        h("div", { class: "row" },
          h("span", {}, h("b", { class: "nm", title: m.name }, m.name || m.code), m.code ? h("div", { class: "cl" }, h("span", { class: "sub" }, m.code), m.stale ? chip("warn", "review") : null) : null),
          h("span", { class: "ftc" },
            h("span", { class: "ft" }, h("span", { class: "sub" }, `${a.toFixed(1)}%`), ico("right"), h("span", { class: "p", style: `color:var(--${tone(b, threshold)})` }, `${b.toFixed(1)}%`)),
            deltaTxt(b - a))));
    });
    const note = same > 0 ? h("p", { class: "sub" }, `${plural(same, rows.length ? "other course" : "course")} ${same === 1 ? "matches" : "match"} the portal.`) : null;

    const has = (...k) => items.some((x) => k.includes(x.kind));
    const notes = hasSrc ? h("div", { class: "notes" },
      has("later") ? h("p", { class: "sub" }, h("b", {}, "Later: "), "attendance will be updated later.") : null,
      has("cc", "tcc") ? h("p", { class: "sub" }, h("b", {}, "Co-curricular: "), "counted in the overall and in each course here, for reference.") : null,
      has("med") ? h("p", { class: "sub" }, h("b", {}, "Medical: "), "counts only if the overall is 74.5% to 84.49% at semester end.") : null) : null;
    // Order: the number, where it comes from, then the from-to per course.
    return [hero,
      hasSrc ? acc({ title: "Where the extra hours come from", sub: [`+${fmt(extra)}h added`, sep(), (dayList.length ? plural(dayList.length, "day") : "typed in")], open: accOpen.has("extra"), key: "acc-extra",
        ontoggle: (v) => { v ? accOpen.add("extra") : accOpen.delete("extra"); rerender(); } },
        srcList, h("div", { class: "pday tot" }, h("b", {}, "Added to attended"), h("b", {}, `+${fmt(extra)}h`))) : null,
      rows.length ? acc({ title: "Course by course", sub: [`${plural(rows.length, "course")} changed`, sep(), `${same} match the portal`], open: accOpen.has("courses"), key: "acc-courses",
        ontoggle: (v) => { v ? accOpen.add("courses") : accOpen.delete("courses"); rerender(); } }, list) : null,
      notes,
      rows.length ? null : note];
  }

  // ---- Plan a bunk tab
  function planView(eff, threshold, t) {
    if (!A.tt) {
      return h("div", { class: "blk free" },
        h("div", { class: "h3" }, "Open your timetable once"),
        h("p", { class: "sub" }, "I need your weekly timetable to know which classes you'd skip. Open it once and come back."),
        h("button", { class: "btn solid cta", "data-key": "open-tt", onclick: () => location.assign("/main/timeTable") }, "Open timetable", ico("right")));
    }
    const from = Cal.addDays(today0(), 1);
    // A saved "mse" basis only holds while MSE is still ahead; `line` is the fraction that counts as safe.
    const basis = Plan.resolveBasis(A.basis, from);
    const esePct = Math.min(100, Math.max(1, A.eseTarget ?? threshold));
    const line = Plan.thresholdFor(basis, t, esePct);
    const linePct = Math.round(line * 100);
    const end = Plan.horizon(basis, from);
    const examName = basis === "mse" ? "MSE" : "ESE";
    const past = basis !== "now" && !!end && end < from; // the cutoff has gone by (exam window still on): a reference, nothing left to plan
    const picked = planSel.size;
    planSel = Plan.clipSelection(planSel, end);
    const dropped = picked - planSel.size;
    const courses = eff.courses;

    const bud = Plan.budgets({ eff, tt: A.tt, basis, t: line, from });
    const best = basis === "now" ? Plan.bestDays({ eff, tt: A.tt, courses, basis, t: line, from }) : null; // before an exam any safe day is as good as another
    const remaining = basis !== "now" ? Plan.remainingHours(A.tt, courses, from, end) : {};
    const impactFor = (sel) => { const { missed, unknown } = Plan.missedFor(sel, A.tt, courses); return { ...Plan.impact(eff, missed, basis, remaining, line), unknown }; };
    const res = impactFor(planSel);
    // A day gets the coral outline when a currently-safe plan would tip below the line if you added it.
    const riskOf = (k) => res.safe && !impactFor(new Map([...planSel, [k, null]])).safe;
    const clear = () => { planSel = new Map(); rerender(); };

    const out = [];
    const opts = [["now", "After the bunk"]];
    if (Plan.resolveBasis("mse", from) === "mse") opts.push(["mse", "Before MSE"]);
    if (Plan.resolveBasis("end", from) === "end") opts.push(["end", "Before ESE"]);
    if (opts.length > 1) out.push(h("div", { class: "ctl" },
      h("div", { class: "sub" }, "Safe means"),
      pills(opts, basis, (v) => { A.basis = v; store.set({ bunkBasis: v }); rerender(); }, { label: "Safe means", keyPrefix: "basis" }),
      basis === "end" ? h("div", { class: "row" }, h("span", { class: "sub" }, "My ESE target (%)"),
        stepper(esePct, { min: 1, max: 100, label: "ESE target", key: "ese", onchange: (v) => { A.eseTarget = v; store.set({ eseTarget: v }); rerender(); } })) : null));
    if (A.basis === "mse" && basis === "now") out.push(h("div", { class: "warnbox top" }, h("div", { class: "sub" }, "MSE isn't open for planning (no class days left before it, or it isn't in the calendar), so these are right-now numbers.")));
    if (dropped) out.push(h("div", { class: "sub note" }, `${plural(dropped, "selected day")} after the ${examName} cutoff ${dropped > 1 ? "were" : "was"} removed.`));
    if (!Cal.known(from)) out.push(h("div", { class: "warnbox top" }, h("div", { class: "sub" }, "This year's academic calendar isn't in the extension yet, so holidays aren't known.")));

    // ---- hero: the answer first, same height in every state so the calendar below never jumps
    const K = res.overall.k;
    const meta = h("div", { class: "meta" },
      h("span", { class: "sub" }, plural(planSel.size, "day"), sep(), `${plural(K, "class")} skipped`),
      h("button", { class: "btn sm", "data-key": "clear", disabled: !planSel.size, onclick: clear }, "Clear selection"));
    let hero;
    if (past && bud) {
      const tn = tone(bud.overall.pct, linePct);
      hero = h("div", { class: `hero plan w-${tn}` },
        h("div", { class: "v", style: `color:var(--${tn})` }, `${bud.overall.pct.toFixed(1)}%`),
        h("p", {}, `Your attendance counted for ${examName} up to `, h("b", {}, dayLabel(end)), ", against the ", h("b", {}, `${linePct}%`), " needed."));
    } else if (planSel.size) {
      const after = res.overall.after, gap = Math.abs(after - linePct).toFixed(1);
      const failing = res.rows.filter((r) => !r.safe).length;
      const names = [...planSel.keys()].sort().map((k) => dayLabel(Cal.parse(k)));
      const list = names.length > 2 ? `${names.length} days` : names.join(" and ");
      const lead = basis !== "now" ? `, you reach ${examName} at ` : ", overall drops to ";
      const tail = !res.overall.safe ? [lead, h("b", {}, `${after.toFixed(1)}%`), `, ${gap} points below the ${linePct}% minimum.`]
        : failing ? [", overall holds at ", h("b", {}, `${after.toFixed(1)}%`), `, but ${plural(failing, "course")} ${failing === 1 ? "falls" : "fall"} below ${linePct}%.`]
        : [lead, h("b", {}, `${after.toFixed(1)}%`), `, ${gap} points above the ${linePct}% minimum.`];
      hero = h("div", { class: `hero plan ${res.safe ? "ok" : "no"}` },
        h("div", { class: "v", style: `color:var(--${res.safe ? "good" : "bad"})` }, res.safe ? "Safe to bunk" : "Not safe", h("s", {}, ".")),
        h("p", {}, "Skipping ", h("b", {}, list), tail), meta);
    } else if (bud && !bud.overall.reachable) {
      hero = h("div", { class: "hero plan w-bad" },
        h("div", { class: "v" }, "Out of reach", h("s", {}, ".")),
        h("p", {}, `Even if you attend every class you'd reach `, h("b", {}, `${Math.floor(bud.overall.bestCase)}%`), ` at ${examName}, short of the ${linePct}% needed.`));
    } else if (bud) {
      const n = bud.overall.budget;
      hero = h("div", { class: "hero plan w-good" },
        h("div", { class: "v" }, n ? `${n} spare` : "No spare", h("s", {}, ".")),
        n ? h("p", {}, "You can still skip ", h("b", {}, plural(n, "class")), ` overall before ${examName} on `, h("b", {}, dayLabel(bud.end)), ".")
          : h("p", {}, `Every class counts until ${examName} on `, h("b", {}, dayLabel(bud.end)), "."),
        null);
    } else {
      hero = h("div", { class: "hero plan" },
        h("div", { class: "v" }, "Pick a day", h("s", {}, ".")),
        h("p", {}, "Pick days below to see what skipping them costs."));
    }
    out.push(hero);

    // ---- calendar
    if (!past) {
      out.push(h("div", { class: "sec" }, h("span", {}, "Pick days"), h("span", { class: "sub" }, "tap as many as you like")));
      out.push(calendarView(from, Cal.semesterEnd(from), end, linePct, riskOf));
    }

    if (planSel.size) {
      // ---- ticks: ticked = you will attend. The state stays "periods skipped" (see Plan.setAttend).
      const days = [...planSel.keys()].sort().map((k) => {
        const d = Cal.parse(k), cls = Plan.classesOn(d, A.tt), sk = planSel.get(k);
        return [
          h("div", { class: "pday" }, h("b", {}, dayLabel(d)), h("span", { class: "sub" }, `${sk ? sk.size : cls.length} of ${cls.length} skipped`)),
          cls.map((c) => {
            const ticked = sk ? !sk.has(c.period) : false;
            return h("button", { class: "per", role: "checkbox", "aria-checked": String(ticked), "data-key": `per-${k}-${c.period}`, onclick: () => {
              const next = Plan.setAttend(cls.map((x) => x.period), sk, c.period, !ticked);
              if (next === undefined) planSel.delete(k); else planSel.set(k, next);
              rerender();
            } },
              h("span", { class: `bx${ticked ? " on" : ""}` }), h("span", {}, nicePeriod(c.period)), h("span", { class: "pt" }, startTime(c.time)), h("span", { class: "sub" }, c.name));
          }),
        ];
      });
      out.push(acc({ title: "Classes you will still attend", icon: "checks", tone: "pick", sub: [`${plural(K, "class")} skipped`, sep(), "tick to attend some"], open: accOpen.has("per"), key: "acc-per",
        ontoggle: (v) => { v ? accOpen.add("per") : accOpen.delete("per"); rerender(); } }, days));

      // ---- result
      const arrow = (r, dp, key) => {
        const after = h("b", { style: `color:var(--${r.safe ? "good" : "bad"})` });
        tween(after, key || `bunk-${r.key}`, r.after, (x) => `${x.toFixed(dp)}%`, { animate: A.open });
        return [`${r.before.toFixed(dp)}% → `, after];
      };
      out.push(h("div", { class: "sec" }, "If you bunk"));
      out.push(h("div", { class: "blk" },
        h("div", { class: "it2 main" }, h("div", { class: "row" }, h("span", {}, h("b", {}, "Overall")), h("span", { class: "big" }, arrow(res.overall, 1)))),
        res.rows.map((r) => h("div", { class: `it2 minor${r.safe ? "" : " fail"}` }, h("div", { class: "row" },
          nameCell(r, h("span", { class: "sub" }, r.code ? [sep(), `−${r.k}h`] : `−${r.k}h`)),
          h("span", { class: "rr" }, h("span", {}, arrow(r, 1)), r.safe ? chip("good", "safe") : chip("bad", basis !== "now" ? `below ${linePct}%` : mustText(r.recover)))))),
        res.unknown.length ? h("div", { class: "it2 sub" }, `Not in your attendance table: ${res.unknown.join(", ")}.`) : null,
        basis !== "now" ? h("div", { class: "it2 sub" }, `Assumes you attend every other class until ${end ? dayLabel(end) : "the semester ends"} (${examName}).`) : null));
    }

    // ---- best days to bunk (only for "After the bunk")
    if (best) out.push(h("div", { class: "sec" }, best.days.some((b) => b.safe) || !best.days.length ? "Best days to bunk" : "Least risky days"));
    if (best) out.push(best.days.length
      ? h("div", { class: "blk" }, best.days.map((b) => {
          return h("button", { class: `it2 click${planSel.has(b.key) ? " on" : ""}`, "data-key": `best-${b.key}`,
            onclick: () => { planSel = new Map([[b.key, null]]); planMonth = monthOffset(from, b.date); rerender(); } },
            h("div", { class: "row" }, h("b", { class: "d" }, dayLabel(b.date)), chip(b.safe ? "good" : "bad", b.safe ? "safe" : "risky")),
            b.lowest != null ? h("div", { class: "low" }, "Lowest after ", h("b", { style: `color:var(--${b.safe ? "good" : "bad"})` }, `${b.lowest.toFixed(0)}%`)) : null,
            h("div", { class: "sub" }, plural(b.classes, "class")),
            UI.breakTag(b.breakDays) ? h("div", { class: "brk" }, chip("mute", ...UI.breakTag(b.breakDays)), b.breakNames.length ? h("span", { class: "sub" }, b.breakNames.join(", ")) : null) : null);
        }))
      : h("div", { class: "sub" }, "No class days left this semester."));

    // ---- bunk budget: what each course can still skip before the cutoff
    if (bud) {
      const budChip = (r) => past ? (r.pct >= linePct ? chip("good", `meets ${linePct}%`) : chip("bad", `below ${linePct}%`)) : !r.matched ? chip("mute", "not in timetable") : !r.reachable ? chip("bad", "out of reach") : r.budget === 0 ? chip("warn", "no spare") : chip("good", `can skip ${r.budget}`);
      const left = (r) => `${plural(r.R, "class")} left until then`;
      const o = bud.overall;
      const rows = [
        h("div", { class: "it2 main" }, h("div", { class: "row" },
          h("span", {}, h("b", {}, "Overall"), past ? null : h("div", { class: "sub" }, left(o))),
          h("span", { class: "stk" }, h("span", { class: "big", style: `color:var(--${tone(o.pct, linePct)})` }, `${o.pct.toFixed(1)}%`), budChip(o)))),
        ...bud.rows.map((r) => !past && !r.matched
          ? h("div", { class: "it2 minor" }, h("div", { class: "row" }, nameCell(r), budChip(r)))
          : h("div", { class: "it2 minor" }, h("div", { class: "row" },
              h("span", {}, h("b", { class: "nm", title: r.name }, r.name || r.code),
                h("div", { class: "sub" }, r.code && !past ? [r.code, sep(), left(r)] : r.code || (past ? null : left(r))),
                past || r.reachable ? null : h("div", { class: "sub" }, `Best case ${Math.floor(r.bestCase)}%`)),
              h("span", { class: "rr" }, h("span", { class: "p", style: `color:var(--${tone(r.pct, linePct)})` }, `${r.pct.toFixed(0)}%`), budChip(r))))),
      ];
      if (planSel.size) {
        out.push(acc({ title: `Before ${examName} budget`, icon: "gauge", tone: "warn", sub: o.reachable ? [`Can still skip ${o.budget} overall`, sep(), left(o).replace(" until then", "")] : "Out of reach", open: accOpen.has("budget"), key: "acc-budget",
          ontoggle: (v) => { v ? accOpen.add("budget") : accOpen.delete("budget"); rerender(); } }, rows));
      } else {
        out.push(h("div", { class: "sec" }, h("span", {}, past ? `At the ${examName} cutoff` : `Before ${examName}`), h("span", { class: "sub" }, dayLabel(bud.end))));
        out.push(h("div", { class: "blk" }, rows));
      }
    }
    return out;
  }

  const monthOffset = (a, b) => (b.getFullYear() - a.getFullYear()) * 12 + b.getMonth() - a.getMonth();

  // navEnd = last month you can browse to (semester end); last = last day that can be picked (the basis' cutoff).
  function calendarView(from, navEnd, last, linePct, riskOf) {
    const maxOff = navEnd ? Math.max(0, monthOffset(from, navEnd)) : 3;
    planMonth = Math.min(Math.max(0, planMonth), maxOff);
    const first = new Date(from.getFullYear(), from.getMonth() + planMonth, 1);
    const daysIn = new Date(first.getFullYear(), first.getMonth() + 1, 0).getDate();
    const lead = (first.getDay() + 6) % 7; // Monday-first grid
    const dir = calShown == null || calShown === planMonth ? "" : planMonth > calShown ? "fwd" : "back";
    calShown = planMonth;
    const cells = []; // { el, past }: a week of only past days is dropped from the first month (nothing there can be picked)
    for (let i = 0; i < lead; i++) cells.push({ el: h("span", { class: "cday empty" }), past: true });
    for (let n = 1; n <= daysIn; n++) {
      const d = new Date(first.getFullYear(), first.getMonth(), n);
      const k = Cal.key(d);
      const info = Cal.dayInfo(d);
      const cls = Plan.classesOn(d, A.tt).length;
      const usable = d >= from && (!last || d <= last) && info.classDay && cls > 0;
      const sel = planSel.has(k);
      const risk = usable && !sel && riskOf(k);
      const kind = !usable ? (info.holiday ? "hol" : "off") : sel ? "sel" : "open";
      const title = usable ? `${plural(cls, "class")}${risk ? `. Picking this would drop you below ${linePct}%` : ""}` : info.reason || (d < from ? "Past" : last && d > last ? "After the cutoff" : "No classes");
      cells.push({ past: d < from, el: h(usable ? "button" : "span", {
        class: `cday ${kind}${risk ? " risk" : ""}${sel && k === lastPicked ? " pop" : ""}`, style: `--i:${lead + n}`, title, "aria-label": `${dayLabel(d)}: ${title}`, "aria-pressed": usable ? String(sel) : null, "data-key": usable ? `day-${k}` : null,
        onclick: usable ? () => { if (sel) planSel.delete(k); else { planSel.set(k, null); lastPicked = k; } rerender(); } : null,
      }, String(n), usable ? h("i", {}, "•".repeat(Math.min(cls, 6))) : null) });
    }
    const weeks = [];
    for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));
    const shown = (planMonth === 0 ? weeks.filter((w) => w.some((c) => !c.past)) : weeks).flat().map((c) => c.el);
    return h("div", { class: "cardcal" },
      h("div", { class: "calh" },
        h("button", { class: "prev", "aria-label": "Previous month", "data-key": "cal-prev", disabled: planMonth <= 0, onclick: () => { planMonth--; rerender(); } }, ico("chev")),
        h("b", {}, first.toLocaleDateString("en-IN", { month: "long", year: "numeric" })),
        h("button", { class: "next", "aria-label": "Next month", "data-key": "cal-next", disabled: planMonth >= maxOff, onclick: () => { planMonth++; rerender(); } }, ico("chev"))),
      h("div", { class: "dow" }, ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"].map((x) => h("div", {}, x))),
      h("div", { class: `cal${dir ? ` enter ${dir}` : ""}` }, shown),
      h("div", { class: "leg" },
        h("span", {}, h("u", { class: "pk" }), "Your pick"),
        h("span", {}, h("u", { class: "hl" }), "Holiday or no classes"),
        h("span", {}, h("u", { class: "rk" }), `Drops you below ${linePct}%`),
        h("span", {}, "• classes that day")));
  }

  async function renderAtt(state) {
    A = state;
    attOpen = A.open;
    const { snap, threshold } = A;
    const eff = Calc.effective(snap, A.adj, {});
    effMarks = Calc.effective(snap, A.adj, A.exc);
    effPortal = Calc.effective(snap, {}, {});
    const hasChanges = differs(effPortal.overall, effMarks.overall) || effMarks.courses.some((c, i) => differs(effPortal.courses[i], c));
    if (tab === "actual" && !hasChanges) tab = "overview"; // nothing left to compare (e.g. you erased your data)
    const sig = JSON.stringify([eff, A.exc, threshold, A.open, snap.semester, A.sortBy, A.basis, A.eseTarget, A.tt, tab, hasChanges, [...courseOpen], [...todayPick], [...planSel].map(([k, v]) => [k, v && [...v]]), planMonth, [...accOpen]]);
    if (sig === attSig && host?.isConnected) return;
    await ensureHost();
    attSig = sig;
    const t = threshold / 100;
    const o = eff.overall;
    const op = Calc.percent(o.attended, o.scheduled);
    const lowN = eff.courses.filter((c) => c.scheduled > 0 && Calc.percent(c.attended, c.scheduled) < threshold).length;

    // Persistent shell: the dock, drawer, tabs and pill are built once and only their contents change,
    // so the open/close transition can play and keyboard focus survives a click.
    if (!shell || !dock.contains(shell.drawer)) shell = buildShell();
    const { drawer, pill, sub, body, tabs } = shell;
    const focused = host.shadowRoot.activeElement;
    const focusKey = focused && drawer.contains(focused) ? focusKeyOf(focused) : null;

    pill.className = `pill ${tone(op, threshold)}${pill.classList.contains("clicked") ? " clicked" : ""}`;
    pill.setAttribute("aria-expanded", String(A.open));
    pill.replaceChildren(h("i"), `${op.toFixed(1)}%`, lowN ? h("span", { class: "sub" }, `${lowN} low`) : null);
    sub.replaceChildren(snap.semester, sep(), `minimum ${threshold}%`);
    for (const [id, btn] of tabs) {
      btn.style.display = id === "actual" && !hasChanges ? "none" : "";
      btn.classList.toggle("on", tab === id);
      btn.setAttribute("aria-selected", String(tab === id));
    }
    drawer.classList.toggle("open", A.open);
    body.classList.toggle("grow", growBars && A.open);
    if (A.open) growBars = false;
    body.replaceChildren(...[tab === "plan" ? planView(eff, threshold, t) : tab === "actual" ? actualView(threshold) : overviewView(eff, threshold, t)].flat(Infinity).filter((x) => x != null && x !== false)); // views return arrays
    lastPicked = null;
    placeThumb(shell.tabsBox, "tabs");
    if (focusKey) restoreFocus(focusKey);
  }

  // Drawer shell, built once per mount of the attendance page.
  let shell = null;
  function buildShell() {
    const pill = h("button", { class: "pill", "aria-label": "Attendance summary", "data-key": "pill", onclick: () => { setOpen(!attOpen); ping(pill); } });
    pill.addEventListener("animationend", (e) => { if (e.animationName === "dotOrbit") pill.classList.remove("clicked"); });
    const sub = h("div", { class: "sub" });
    const tabs = new Map();
    for (const [id, label] of [["overview", "Overview"], ["plan", "Plan a bunk"], ["actual", "Actual"]]) {
      tabs.set(id, h("button", { role: "tab", "data-key": `tab-${id}`, onclick: () => { tab = id; growBars = true; calShown = null; rerender(); } }, label));
    }
    const tabsBox = h("div", { class: "pills", role: "tablist" }, ...tabs.values());
    const body = h("div", { class: "dbody" });
    const drawer = h("div", { class: "drawer", role: "dialog", "aria-label": "Attendance details" },
      h("div", { class: "top" },
        h("div", {}, h("b", {}, "Attendance"), sub),
        h("button", { class: "xb", "aria-label": "Close", "data-key": "close", onclick: () => setOpen(false) }, ico("close"))),
      tabsBox,
      body,
      h("div", { class: "tagline" }, "Vibecoded UI just like this website, but better"));
    dock.replaceChildren(drawer, pill);
    return { drawer, pill, sub, body, tabs, tabsBox };
  }
  // Views are rebuilt on every change, so remember the focused control by data-key, else by its position among the controls.
  const FOCUSABLE = "button,select,input,summary,[tabindex]";
  function focusKeyOf(el) {
    if (el.dataset.key) return { key: el.dataset.key };
    return { index: [...shell.drawer.querySelectorAll(FOCUSABLE)].indexOf(el), tag: el.tagName };
  }
  function restoreFocus(k) {
    const el = k.key ? shell.drawer.querySelector(`[data-key="${k.key}"]`) : [...shell.drawer.querySelectorAll(FOCUSABLE)][k.index];
    if (el && (k.key || el.tagName === k.tag)) el.focus({ preventScroll: true });
  }

  async function tickAtt() {
    const snap = parseCourses();
    if (!snap) return;
    const d = await store.get({ threshold: 75, latest: null, snapshots: {}, adjust: {}, excused: {}, sortBy: "portal", timetable: null, bunkBasis: "now", eseTarget: undefined });
    const prev = d.snapshots[snap.semester];
    const same = prev && JSON.stringify([prev.overall, prev.courses, prev.hasCc]) === JSON.stringify([snap.overall, snap.courses, snap.hasCc]);
    if (same && Date.now() - prev.syncedAt < 60000) snap.syncedAt = prev.syncedAt; // unchanged: don't rewrite storage on every tick
    d.snapshots[snap.semester] = snap;
    const ROMAN = { I: 1, II: 2, III: 3, IV: 4, V: 5, VI: 6, VII: 7, VIII: 8 };
    const rank = (n) => ROMAN[/\b(VIII|VII|VI|V|IV|III|II|I)\s*$/.exec(n.toUpperCase())?.[1]] || 0;
    const latest = Object.keys(d.snapshots).sort((a, b) => rank(b) - rank(a))[0];
    if (!same || snap.syncedAt !== prev.syncedAt || d.latest !== latest) await store.set({ snapshots: d.snapshots, latest });
    renderAtt({
      snap, threshold: d.threshold, adj: d.adjust[snap.semester], exc: d.excused[snap.semester],
      open: attOpen, sortBy: d.sortBy, tt: d.timetable, basis: d.bunkBasis, eseTarget: d.eseTarget,
    });
  }

  // ---------------------------------------------------------------- timetable page
  const DOW = { sunday: 0, monday: 1, tuesday: 2, wednesday: 3, thursday: 4, friday: 5, saturday: 6 };
  function parseTimetable() {
    const table = [...document.querySelectorAll("main table")].find((x) => /monday/i.test(x.querySelector("thead")?.textContent || ""));
    if (!table) return null;
    const heads = [...table.querySelectorAll("thead th")].map((th) => {
      const m = /(sunday|monday|tuesday|wednesday|thursday|friday|saturday)/i.exec(th.textContent);
      return m ? DOW[m[1].toLowerCase()] : null;
    });
    const days = {};
    for (const tr of table.querySelectorAll("tbody tr")) {
      const tds = tr.querySelectorAll("td");
      const ps = tds[0]?.querySelectorAll("p") || [];
      const period = ps[0]?.textContent.trim();
      if (!period) continue;
      const time = (ps[1]?.textContent || "").replace(/\s+/g, " ").trim();
      tds.forEach((td, i) => {
        const dow = heads[i];
        if (i === 0 || dow == null) return;
        td.querySelectorAll('[role="button"][aria-label]').forEach((el) => {
          const label = el.getAttribute("aria-label");
          if (!label || label === "null") return;
          const name = label.split(", Faculty")[0].trim();
          if (name) (days[dow] ||= []).push({ period, time, name, type: (el.querySelector(".MuiChip-label")?.textContent || "").trim() });
        });
      });
    }
    return Object.keys(days).length ? days : null;
  }

  let ttSig = "";
  async function tickTt() {
    const seen = parseTimetable();
    if (!seen) return;
    const d = await store.get({ timetable: null, snapshots: {}, latest: null });
    // The page shows one week. A holiday week has empty days, so a weekday with no classes in view keeps what was saved before.
    const days = { ...(d.timetable || {}), ...seen };
    if (JSON.stringify(days) !== JSON.stringify(d.timetable)) await store.set({ timetable: days, timetableSavedAt: Date.now() });
    const count = Object.values(days).reduce((n, x) => n + x.length, 0);
    const known = new Set((d.snapshots[d.latest]?.courses || []).map((c) => c.name.trim().toUpperCase()));
    const unknown = known.size ? [...new Set(Object.values(days).flat().map((c) => c.name))].filter((n) => !known.has(n.toUpperCase())) : [];
    const sig = JSON.stringify([count, unknown]);
    if (sig === ttSig && host?.isConnected) return;
    await ensureHost();
    ttSig = sig;
    dock.replaceChildren(h("div", { class: "panel" },
      h("div", { class: "h3 good" }, "✓ Timetable saved for planning"),
      h("div", { class: "sub" }, `${count} classes a week. Open Attendance → Plan a bunk to use it.`),
      unknown.length ? h("div", { class: "warnbox" }, h("div", { class: "sub" }, `Not in your attendance table: ${unknown.join(", ")}`)) : null,
      h("button", { class: "btn solid cta", onclick: () => location.assign("/main/attendence") }, "Plan a bunk", ico("right"))));
  }

  // ---------------------------------------------------------------- absent details page
  // Each absent hour gets one of four marks. Only the last three change anything:
  //   later = counted as attended now (the portal will be updated), cc / med = overall claims only.
  const CHOICES = [
    { s: "abs", letter: "A", cls: "a", color: "var(--bad)", label: "Absent", tip: "Stays absent" },
    { s: "cc", letter: "C", cls: "c", color: "var(--gold)", label: "Co-curricular", tip: "Co-curricular claim (added to overall at semester end)" },
    { s: "med", letter: "M", cls: "m", color: "var(--blue)", label: "Medical", tip: "Medical leave (only considered when the aggregate is 74.5-84.49%)" },
    { s: "later", letter: "L", cls: "l", color: "var(--good)", label: "Later", tip: "Was present: the portal will be updated, count as attended now" },
  ];
  let absSig = "";
  let sel = new Map(); // row key -> "abs" | "cc" | "med" | "later"

  function parseAbsentRows() {
    return [...document.querySelectorAll("main table tbody tr")]
      .map((tr) => {
        const tds = tr.querySelectorAll("td");
        if (tds.length < 4) return null;
        const date = tds[0].querySelector("p")?.textContent.trim();
        const period = tds[1].querySelector("p")?.textContent.trim();
        if (!date || !period) return null;
        const status = tds[3].textContent;
        const hrs = parseFloat(/(\d+(?:\.\d+)?)/.exec(status)?.[1] ?? "1") || 1;
        // What the portal already says: "1 Hr Medical Leave", a co-curricular status, or plain "Absent".
        const portal = /medical/i.test(status) ? "med" : /co-?\s*curricular|on\s*duty/i.test(status) ? "cc" : "abs";
        const day = tds[0].querySelector("span")?.textContent.trim() || ""; // the weekday sits in its own element
        return { k: `${date}|${period}`, date, day, period, type: tds[2].textContent.trim(), h: hrs, portal };
      })
      .filter(Boolean);
  }

  const sigOf = (key, rows, saved) =>
    [key, ...rows.map((r) => r.k + r.portal), "|", ...saved.map((r) => `${r.k}:${r.s}:${r.gone ? 1 : 0}`)].join(",");

  // forced = the course picked in the filter on /main/absence; without it the course is the one whose View Details was clicked.
  async function tickAbs(forced) {
    const rows = parseAbsentRows();
    if (!rows.length) return;
    const d = await store.get({ lastCourse: null, snapshots: {}, excused: {}, adjust: {} });
    const ctx = forced || d.lastCourse;
    await ensureHost();

    if (!ctx) {
      if (absSig === "noctx") return;
      absSig = "noctx";
      dock.replaceChildren(
        h(
          "div",
          { class: "panel" },
          h("div", { class: "h3" }, "Which course is this?"),
          h("p", { class: "sub" }, 'This page doesn\'t say. Go back, switch the course list to table view and open a course with its "View Details" button.'),
          h("button", { class: "btn solid cta", onclick: () => history.back() }, "Back to attendance"),
          h("div", { class: "tagline" }, "Vibecoded UI just like this website, but better")
        )
      );
      return;
    }

    const byK = new Map(rows.map((r) => [r.k, r]));
    const m = (d.excused[ctx.semester] = d.excused[ctx.semester] || {});
    const e0 = m[ctx.key];
    const snap = d.snapshots[ctx.semester];
    const courseNow = snap?.courses.find((x) => (x.code || x.name) === ctx.key);

    // Reconcile what we saved with what the portal shows now.
    const saved = (e0?.rows || [])
      .filter((r) => !(r.p && byK.get(r.k)?.portal !== r.s)) // portal label gone or changed -> drop
      .map((r) => (r.p ? r : { ...r, gone: !byK.has(r.k) })) // marked hour no longer absent -> "updated on portal"
      .filter((r) => r.p || !byK.has(r.k) || byK.get(r.k).portal === "abs"); // portal now labels it itself -> portal wins
    for (const r of rows) {
      if (r.portal === "abs") continue;
      const row = { k: r.k, h: r.h, s: r.portal, p: true }; // auto-record medical / co-curricular set by the portal
      const i = saved.findIndex((x) => x.k === r.k);
      if (i >= 0) saved[i] = row; else saved.push(row);
    }
    if (JSON.stringify(saved) !== JSON.stringify(e0?.rows || [])) {
      if (saved.length) m[ctx.key] = { rows: saved, baseAbsent: e0?.baseAbsent ?? courseNow?.absent ?? undefined };
      else delete m[ctx.key];
      await store.set({ excused: d.excused });
    }

    const sig = sigOf(ctx.key, rows, saved);
    if (sig === absSig) return;
    absSig = sig;
    sel = new Map(
      rows.map((r) => {
        const u = saved.find((x) => x.k === r.k && !x.gone);
        return [r.k, r.portal !== "abs" ? r.portal : u ? (u.s === "cc" || u.s === "med" ? u.s : "later") : "abs"];
      })
    );

    // ---- persistence: every change is saved straight away
    async function persist() {
      const cur = await store.get({ excused: {}, snapshots: {} });
      const mm = (cur.excused[ctx.semester] = cur.excused[ctx.semester] || {});
      const keep = (mm[ctx.key]?.rows || []).filter((r) => r.p || r.gone);
      const mine = rows
        .filter((r) => r.portal === "abs" && sel.get(r.k) !== "abs")
        .map((r) => ({ k: r.k, h: r.h, s: sel.get(r.k), gone: false }));
      const all = [...keep, ...mine];
      if (all.length) {
        const c = cur.snapshots[ctx.semester]?.courses.find((x) => (x.code || x.name) === ctx.key);
        mm[ctx.key] = { rows: all, baseAbsent: c?.absent ?? undefined };
      } else delete mm[ctx.key];
      await store.set({ excused: cur.excused });
      d.excused = cur.excused;
      absSig = sigOf(ctx.key, rows, all); // our own write, no need to rebuild the panel
    }

    // ---- UI
    const segs = new Map(); // row key -> its 4 buttons
    const preview = h("div", { class: "blk preview" });
    const actions = h("div", { class: "actions" });
    const toastBox = h("div", {});
    let toastTimer;

    function paint() {
      for (const [k, btns] of segs) {
        btns.forEach((b) => {
          const on = b.dataset.s === sel.get(k);
          b.classList.toggle("on", on);
          b.setAttribute("aria-pressed", String(on));
        });
      }
      if (!snap || !courseNow) { preview.textContent = ""; return; }
      const mine = rows.filter((r) => r.portal === "abs" && sel.get(r.k) !== "abs").map((r) => ({ k: r.k, h: r.h, s: sel.get(r.k) }));
      const keep = (d.excused[ctx.semester]?.[ctx.key]?.rows || []).filter((r) => r.p || r.gone);
      const exc2 = { ...(d.excused[ctx.semester] || {}), [ctx.key]: { rows: [...keep, ...mine], baseAbsent: courseNow.absent } };
      const base = Calc.effective(snap, {}, {});
      const now = Calc.effective(snap, d.adjust[ctx.semester], exc2);
      const cb = base.courses.find((c) => c.key === ctx.key), cn = now.courses.find((c) => c.key === ctx.key);
      const p = (a, s) => Calc.percent(a, s).toFixed(1);
      preview.replaceChildren(
        h("div", { class: "it2 main" }, h("div", { class: "row" }, h("span", {}, h("b", {}, "Overall")), h("span", { class: "big" }, `${p(base.overall.attended, base.overall.scheduled)}% → `, h("b", { class: "good" }, `${p(now.overall.attended, now.overall.scheduled)}%`)))),
        h("div", { class: "it2 minor" }, h("div", { class: "row" }, h("span", {}, h("b", {}, "This course")), h("span", {}, `${p(cb.attended, cb.scheduled)}% → `, h("b", { class: "good" }, `${p(cn.attended + cn.ccHrs, cn.scheduled)}%`))))
      );
    }

    function toast(text, undo) {
      clearTimeout(toastTimer);
      toastBox.replaceChildren(
        h("div", { class: "toast", role: "status" }, h("span", {}, text), undo ? h("button", { class: "link", onclick: () => { toastBox.replaceChildren(); undo(); } }, "Undo") : null)
      );
      toastTimer = setTimeout(() => toastBox.replaceChildren(), 7000);
    }

    async function change(keys, choice, text) {
      const prev = new Map(sel);
      keys.forEach((k) => sel.set(k, choice));
      paint();
      await persist();
      toast(text, async () => { sel = prev; paint(); await persist(); });
    }

    function drawActions(confirming) {
      const free = rows.filter((r) => r.portal === "abs");
      if (confirming) {
        actions.replaceChildren(
          h("span", { class: "bad" }, "Reset every hour to absent?"),
          h("button", { class: "btn danger sm", onclick: () => { drawActions(false); change(free.map((r) => r.k), "abs", "All hours reset to absent."); } }, "Yes, reset"),
          h("button", { class: "btn sm", onclick: () => drawActions(false) }, "Cancel")
        );
      } else {
        actions.replaceChildren(
          h("button", { class: "btn sm", onclick: () => change(free.map((r) => r.k), "later", "All hours marked Later.") }, "Mark all later"),
          h("button", { class: "btn danger sm", onclick: () => drawActions(true) }, "Reset all")
        );
      }
    }

    const hourEls = rows.map((r) => {
      const when = `${niceDate(`${r.date} ${r.day}`)}, ${nicePeriod(r.period)}`;
      const left = (locked) => h("span", {}, h("b", {}, when), h("div", { class: "sub wrap" }, r.type, sep(), `${fmt(r.h)}h`, locked ? [sep(), ico("lock", "ic lk"), " Set by portal"] : null));
      if (r.portal !== "abs") { // the portal already labelled it: same control, its mark lit, the rest disabled
        return h("div", { class: "it2" }, h("div", { class: "row" }, left(true),
          h("span", { class: "seg lockd", role: "group", title: "The portal already shows this", "aria-label": `${when}: set by the portal` },
            CHOICES.map((c) => h("button", { class: `${c.cls}${c.s === r.portal ? " on" : ""}`, disabled: true, title: c.tip, "aria-label": c.label }, c.letter)))));
      }
      const btns = CHOICES.map((c) =>
        h("button", { class: `${c.cls}`, "data-s": c.s, title: c.tip, "aria-label": `${c.label}: ${when}`, onclick: () => { if (sel.get(r.k) !== c.s) change([r.k], c.s, `${when} → ${c.label}.`); } }, c.letter)
      );
      segs.set(r.k, btns);
      return h("div", { class: "it2" }, h("div", { class: "row" }, left(false), h("span", { class: "seg", role: "group", "aria-label": `Mark ${when}` }, btns)));
    });

    // Hours you marked that the portal has since updated: confirm they are really present now.
    const gone = saved.filter((r) => r.gone);
    const goneBox = gone.length
      ? h(
          "div",
          { class: "updated" },
          h("b", { class: "good" }, "Updated on the portal"),
          h("div", { class: "sub" }, "No longer listed as absent. Confirm they are present now."),
          gone.map((r) => {
            const [date, period] = r.k.split("|");
            return h(
              "div",
              { class: "row", style: "margin-top:12px" },
              h("span", {}, `${niceDate(date)}, ${nicePeriod(period)} (${fmt(r.h)}h)`),
              h("button", { class: "btn sm", onclick: async () => {
                const cur = await store.get({ excused: {}, snapshots: {} });
                const e = cur.excused[ctx.semester]?.[ctx.key];
                if (!e) return;
                e.rows = e.rows.filter((x) => x.k !== r.k);
                const c = cur.snapshots[ctx.semester]?.courses.find((x) => (x.code || x.name) === ctx.key);
                if (e.rows.length) e.baseAbsent = c?.absent ?? e.baseAbsent;
                else delete cur.excused[ctx.semester][ctx.key];
                await store.set({ excused: cur.excused });
                absSig = "";
                tickAbs();
              } }, "Confirm present")
            );
          })
        )
      : null;

    drawActions(false);
    dock.replaceChildren(
      h(
        "div",
        { class: "panel" },
        h("div", { class: "h3" }, ctx.name || ctx.key),
        h("div", { class: "sub" }, `${plural(rows.length, "hour")} listed as absent or leave. Changes save as you click.`),
        legendEl(),
        h("div", { class: "blk" }, hourEls),
        goneBox,
        preview,
        actions,
        toastBox,
        h("div", { class: "tagline" }, "Vibecoded UI just like this website, but better")
      )
    );
    paint();
  }

  // The all-courses list (/main/absence): save its rows for the toolbar popup's summary and show just a pill.
  // Marking happens on the per-course page, because the marks are stored per course.
  function parseAllAbsences() {
    return [...document.querySelectorAll("main table tbody tr")].map((tr) => {
      const tds = tr.querySelectorAll("td");
      if (tds.length < 5) return null;
      const txt = (td, sel) => td.querySelector(sel)?.textContent.trim() || "";
      const status = tds[4].textContent;
      const hrs = parseFloat(/(\d+(?:\.\d+)?)/.exec(status)?.[1] ?? "1") || 1;
      const kind = /medical/i.test(status) ? "med" : /co-?\s*curricular|on\s*duty/i.test(status) ? "cc" : "abs";
      return { date: txt(tds[0], "p"), day: txt(tds[0], "span"), period: txt(tds[1], "p"), time: txt(tds[1], "span"), code: txt(tds[2], "p"), name: txt(tds[2], "span"), type: tds[3].textContent.trim(), kind, h: hrs };
    }).filter((r) => r && r.date && r.period);
  }
  let absOpen = false, absShell = null;
  let absMark = false;           // the "Mark hours" toggle of the all-courses drawer
  let absRows = [], absData = null;
  const legendEl = () => h("div", { class: "lg" }, CHOICES.map((c) => h("span", { title: c.tip }, h("b", { style: `background:${c.color}` }, c.letter), c.label))); // A / C / M / L key, shared by both marking views
  const absKey = (r) => (r.code && r.code.toUpperCase() !== "N/A" ? r.code : r.name);
  async function refreshAbsData() {
    const d = await store.get({ latest: null, snapshots: {}, excused: {}, adjust: {} });
    absData = { sem: d.latest, snap: d.snapshots[d.latest], excused: d.excused[d.latest] || {}, adjust: d.adjust[d.latest] };
  }
  // Same record the per-course panel writes: excused[sem][courseKey].rows = [{ k: "date|period", h, s, gone }].
  async function markAbs(r, choice) {
    const d = await store.get({ latest: null, snapshots: {}, excused: {} });
    const c = d.snapshots[d.latest]?.courses.find((x) => (x.code || x.name) === absKey(r));
    if (!c) return;
    const m = (d.excused[d.latest] = d.excused[d.latest] || {});
    const k = `${r.date}|${r.period}`;
    const rows = (m[c.code || c.name]?.rows || []).filter((x) => x.k !== k);
    if (choice !== "abs") rows.push({ k, h: r.h, s: choice, gone: false });
    if (rows.length) m[c.code || c.name] = { rows, baseAbsent: c.absent ?? undefined }; else delete m[c.code || c.name];
    await store.set({ excused: d.excused });
  }
  function drawAbsBody() {
    if (!absShell || !absData) return;
    const focused = host.shadowRoot.activeElement;
    const fk = focused && absShell.drawer.contains(focused) ? focused.dataset.key : null;
    absShell.markBtn.setAttribute("aria-pressed", String(absMark));
    absShell.markBtn.classList.toggle("on", absMark);
    const snap = absData.snap;
    const selOf = (r) => { const u = (absData.excused[absKey(r)]?.rows || []).find((x) => x.k === `${r.date}|${r.period}` && !x.gone); return u ? (u.s === "cc" || u.s === "med" ? u.s : "later") : "abs"; };
    const opts = { on: absMark, choices: CHOICES, selOf, canMark: (r) => !!snap?.courses.find((x) => (x.code || x.name) === absKey(r)),
      pick: async (r, choice) => { await markAbs(r, choice); await refreshAbsData(); drawAbsBody(); } };
    let preview = null;
    if (absMark && snap) {
      const base = Calc.effective(snap, {}, {}), now = Calc.effective(snap, absData.adjust, absData.excused);
      const bp = Calc.percent(base.overall.attended, base.overall.scheduled), np = Calc.percent(now.overall.attended, now.overall.scheduled);
      preview = h("div", { class: "it2 main" }, h("div", { class: "row" }, h("span", {}, h("b", {}, "With your marks")), h("span", { class: "big" }, `${bp.toFixed(1)}% to `, h("b", { class: np > bp ? "good" : "" }, `${np.toFixed(1)}%`))),
        h("p", { class: "sub" }, "Each mark saves straight away. Tap A to undo one."), legendEl());
    }
    absShell.body.replaceChildren(...[preview, absentDays(absRows, opts)].flat(Infinity).filter(Boolean));
    if (fk) absShell.drawer.querySelector(`[data-key="${fk}"]`)?.focus({ preventScroll: true });
  }
  function setAbsOpen(v) {
    absOpen = v;
    if (absShell) { absShell.drawer.classList.toggle("open", v); absShell.pill.setAttribute("aria-expanded", String(v)); }
  }
  async function tickAbsAll() {
    // A single course picked in the filter ("CSEAM633 (4)"): the table is then the same 4-column layout as Absent Details, so mark it there too.
    const code = /^([^\s(]+)\s*\(\d+\)/.exec(document.querySelector('[role="combobox"]')?.textContent.trim() || "")?.[1];
    if (code && code.toLowerCase() !== "all") {
      const d = await store.get({ latest: null, snapshots: {} });
      const c = d.snapshots[d.latest]?.courses.find((x) => (x.code || x.name) === code);
      if (c) return tickAbs({ semester: d.latest, key: code, name: c.name });
    }
    const rows = parseAllAbsences();
    if (!rows.length) return;
    const sig = JSON.stringify(rows);
    if (absSig === sig && host?.isConnected && absShell && dock.contains(absShell.drawer)) return;
    absSig = sig;
    const allCourses = /^all courses/i.test(document.querySelector('[role="combobox"]')?.textContent.trim() || "");
    if (allCourses) { // a single-course filter would overwrite the full list with a part of it
      const d = await store.get({ latest: null });
      await store.set({ absentList: { sem: d.latest, at: Date.now(), rows } });
    }
    await ensureHost();
    if (!absShell || !dock.contains(absShell.drawer)) {
      const pill = h("button", { class: "pill", "aria-label": "Absent hours summary", "aria-expanded": "false", onclick: () => { setAbsOpen(!absOpen); ping(pill); } });
      pill.addEventListener("animationend", (e) => { if (e.animationName === "dotOrbit") pill.classList.remove("clicked"); });
      const sub = h("div", { class: "sub" });
      const body = h("div", { class: "blk" });
      const markBtn = h("button", { class: "btn sm", "aria-pressed": "false", "data-key": "mark-toggle", onclick: () => { absMark = !absMark; drawAbsBody(); } }, "Mark hours");
      const drawer = h("div", { class: "drawer", role: "dialog", "aria-label": "Absent hours" },
        h("div", { class: "top" }, h("div", {}, h("b", {}, "Absent hours"), sub), h("span", { class: "topa" }, markBtn, h("button", { class: "xb", "aria-label": "Close", onclick: () => setAbsOpen(false) }, ico("close")))),
        body, h("div", { class: "tagline" }, "Vibecoded UI just like this website, but better"));
      dock.replaceChildren(drawer, pill);
      absShell = { pill, sub, body, drawer, markBtn };
    }
    absShell.pill.replaceChildren(h("i", { class: "bad-dot" }), `${fmt(hrsOf(rows, "abs"))}h absent`,
      hrsOf(rows, "cc") || hrsOf(rows, "med") ? h("span", { class: "sub" }, [hrsOf(rows, "cc") ? `${fmt(hrsOf(rows, "cc"))}h co-curricular` : null, hrsOf(rows, "med") ? `${fmt(hrsOf(rows, "med"))}h medical` : null].filter(Boolean).join(", ")) : null);
    absShell.sub.replaceChildren(...absentSummary(rows).flat(Infinity).filter(Boolean));
    absRows = rows;
    await refreshAbsData();
    drawAbsBody();
    setAbsOpen(absOpen);
  }

  // ---------------------------------------------------------------- driver
  let timer, lastRoute = null;
  function tick() {
    if (!alive()) { expire(); return; }
    const r = route();
    syncGutter();
    if (r !== lastRoute) { // page changed: clear the old UI, and a drawer left open on the last page shrinks back to its pill
      if (lastRoute !== null) { absOpen = false; attOpen = false; absShell = null; shell = null; }
      dock?.replaceChildren(); attSig = ""; absSig = ""; ttSig = ""; lastRoute = r;
    }
    if (!r) {
      host?.remove();
      host = null;
      return;
    }
    if (r === "att") tickAtt();
    else if (r === "abs") tickAbs();
    else if (r === "absall") tickAbsAll();
    else tickTt();
  }
  // React quickly to the first change (the portal's table appearing), then at most once per 600ms while it keeps mutating.
  let lastTick = 0;
  const mo = new MutationObserver((muts) => {
    if (muts.every((mu) => mu.target === host || host?.contains(mu.target))) return; // ignore our own DOM changes
    if (timer) return;
    timer = setTimeout(() => { timer = 0; lastTick = Date.now(); tick(); }, Math.max(30, lastTick + 600 - Date.now()));
  });
  mo.observe(document.body, { childList: true, subtree: true });
  // The extension was reloaded under this tab: say so once and stop, instead of throwing on every page change.
  function expire() {
    mo.disconnect();
    clearTimeout(timer);
    if (!dock?.isConnected) { host?.remove(); return; }
    dock.replaceChildren(h("div", { class: "panel" },
      h("div", { class: "h3" }, "leavemealone was updated"),
      h("p", { class: "sub" }, "Reload this page to keep using it."),
      h("button", { class: "btn solid cta", onclick: () => location.reload() }, "Reload page")));
  }
  tick();
})();
