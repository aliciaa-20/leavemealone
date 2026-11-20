// CUE attendance helper. Runs on the whole portal host (it is a single-page app, so
// pages change without a reload) and acts by route:
//   /main/attendence    -> parse the course table, save a snapshot, show a pill + drawer,
//                          remember which course's "View Details" you click
//   /main/AbsentDetails -> mark each absent hour as absent / co-curricular / medical / later
//   /main/timeTable     -> save the weekly timetable for the "Plan a bunk" tab
// All UI lives in one Shadow DOM host so the portal's CSS and ours never touch.
(() => {
  const store = {
    get: (d) => chrome.storage.local.get(d),
    set: (o) => chrome.storage.local.set(o),
  };
  const route = () => {
    const p = location.pathname.toLowerCase();
    return p.includes("/main/attendence") ? "att" : p.includes("/main/absentdetails") ? "abs" : p.includes("/main/timetable") ? "tt" : null;
  };
  const pair = (txt) => {
    const m = /(\d+(?:\.\d+)?)\s*\/\s*(\d+(?:\.\d+)?)/.exec(txt || "");
    return m ? [parseFloat(m[1]), parseFloat(m[2])] : null;
  };
  const semester = () => document.querySelector('[role="combobox"]')?.textContent.trim() || "unknown";
  const COURSE_TABLE = 'table[aria-label="coursewise attendance table"]';
  const fmt = (n) => (Number.isInteger(n) ? String(n) : n.toFixed(1));

  // Tiny DOM builder: h("div", {class: "x", onclick: fn}, child, "text", ...)
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
    if (!cssText) {
      try { cssText = await (await fetch(chrome.runtime.getURL("ui.css"))).text(); } catch { cssText = ""; }
    }
    host = document.createElement("div");
    host.id = "cue-att-host";
    const shadow = host.attachShadow({ mode: "open" });
    dock = h("div", { class: "cue dock" });
    const style = document.createElement("style");
    style.textContent = cssText;
    shadow.append(style, dock);
    document.body.append(host);
  }
  function ensureHost() {
    if (host?.isConnected) return Promise.resolve();
    hostPromise ||= buildHost().finally(() => { hostPromise = null; });
    return hostPromise;
  }
  const tone = (pct, thr) => (pct < thr ? "bad" : pct < thr + 10 ? "warn" : "good");
  const bar = (pct, thr) =>
    h("div", { class: "bar" }, h("i", { class: tone(pct, thr), style: `width:${Math.min(100, Math.max(0, pct))}%` }), h("b", { style: `left:${thr}%` }));

  // ---------------------------------------------------------------- attendance page
  // A = everything the drawer needs: { snap, threshold, adj, exc, open, sortBy, tt, basis }
  let attOpen = false;
  let attSig = "";
  let A = null;
  let tab = "overview";          // "overview" | "plan"
  let planSel = new Map();       // dayKey -> Set(periods) | null (whole day)
  let planMonth = 0;             // months after the first plannable month
  let planOpenDay = null;        // day whose periods are expanded

  const rerender = () => { if (A) { attSig = ""; renderAtt(A); } };
  function setOpen(v) {
    attOpen = v;
    store.set({ panelOpen: v });
    if (A) { A.open = v; rerender(); }
  }
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && attOpen) setOpen(false); });
  document.addEventListener("click", (e) => {
    if (attOpen && host && !e.composedPath().includes(host)) setOpen(false);
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

  const dayLabel = (d) => d.toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short" });
  const today0 = () => { const n = new Date(); return new Date(n.getFullYear(), n.getMonth(), n.getDate()); };

  // ---- Overview tab
  function overviewView(eff, threshold, t) {
    const o = eff.overall;
    const op = Calc.percent(o.attended, o.scheduled);
    const courses = eff.courses.filter((c) => c.scheduled > 0);
    const notes = [];
    if (o.medical) notes.push(h("div", { class: "note", style: "color:var(--primary)" }, `Medical ${fmt(o.medical)} h: ${Calc.medicalText(o)}`));
    if (o.ccIncluded) notes.push(h("div", { class: "note muted" }, "Co-curricular is already included by the portal."));
    else if (o.cocurricular) notes.push(h("div", { class: "note muted" }, `Includes ${fmt(o.cocurricular)} h co-curricular claimed.`));

    const review = courses.filter((c) => c.stale || c.goneHrs);
    const reviewBox = review.length
      ? h(
          "div",
          { class: "card", style: "border-color:var(--c-later)" },
          h("div", { class: "sec", style: "margin-top:0" }, "Needs review"),
          review.map((c) =>
            h("div", { class: "note" }, h("b", {}, c.code || c.name),
              c.goneHrs ? ` · ${fmt(c.goneHrs)} h updated on the portal: open View Details and press Confirm present` : " · the portal's numbers changed since you adjusted this; check it")
          )
        )
      : null;

    const sortBar = h(
      "div",
      { class: "row", style: "margin-bottom:6px" },
      h("span", { class: "sec", style: "margin:0" }, "Courses"),
      h(
        "label",
        { class: "sub", style: "display:flex;align-items:center;gap:6px" },
        "Sort by",
        h("select", { class: "sort", "aria-label": "Sort courses", onchange: (e) => { A.sortBy = e.target.value; store.set({ sortBy: A.sortBy }); rerender(); } },
          SORTS.map((s) => h("option", { value: s.v, selected: s.v === A.sortBy }, s.label)))
      )
    );

    const list = sortCourses(courses, A.sortBy).map((c) => {
      const pct = Calc.percent(c.attended, c.scheduled);
      const low = pct < threshold;
      const adjusted = !!(c.adj.att || c.adj.sch || c.excusedHrs);
      const skip = Calc.canSkip(c.attended, c.scheduled, t);
      const chip = low
        ? h("span", { class: "chip bad" }, `attend next ${Calc.mustAttend(c.attended, c.scheduled, t)}`)
        : h("span", { class: `chip ${skip ? "good" : "warn"}` }, `can skip ${skip}`);
      const tip = adjusted ? `Portal ${c.portalAttended}/${c.portalScheduled} → with your marks ${fmt(c.attended)}/${c.scheduled}` : "";
      return h(
        "div",
        { class: "course", title: tip },
        h("div", { class: "row" },
          h("div", { class: "name" }, h("span", { class: "code" }, c.code || c.name), adjusted ? h("span", { class: "badge" }, "adj") : null, c.code ? h("div", { class: "full" }, c.name) : null),
          h("div", { style: "text-align:right" }, h("span", { class: `pct ${tone(pct, threshold)}` }, `${pct.toFixed(0)}%`), " ", chip)),
        bar(pct, threshold)
      );
    });

    return [
      h("div", { class: "card" },
        h("div", { class: "row" }, h("span", { class: `big ${tone(op, threshold)}` }, `${op.toFixed(1)}%`), h("span", { class: "sub" }, `${fmt(o.attended)} / ${o.scheduled} hrs`)),
        bar(op, threshold),
        notes),
      reviewBox,
      sortBar,
      h("div", { class: "card" }, list),
    ];
  }

  // ---- Plan a bunk tab
  function planView(eff, threshold, t) {
    if (!A.tt) {
      return [h("div", { class: "card" },
        h("div", { class: "title" }, "Open your timetable once"),
        h("p", { class: "sub" }, "I need your weekly timetable to know which classes you'd miss. Open it once and come back."),
        h("button", { class: "btn solid", onclick: () => location.assign("/main/timeTable") }, "Open timetable"))];
    }
    const from = Cal.addDays(today0(), 1);
    // A saved "mse" basis only holds while MSE is still ahead; "line" is the % that counts as safe.
    const basis = Plan.resolveBasis(A.basis, from);
    const esePct = Math.min(100, Math.max(1, A.eseTarget ?? threshold));
    const line = Plan.thresholdFor(basis, t, esePct);
    const end = Plan.horizon(basis, from);
    const examName = basis === "mse" ? "MSE" : "ESE";
    const picked = planSel.size;
    planSel = Plan.clipSelection(planSel, end);
    const dropped = picked - planSel.size;
    if (planOpenDay && !planSel.has(planOpenDay)) planOpenDay = null;
    const courses = eff.courses;
    const out = [];

    out.push(h("div", { class: "row", style: "margin-bottom:8px" },
      h("span", { class: "sub" }, "Safe means"),
      h("select", { class: "sort", "aria-label": "Safe means", onchange: (e) => { A.basis = e.target.value; store.set({ bunkBasis: A.basis }); rerender(); } },
        h("option", { value: "now", selected: basis === "now" }, "Right after the bunk"),
        Plan.resolveBasis("mse", from) === "mse" ? h("option", { value: "mse", selected: basis === "mse" }, "Before MSE (75% needed)") : null,
        h("option", { value: "end", selected: basis === "end" }, "Before ESE (my target)"))));
    if (basis === "end") {
      out.push(h("div", { class: "row", style: "margin-bottom:8px" },
        h("span", { class: "sub" }, "My ESE target (%)"),
        h("input", { type: "number", min: 1, max: 100, value: esePct, "aria-label": "ESE target percentage", onchange: (e) => {
          const v = parseFloat(e.target.value);
          A.eseTarget = v > 0 ? Math.min(100, Math.max(1, v)) : threshold; // empty, 0 or negative: back to the minimum
          store.set({ eseTarget: A.eseTarget });
          rerender();
        } })));
    }
    if (A.basis === "mse" && basis === "now") out.push(h("div", { class: "note warn" }, "MSE isn't open for planning (no class days left before it, or it isn't in the calendar), so these are right-now numbers."));
    if (dropped) out.push(h("div", { class: "note muted" }, `${dropped} selected day${dropped > 1 ? "s" : ""} after the ${examName} cutoff ${dropped > 1 ? "were" : "was"} removed.`));
    if (!Cal.known(from)) out.push(h("div", { class: "note warn" }, "This year's academic calendar isn't in the extension yet, so holidays aren't known."));

    // Bunk budget: classes each course can still miss before the cutoff
    const bud = Plan.budgets({ eff, tt: A.tt, basis, t: line, from });
    if (bud) {
      const chip = (r) => !r.matched ? h("span", { class: "chip muted" }, "not in your timetable")
        : !r.reachable ? h("span", { class: "chip bad" }, `best case ${Math.floor(r.bestCase)}%, out of reach`)
        : r.budget === 0 ? h("span", { class: "chip warn" }, "no spare classes")
        : h("span", { class: "chip good" }, `can still miss ${r.budget}`);
      out.push(h("div", { class: "sec" }, `Before ${examName} · ${dayLabel(bud.end)}`));
      out.push(h("div", { class: "card" }, [bud.overall, ...bud.rows].map((r) => h("div", { class: "course" },
        h("div", { class: "row" },
          h("div", { class: "name" }, h("span", { class: "code" }, r.code || r.name), r.matched ? h("div", { class: "sub" }, `${r.R} class${r.R === 1 ? "" : "es"} left until then`) : null),
          h("div", { style: "text-align:right" }, chip(r)))))));
    }

    // Best days to bunk
    const best = Plan.bestDays({ eff, tt: A.tt, courses, basis, t: line, from });
    out.push(h("div", { class: "sec" }, "Best days to bunk"));
    out.push(h("div", { class: "card" },
      best.days.length
        ? best.days.map((b) => h("button", {
            class: `bestday${planSel.has(b.key) ? " on" : ""}`,
            onclick: () => { planSel = new Map([[b.key, null]]); planOpenDay = b.key; planMonth = monthOffset(from, b.date); rerender(); },
          },
          h("div", { class: "row" },
            h("b", {}, dayLabel(b.date)),
            h("span", { class: `chip ${b.safe ? "good" : "bad"}` }, b.safe ? "safe" : "risky")),
          h("div", { class: "sub" }, `${b.classes} class${b.classes > 1 ? "es" : ""}${b.lowest != null ? ` · lowest after: ${b.lowest.toFixed(0)}%` : ""}`),
          b.tags.length ? h("div", { class: "tags" }, b.tags.map((x) => h("span", { class: "tagchip" }, x))) : null))
        : h("div", { class: "sub" }, basis === "mse" ? "No class days left before MSE." : "No class days left this semester.")));

    // Calendar picker
    out.push(h("div", { class: "sec" }, "Pick days"));
    out.push(calendarView(from, Cal.semesterEnd(from), end));

    // Expanded day: choose single periods
    if (planOpenDay && planSel.has(planOpenDay)) {
      const d = Cal.parse(planOpenDay);
      const cls = Plan.classesOn(d, A.tt);
      const cur = planSel.get(planOpenDay);
      out.push(h("div", { class: "card" },
        h("div", { class: "row" }, h("b", {}, dayLabel(d)), h("span", { class: "sub" }, "untick the classes you'll attend")),
        cls.map((c) => h("label", { class: "period" },
          h("input", { type: "checkbox", checked: !cur || cur.has(c.period), onchange: (e) => {
            const set = new Set(cur ? cur : cls.map((x) => x.period));
            e.target.checked ? set.add(c.period) : set.delete(c.period);
            if (!set.size) { planSel.delete(planOpenDay); planOpenDay = null; }
            else planSel.set(planOpenDay, set.size === cls.length ? null : set);
            rerender();
          } }),
          h("span", {}, `${c.period.replace("Period-", "P")} · ${c.time || ""}`), h("span", { class: "sub" }, c.name)))));
    }

    // Result
    if (planSel.size) {
      const remaining = basis !== "now" ? best.remaining : {};
      const { missed, unknown } = Plan.missedFor(planSel, A.tt, courses);
      const imp = Plan.impact(eff, missed, basis, remaining, line);
      const arrow = (r) => [`${r.before.toFixed(1)}% → `, h("b", { class: r.safe ? "good" : "bad" }, `${r.after.toFixed(1)}%`)];
      out.push(h("div", { class: "sec" }, "If you bunk"));
      out.push(h("div", { class: "card", style: `border-color:${imp.safe ? "var(--good)" : "var(--bad)"}` },
        h("div", { class: "row" },
          h("b", { class: imp.safe ? "good" : "bad" }, imp.safe ? "Safe to bunk" : "Not safe"),
          h("span", { class: "sub" }, `${planSel.size} day${planSel.size > 1 ? "s" : ""} · ${imp.overall.k} class${imp.overall.k === 1 ? "" : "es"} missed`)),
        h("div", { class: "note" }, h("b", {}, "Overall "), arrow(imp.overall)),
        imp.rows.map((r) => h("div", { class: "course" },
          h("div", { class: "row" },
            h("div", { class: "name" }, h("span", { class: "code" }, r.code || r.name), h("span", { class: "sub" }, `  −${r.k} h`)),
            h("div", { style: "text-align:right" }, arrow(r), " ",
              r.safe ? h("span", { class: "chip good" }, "safe")
                : h("span", { class: "chip bad" }, basis !== "now" ? `below ${Math.round(line * 100)}%` : `attend next ${r.recover}`))))),
        unknown.length ? h("div", { class: "note muted" }, `Not in your attendance table: ${unknown.join(", ")}`) : null,
        basis !== "now" ? h("div", { class: "note muted" }, `Assumes you attend every other class until ${end ? dayLabel(end) : "the semester ends"} (${examName}).`) : null,
        h("div", { class: "actions" }, h("button", { class: "btn small", onclick: () => { planSel = new Map(); planOpenDay = null; rerender(); } }, "Clear selection"))));
    }
    return out;
  }

  const monthOffset = (a, b) => (b.getFullYear() - a.getFullYear()) * 12 + b.getMonth() - a.getMonth();

  // navEnd = last month you can browse to (semester end); last = last day that can be picked (the basis' cutoff).
  function calendarView(from, navEnd, last) {
    const maxOff = navEnd ? Math.max(0, monthOffset(from, navEnd)) : 3;
    planMonth = Math.min(Math.max(0, planMonth), maxOff);
    const first = new Date(from.getFullYear(), from.getMonth() + planMonth, 1);
    const daysIn = new Date(first.getFullYear(), first.getMonth() + 1, 0).getDate();
    const lead = (first.getDay() + 6) % 7; // Monday-first grid
    const cells = [];
    for (let i = 0; i < lead; i++) cells.push(h("span", { class: "cday empty" }));
    for (let n = 1; n <= daysIn; n++) {
      const d = new Date(first.getFullYear(), first.getMonth(), n);
      const k = Cal.key(d);
      const info = Cal.dayInfo(d);
      const cls = Plan.classesOn(d, A.tt).length;
      const usable = d >= from && (!last || d <= last) && info.classDay && cls > 0;
      const sel = planSel.has(k);
      const kind = !usable ? (info.holiday ? "hol" : "off") : sel ? "sel" : "open";
      const title = usable ? `${cls} class${cls > 1 ? "es" : ""}` : info.reason || (d < from ? "Past" : last && d > last ? "After the cutoff" : "No classes");
      cells.push(h(usable ? "button" : "span", {
        class: `cday ${kind}`, title, "aria-label": `${dayLabel(d)}: ${title}`, "aria-pressed": usable ? String(sel) : null,
        onclick: usable ? () => {
          if (sel) { planSel.delete(k); if (planOpenDay === k) planOpenDay = null; }
          else { planSel.set(k, null); planOpenDay = k; }
          rerender();
        } : null,
      }, String(n), usable ? h("i", {}, "•".repeat(Math.min(cls, 6))) : null));
    }
    return h("div", { class: "card" },
      h("div", { class: "row", style: "margin-bottom:6px" },
        h("button", { class: "x", "aria-label": "Previous month", disabled: planMonth <= 0, onclick: () => { planMonth--; rerender(); } }, "‹"),
        h("b", {}, first.toLocaleDateString("en-IN", { month: "long", year: "numeric" })),
        h("button", { class: "x", "aria-label": "Next month", disabled: planMonth >= maxOff, onclick: () => { planMonth++; rerender(); } }, "›")),
      h("div", { class: "cal" }, ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"].map((x) => h("span", { class: "chead" }, x)), cells),
      h("div", { class: "legend", style: "margin:8px 0 0" },
        h("span", {}, h("b", { style: "background:var(--primary)" }, ""), "selected"),
        h("span", {}, h("b", { style: "background:rgba(244,63,94,.35)" }, ""), "holiday / no classes")));
  }

  async function renderAtt(state) {
    A = state;
    attOpen = A.open;
    const { snap, threshold } = A;
    const eff = Calc.effective(snap, A.adj, A.exc);
    const sig = JSON.stringify([eff, threshold, A.open, snap.semester, A.sortBy, A.basis, A.eseTarget, A.tt, tab, [...planSel].map(([k, v]) => [k, v && [...v]]), planMonth, planOpenDay]);
    if (sig === attSig && host?.isConnected) return;
    await ensureHost();
    attSig = sig;
    const t = threshold / 100;
    const o = eff.overall;
    const op = Calc.percent(o.attended, o.scheduled);
    const lowN = eff.courses.filter((c) => c.scheduled > 0 && Calc.percent(c.attended, c.scheduled) < threshold).length;

    const pill = h(
      "button",
      { class: `pill ${tone(op, threshold)}`, "aria-expanded": String(A.open), "aria-label": "Attendance summary", onclick: () => setOpen(!attOpen) },
      h("span", { class: "dot" }),
      `${op.toFixed(1)}%`,
      lowN ? h("span", { class: "sub" }, `${lowN} low`) : null
    );

    const tabBtn = (id, label) => h("button", { class: `tab${tab === id ? " on" : ""}`, role: "tab", "aria-selected": String(tab === id), onclick: () => { tab = id; rerender(); } }, label);
    const scroll = A.open ? dock.querySelector(".drawer")?.scrollTop || 0 : 0;
    const drawer = h(
      "div",
      { class: `drawer${A.open ? " open" : ""}`, role: "dialog", "aria-label": "Attendance details" },
      h("div", { class: "dh" },
        h("div", {}, h("div", { class: "title" }, "Attendance"), h("div", { class: "sub" }, `${snap.semester} · minimum ${threshold}%`)),
        h("button", { class: "x", "aria-label": "Close", onclick: () => setOpen(false) }, "✕")),
      h("div", { class: "tabs", role: "tablist" }, tabBtn("overview", "Overview"), tabBtn("plan", "Plan a bunk")),
      tab === "plan" ? planView(eff, threshold, t) : overviewView(eff, threshold, t),
      h("div", { class: "tag" }, "Vibecoded UI just like this website")
    );
    dock.replaceChildren(drawer, pill);
    drawer.scrollTop = scroll; // keep position while clicking around the planner
  }

  async function tickAtt() {
    const snap = parseCourses();
    if (!snap) return;
    const d = await store.get({ threshold: 75, snapshots: {}, adjust: {}, excused: {}, panelOpen: false, sortBy: "portal", timetable: null, bunkBasis: "now", eseTarget: undefined });
    d.snapshots[snap.semester] = snap;
    const ROMAN = { I: 1, II: 2, III: 3, IV: 4, V: 5, VI: 6, VII: 7, VIII: 8 };
    const rank = (n) => ROMAN[/\b(VIII|VII|VI|V|IV|III|II|I)\s*$/.exec(n.toUpperCase())?.[1]] || 0;
    const latest = Object.keys(d.snapshots).sort((a, b) => rank(b) - rank(a))[0];
    await store.set({ snapshots: d.snapshots, latest });
    renderAtt({
      snap, threshold: d.threshold, adj: d.adjust[snap.semester], exc: d.excused[snap.semester],
      open: d.panelOpen, sortBy: d.sortBy, tt: d.timetable, basis: d.bunkBasis, eseTarget: d.eseTarget,
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
    const days = parseTimetable();
    if (!days) return;
    const d = await store.get({ timetable: null, snapshots: {}, latest: null });
    if (JSON.stringify(days) !== JSON.stringify(d.timetable)) await store.set({ timetable: days, timetableSavedAt: Date.now() });
    const count = Object.values(days).reduce((n, x) => n + x.length, 0);
    const known = new Set((d.snapshots[d.latest]?.courses || []).map((c) => c.name.trim().toUpperCase()));
    const unknown = known.size ? [...new Set(Object.values(days).flat().map((c) => c.name))].filter((n) => !known.has(n.toUpperCase())) : [];
    const sig = JSON.stringify([count, unknown]);
    if (sig === ttSig && host?.isConnected) return;
    await ensureHost();
    ttSig = sig;
    dock.replaceChildren(h("div", { class: "panel" },
      h("div", { class: "title good" }, "✓ Timetable saved for planning"),
      h("div", { class: "sub" }, `${count} classes a week. Open Attendance → Plan a bunk to use it.`),
      unknown.length ? h("div", { class: "note warn" }, `Not in your attendance table: ${unknown.join(", ")}`) : null,
      h("div", { class: "actions" }, h("button", { class: "btn solid small", onclick: () => location.assign("/main/attendence") }, "Plan a bunk"))));
  }

  // ---------------------------------------------------------------- absent details page
  // Each absent hour gets one of four marks. Only the last three change anything:
  //   later = counted as attended now (the portal will be updated), cc / med = overall claims only.
  const CHOICES = [
    { s: "abs", letter: "A", cls: "a", color: "var(--c-abs)", label: "Absent", tip: "Stays absent" },
    { s: "cc", letter: "C", cls: "c", color: "var(--c-cc)", label: "Co-curricular", tip: "Co-curricular claim (added to overall at semester end)" },
    { s: "med", letter: "M", cls: "m", color: "var(--c-med)", label: "Medical", tip: "Medical leave (only considered when the aggregate is 74.5-84.49%)" },
    { s: "later", letter: "L", cls: "l", color: "var(--c-later)", label: "Later", tip: "Was present: the portal will be updated, count as attended now" },
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
        return { k: `${date}|${period}`, date, period, type: tds[2].textContent.trim(), h: hrs, portal };
      })
      .filter(Boolean);
  }

  const sigOf = (key, rows, saved) =>
    [key, ...rows.map((r) => r.k + r.portal), "|", ...saved.map((r) => `${r.k}:${r.s}:${r.gone ? 1 : 0}`)].join(",");

  async function tickAbs() {
    const rows = parseAbsentRows();
    if (!rows.length) return;
    const d = await store.get({ lastCourse: null, snapshots: {}, excused: {}, adjust: {} });
    const ctx = d.lastCourse;
    await ensureHost();

    if (!ctx) {
      if (absSig === "noctx") return;
      absSig = "noctx";
      dock.replaceChildren(
        h(
          "div",
          { class: "panel" },
          h("div", { class: "title" }, "Which course is this?"),
          h("p", { class: "sub" }, 'This page doesn\'t say. Go back, switch the course list to table view and open a course with its "View Details" button.'),
          h("button", { class: "btn solid", onclick: () => history.back() }, "Back to attendance")
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
    const preview = h("div", { class: "preview" });
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
      const p = (a, s) => Calc.percent(a, s).toFixed(0);
      preview.replaceChildren(
        h("div", {}, h("b", {}, "This course "), `${p(cb.attended, cb.scheduled)}% → `, h("b", { class: "good" }, `${p(cn.attended, cn.scheduled)}%`)),
        h("div", {}, h("b", {}, "Overall "), `${p(base.overall.attended, base.overall.scheduled)}% → `, h("b", { class: "good" }, `${p(now.overall.attended, now.overall.scheduled)}%`))
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
          h("button", { class: "btn danger small", onclick: () => { drawActions(false); change(free.map((r) => r.k), "abs", "All hours reset to absent."); } }, "Yes, reset"),
          h("button", { class: "btn small", onclick: () => drawActions(false) }, "Cancel")
        );
      } else {
        actions.replaceChildren(
          h("button", { class: "btn small", onclick: () => change(free.map((r) => r.k), "later", "All hours marked Later.") }, "Mark all later"),
          h("button", { class: "btn danger small", onclick: () => drawActions(true) }, "Reset all")
        );
      }
    }

    const hourEls = rows.map((r) => {
      const left = h("div", {}, h("div", { class: "when" }, `${r.date} · ${r.period}`), h("div", { class: "sub" }, `${r.type} · ${fmt(r.h)} h`));
      if (r.portal !== "abs") {
        const c = CHOICES.find((x) => x.s === r.portal);
        return h("div", { class: "hour" }, h("div", { class: "row" }, left, h("div", { class: "locked", title: "The portal already shows this" }, "🔒", h("span", { class: "chip", style: `color:${c.color}` }, `${c.label} (portal)`))));
      }
      const btns = CHOICES.map((c) =>
        h("button", { class: `${c.cls}`, "data-s": c.s, title: c.tip, "aria-label": `${c.label}: ${r.date} ${r.period}`, onclick: () => { if (sel.get(r.k) !== c.s) change([r.k], c.s, `${r.date} ${r.period} → ${c.label}.`); } }, c.letter)
      );
      segs.set(r.k, btns);
      return h("div", { class: "hour" }, h("div", { class: "row" }, left, h("div", { class: "seg", role: "group", "aria-label": `Mark ${r.date} ${r.period}` }, btns)));
    });

    // Hours you marked that the portal has since updated: confirm they are really present now.
    const gone = saved.filter((r) => r.gone);
    const goneBox = gone.length
      ? h(
          "div",
          { class: "updated" },
          h("b", { style: "color:var(--c-later)" }, "Updated on the portal"),
          h("div", { class: "sub" }, "No longer listed as absent. Confirm they are present now."),
          gone.map((r) => {
            const [date, period] = r.k.split("|");
            return h(
              "div",
              { class: "row", style: "margin-top:6px" },
              h("span", {}, `${date} · ${period} (${fmt(r.h)} h)`),
              h("button", { class: "btn small", onclick: async () => {
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
        h("div", { class: "title" }, ctx.name || ctx.key),
        h("div", { class: "sub" }, `${rows.length} hour(s) listed as absent or leave. Changes save as you click.`),
        h("div", { class: "legend", style: "margin-top:8px" }, CHOICES.map((c) => h("span", { title: c.tip }, h("b", { style: `background:${c.color}` }, c.letter), c.label))),
        hourEls,
        goneBox,
        preview,
        actions,
        toastBox
      )
    );
    paint();
  }

  // ---------------------------------------------------------------- driver
  let timer, lastRoute = null;
  function tick() {
    const r = route();
    if (r !== lastRoute) { dock?.replaceChildren(); attSig = ""; absSig = ""; ttSig = ""; lastRoute = r; } // page changed: clear the old UI
    if (!r) {
      host?.remove();
      host = null;
      return;
    }
    if (r === "att") tickAtt();
    else if (r === "abs") tickAbs();
    else tickTt();
  }
  new MutationObserver((muts) => {
    if (muts.every((mu) => mu.target === host || host?.contains(mu.target))) return; // ignore our own DOM changes
    clearTimeout(timer);
    timer = setTimeout(tick, 600);
  }).observe(document.body, { childList: true, subtree: true });
  tick();
})();
