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

  // basis "now": % right after the bunk.  basis "end": % on the last instruction day if you attend everything else.
  function project(a, s, k, R, basis) {
    return basis === "end"
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
  function bestDays({ eff, tt, courses, basis, t, from, horizon = 14, limit = 5 }) {
    const end = K.semesterEnd(from);
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

  return { classesOn, missedFor, remainingHours, impact, bestDays, breakLength };
})();

if (typeof module !== "undefined") module.exports = Plan;
