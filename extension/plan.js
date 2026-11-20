// Bunk planning: pure functions shared by the on-page drawer and the popup.
// timetable = { "1": [{ period: "Period-1", time, name, type }], ... "6": [...] } (keys = Date.getDay())
// selection = Map(dayKey "YYYY-MM-DD" -> Set of periods, or null for the whole day)
const Plan = (() => {
  const C = typeof Calc !== "undefined" ? Calc : require("./calc.js");
  const K = typeof Cal !== "undefined" ? Cal : require("./calendar.js");
  const norm = (s) => (s || "").trim().toUpperCase();

  const keyMap = (courses) => Object.fromEntries(courses.map((c) => [norm(c.name), c.code || c.name]));

  function classesOn(date, tt) {
    if (!tt || !K.dayInfo(date).classDay) return [];
    return tt[String(date.getDay())] || [];
  }

  // Hours missed per course key for a selection.
  function missedFor(selection, tt, courses) {
    const km = keyMap(courses);
    const missed = {};
    const unknown = new Set();
    for (const [k, periods] of selection) {
      for (const c of classesOn(K.parse(k), tt)) {
        if (periods && !periods.has(c.period)) continue;
        const key = km[norm(c.name)];
        if (!key) { unknown.add(c.name); continue; }
        missed[key] = (missed[key] || 0) + 1;
      }
    }
    return { missed, unknown: [...unknown] };
  }

  // Classes still to come per course key, from `from` to `to` inclusive.
  function remainingHours(tt, courses, from, to) {
    const km = keyMap(courses);
    const out = {};
    if (!to) return out;
    for (let d = from; d <= to; d = K.addDays(d, 1)) {
      for (const c of classesOn(d, tt)) {
        const key = km[norm(c.name)];
        if (key) out[key] = (out[key] || 0) + 1;
      }
    }
    return out;
  }

  // basis "now": % right after the bunk.  basis "mse" / "end": % on the cutoff day (last class day
  // before MSE / last instruction day) if you attend everything else.
  function project(a, s, k, R, basis) {
    return basis !== "now"
      ? { before: C.percent(a + R, s + R), after: C.percent(a + R - k, s + R) }
      : { before: C.percent(a, s), after: C.percent(a, s + k) };
  }

  function impact(eff, missed, basis, remaining, t) {
    const thr = t * 100;
    const rows = eff.courses
      .filter((c) => missed[c.key])
      .map((c) => {
        const k = missed[c.key], R = remaining[c.key] || 0;
        const p = project(c.attended, c.scheduled, k, R, basis);
        const safe = p.after >= thr;
        // How many classes to attend afterwards to get back to the minimum (right-now view).
        const recover = safe ? 0 : C.mustAttend(c.attended, c.scheduled + k, t);
        return { key: c.key, name: c.name, code: c.code, k, R, ...p, safe, recover };
      });
    const o = eff.overall;
    const kAll = Object.values(missed).reduce((n, x) => n + x, 0);
    const RAll = Object.values(remaining).reduce((n, x) => n + x, 0);
    const op = project(o.attended, o.scheduled, kAll, RAll, basis);
    return { rows, overall: { k: kAll, ...op, safe: op.after >= thr }, safe: rows.every((r) => r.safe) && op.after >= thr };
  }

  const MSE_MIN = 0.75; // attendance needed to write MSE

  // The percentage line (fraction) that "safe" is measured against for a basis.
  // t = the user's minimum (fraction), esePct = their ESE target (percent).
  function thresholdFor(basis, t, esePct) {
    return basis === "mse" ? MSE_MIN : basis === "end" ? esePct / 100 : t;
  }

  // Last day that counts for a basis (null if unknown). "now" looks as far as semester end.
  function horizonDate(basis, from) {
    return K.cutoff(basis === "mse" ? "mse" : "ese", from);
  }

  // A saved "mse" basis only holds while MSE is still ahead and has class days left.
  function resolveBasis(basis, from) {
    if (basis === "end") return "end";
    return basis === "mse" && K.cutoff("mse", from) ? "mse" : "now";
  }

  // Drop selected days that fall after the cutoff.
  function clipSelection(selection, cutoff) {
    if (!cutoff) return selection;
    const last = K.key(cutoff);
    return new Map([...selection].filter(([k]) => k <= last));
  }

  // Classes each course can still miss before the basis' cutoff and stay on the line t (a fraction).
  // Null for "now", without a timetable, or when the cutoff is unknown.
  function budgets({ eff, tt, basis, t, from }) {
    if (basis === "now" || !tt) return null;
    const end = horizonDate(basis, from);
    if (!end) return null;
    const remaining = remainingHours(tt, eff.courses, from, end);
    // Courses are matched to the timetable by name; one that never matches has no known classes left,
    // so its best case would just be today's % (a false "out of reach"). Flag it instead.
    const km = keyMap(eff.courses), inTimetable = new Set();
    for (const day of Object.values(tt)) for (const c of day) if (km[norm(c.name)]) inTimetable.add(km[norm(c.name)]);
    const row = (key, name, code, a, s, R, matched = true) => {
      const bestCase = C.bestCase(a, s, R);
      return { key, name, code, pct: C.percent(a, s), R, budget: C.budget(a, s, R, t), bestCase, reachable: bestCase >= t * 100 - 1e-9, matched };
    };
    const rows = eff.courses.filter((c) => c.scheduled > 0).map((c) => row(c.key, c.name, c.code, c.attended, c.scheduled, remaining[c.key] || 0, inTimetable.has(c.key)));
    const RAll = Object.values(remaining).reduce((n, x) => n + x, 0);
    const o = eff.overall;
    return { end, rows, overall: row("overall", "Overall", "", o.attended, o.scheduled, RAll) };
  }

  // Courses heading below the MSE line: "out" = can't reach 75% even attending everything,
  // "zero" = exactly on it with MSE within `days` days.
  function mseRisks({ eff, tt, from, days = 7 }) {
    const b = budgets({ eff, tt, basis: "mse", t: MSE_MIN, from });
    if (!b) return [];
    const left = Math.round((b.end - from) / 86400000);
    const out = [];
    for (const r of b.rows) {
      if (!r.matched) continue;
      const state = !r.reachable ? "out" : r.budget === 0 && left <= days ? "zero" : null;
      if (state) out.push({ key: r.key, code: r.code, name: r.name, state, bestCase: r.bestCase, budget: r.budget, R: r.R });
    }
    return out;
  }

  // Consecutive days off around d if you skip d (counts d itself).
  function breakLength(d) {
    let n = 1, names = [];
    for (let x = K.addDays(d, -1), i = 0; i < 10; x = K.addDays(x, -1), i++) {
      const info = K.dayInfo(x);
      if (info.classDay) break;
      n++;
      if (info.holiday) names.push(info.reason);
    }
    for (let x = K.addDays(d, 1), i = 0; i < 10; x = K.addDays(x, 1), i++) {
      const info = K.dayInfo(x);
      if (info.classDay) break;
      n++;
      if (info.holiday) names.push(info.reason);
    }
    return { n, names: [...new Set(names)] };
  }

  // Next class days ranked for bunking: safe first, then longest break created, then fewest classes.
  // t = the line for this basis (see thresholdFor).
  function bestDays({ eff, tt, courses, basis, t, from, horizon = 14, limit = 5 }) {
    const end = horizonDate(basis, from);
    if (basis === "mse" && !end) return { days: [], remaining: {}, end: null };
    const remaining = remainingHours(tt, courses, from, end);
    const out = [];
    for (let d = from, seen = 0; seen < horizon && (!end || d <= end); d = K.addDays(d, 1)) {
      const cls = classesOn(d, tt);
      if (!cls.length) continue;
      seen++;
      const { missed } = missedFor(new Map([[K.key(d), null]]), tt, courses);
      const imp = impact(eff, missed, basis, remaining, t);
      const lowest = imp.rows.reduce((m, r) => Math.min(m, r.after), Infinity);
      const br = breakLength(d);
      const tags = [];
      if (cls.length <= 2) tags.push(`Only ${cls.length} class${cls.length > 1 ? "es" : ""}`);
      if (br.n >= 3) tags.push(`${br.n}-day break${br.names.length ? ` (${br.names.join(", ")})` : ""}`);
      out.push({ date: d, key: K.key(d), classes: cls.length, safe: imp.safe, lowest: Number.isFinite(lowest) ? lowest : null, breakDays: br.n, tags, impact: imp });
    }
    out.sort((a, b) => (b.safe - a.safe) || (b.breakDays - a.breakDays) || (a.classes - b.classes) || ((b.lowest ?? 0) - (a.lowest ?? 0)));
    return { days: out.slice(0, limit), remaining, end };
  }

  // Tick a period as attended (or untick it = skipped) on a picked day. `cur` is the day's skipped set
  // (null = the whole day is skipped), `periods` the day's period ids. Returns the new skipped set,
  // null when everything is skipped, or undefined when nothing is skipped any more (drop the day).
  function setAttend(periods, cur, period, attending) {
    const skipped = new Set(cur || periods);
    if (attending) skipped.delete(period); else skipped.add(period);
    return !skipped.size ? undefined : skipped.size === periods.length ? null : skipped;
  }

  return { MSE_MIN, classesOn, missedFor, setAttend, remainingHours, impact, bestDays, breakLength, thresholdFor, horizon: horizonDate, resolveBasis, clipSelection, budgets, mseRisks };
})();

if (typeof module !== "undefined") module.exports = Plan;
