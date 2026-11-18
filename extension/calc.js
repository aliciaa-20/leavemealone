// Pure attendance maths. t is a fraction (0.75), a = attended, s = scheduled/conducted.
const Calc = {
  percent(a, s) {
    return s > 0 ? (a / s) * 100 : 0;
  },
  // Classes you can still miss and stay at or above t.
  canSkip(a, s, t) {
    return Math.max(0, Math.floor(a / t - s + 1e-9));
  },
  // Consecutive classes you must attend to get back to t (0 if already there).
  mustAttend(a, s, t) {
    if (a / s >= t || s === 0) return 0;
    return Math.ceil((t * s - a) / (1 - t) - 1e-9);
  },
  // Percentage after skipping n more classes.
  afterSkipping(a, s, n) {
    return Calc.percent(a, s + n);
  },
  medicalText(o) {
    if (o.medicalState === "applies") {
      const before = Calc.percent(o.withoutMedical, o.scheduled).toFixed(1);
      return `added, since the aggregate (${before}%) is below 85% → ${Calc.percent(o.attended, o.scheduled).toFixed(1)}%`;
    }
    if (o.medicalState === "not-needed") return "not added, aggregate is already 85% or more";
    return "not added, aggregate is below 74.5% so medical leave isn't considered";
  },
  // Portal snapshot + your own adjustments for that semester:
  // adj = { cocurricular: hrs, courses: { [code]: { att, sch, baseSch } } }
  // att/sch are hours not yet on the portal. baseSch is the portal's scheduled
  // count when you entered them; if the portal's count has since changed the
  // adjustment is flagged stale (the portal may now include those hours).
  // exc = { [courseKey]: { rows: [{k, h}], baseAbsent } }: absent hours you ticked as
  // actually present on the Absent Details page. They are already in "scheduled", so they
  // only add to attended, never more than the portal's own absent hours for that course.
  effective(snap, adj, exc) {
    const m = (adj && adj.courses) || {};
    const courses = snap.courses.map((c) => {
      const key = c.code || c.name;
      const x = m[key] || { att: 0, sch: 0 };
      const has = x.att || x.sch;
      const e = exc && exc[key];
      // Per absent hour you chose: s = "later" (portal will update it to present), "cc"
      // (co-curricular claim) or "med" (medical). Unmarked hours stay absent. Rows saved
      // before this choice existed have no s and count as "later".
      const sums = { later: 0, cc: 0, med: 0 };
      // r.p = the portal itself labelled the hour (e.g. "Medical Leave"). r.gone = the portal
      // stopped listing it as absent (it was updated); it is already in the portal's numbers,
      // so it is not counted here and just waits for you to "Confirm present".
      let goneHrs = 0;
      if (e) for (const r of e.rows) {
        if (r.gone) { goneHrs += r.h; continue; }
        sums[r.s === "cc" || r.s === "med" ? r.s : "later"] += r.h;
      }
      // Once the portal shows a Co-curricular column (semester end) its attended already
      // includes co-curricular hours, so ours must not be added again.
      if (snap.hasCc) sums.cc = 0;
      const total = sums.later + sums.cc + sums.med;
      const f = c.absent != null && total > c.absent ? c.absent / total : 1; // never more than the portal's absent hrs
      const later = sums.later * f, cc = sums.cc * f, med = sums.med * f;
      const excusedHrs = later + cc + med;
      const absentMoved = !!e && c.absent != null && e.baseAbsent !== undefined && e.baseAbsent !== c.absent;
      return {
        ...c,
        key,
        adj: x,
        excusedHrs, goneHrs, laterHrs: later, ccHrs: cc, medHrs: med,
        portalAttended: c.attended,
        portalScheduled: c.scheduled,
        attended: c.attended + (x.att || 0) + later,
        scheduled: c.scheduled + (x.sch || 0),
        stale: (!!has && x.baseSch !== undefined && x.baseSch !== c.scheduled) || absentMoved,
      };
    });
    // Co-curricular claims (typed or marked on Absent Details) add to the overall aggregate only.
    const sum = (k) => courses.reduce((n, c) => n + c[k], 0);
    const cc = (snap.hasCc ? 0 : (adj && adj.cocurricular) || 0) + sum("ccHrs");
    const withCc = sum("attended") + cc, scheduled = sum("scheduled");
    // Medical leave (policy text): only considered when the aggregate with co-curricular is
    // at least 74.5%, and only applied when it is below 85%. In that band the hours are
    // added to the overall attended; otherwise they are just reported.
    const medical = sum("medHrs");
    const pct = Calc.percent(withCc, scheduled);
    const medicalState = !medical ? "none" : pct < 74.5 ? "below" : pct < 85 ? "applies" : "not-needed";
    const medicalAdded = medicalState === "applies" ? medical : 0;
    return {
      courses,
      overall: {
        attended: withCc + medicalAdded, scheduled, cocurricular: cc,
        medical, medicalAdded, medicalState, medicalApplies: medicalState === "applies",
        withoutMedical: withCc, ccIncluded: !!snap.hasCc, goneHrs: sum("goneHrs"),
      },
    };
  },
};

if (typeof module !== "undefined") module.exports = Calc;
