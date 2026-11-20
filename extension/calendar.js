// Academic calendar data + "is there class on this day?".
// Source: CHRIST (Deemed to be University) Academic Calendar 2026-27 (public PDF).
// Contributors: add a new block for each academic year and extend `YEARS`.
const Cal = (() => {
  const YEARS = [
    {
      name: "2026-27",
      from: "2026-06-01",
      to: "2027-05-31",
      semesters: [
        { name: "Odd", start: "2026-06-01", end: "2026-09-26", mse: { from: "2026-08-03", to: "2026-08-08" } }, // end = last instruction day
        { name: "Even", start: "2026-10-27", end: "2027-03-05", mse: { from: "2027-01-04", to: "2027-01-09" } },
      ],
      holidays: {
        "2026-06-26": "Muharram",
        "2026-08-15": "Independence Day",
        "2026-08-26": "Eid-Milad",
        "2026-09-14": "Ganesh Chaturthi",
        "2026-10-02": "Gandhi Jayanthi",
        "2026-10-10": "Mahalaya Amavasye",
        "2026-10-20": "Mahanavami / Ayudhapooja",
        "2026-10-21": "Vijayadasami",
        "2026-10-26": "Maharshi Valmiki Jayanthi",
        "2026-11-01": "Kannada Rajyothsava",
        "2026-11-08": "Naraka Chaturdashi",
        "2026-11-10": "Balipadyami, Deepavali",
        "2026-11-27": "Kanakadasa Jayanthi",
        "2026-11-28": "Holiday (compensatory for 21 Nov)",
        "2027-01-14": "Makara Sankranti",
        "2027-01-26": "Republic Day",
        "2027-03-06": "Maha Shivaratri",
        "2027-03-10": "Idul Fitr",
        "2027-03-26": "Good Friday",
        "2027-04-08": "Ugadi",
        "2027-04-14": "Dr Ambedkar Jayanthi",
        "2027-04-19": "Mahavir Jayanthi",
        "2027-05-01": "May Day",
        "2027-05-09": "Basava Jayanthi",
        "2027-05-17": "Bakrid",
      },
      // Days inside a semester with no regular classes.
      noClass: [
        { from: "2026-08-03", to: "2026-08-08", name: "Mid-semester exams" },
        { from: "2026-12-23", to: "2027-01-03", name: "Christmas vacation" },
        { from: "2027-01-04", to: "2027-01-09", name: "Mid-semester exams" },
      ],
      // Third Saturdays are normally off; these ones are declared working days.
      workingSaturdays: ["2026-10-17", "2026-11-21", "2026-12-19"],
    },
  ];

  const pad = (n) => String(n).padStart(2, "0");
  const key = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const parse = (k) => {
    const [y, m, dd] = k.split("-").map(Number);
    return new Date(y, m - 1, dd);
  };
  const addDays = (d, n) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
  const yearOf = (k) => YEARS.find((y) => k >= y.from && k <= y.to) || null;

  // { classDay, reason, holiday } for a Date.
  function dayInfo(d) {
    const k = key(d);
    const y = yearOf(k);
    if (y) {
      if (!y.semesters.some((s) => k >= s.start && k <= s.end)) return { classDay: false, reason: "No classes (between semesters)", holiday: true };
      if (y.holidays[k]) return { classDay: false, reason: y.holidays[k], holiday: true };
      const r = y.noClass.find((x) => k >= x.from && k <= x.to);
      if (r) return { classDay: false, reason: r.name, holiday: true };
    }
    const dow = d.getDay();
    if (dow === 0) return { classDay: false, reason: "Sunday" };
    const third = dow === 6 && d.getDate() >= 15 && d.getDate() <= 21;
    if (third && !(y && y.workingSaturdays.includes(k))) return { classDay: false, reason: "Third Saturday off" };
    return { classDay: true, reason: "" };
  }

  // Last instruction day of the semester containing d (or the next one), or null if unknown.
  function semesterEnd(d) {
    const k = key(d);
    for (const y of YEARS) for (const s of y.semesters) if (k <= s.end) return parse(s.end);
    return null;
  }

  // The semester containing d, or the next one that hasn't ended yet.
  const semesterOf = (d) => {
    const k = key(d);
    for (const y of YEARS) for (const s of y.semesters) if (k <= s.end) return s;
    return null;
  };

  // Mid-semester exam window { from, to } for that semester, or null if unknown or already over.
  function mseWindow(d) {
    const s = semesterOf(d);
    if (!s || !s.mse || key(d) > s.mse.to) return null;
    return { from: parse(s.mse.from), to: parse(s.mse.to) };
  }

  // Last day attendance counts for an exam: "mse" = last class day before the MSE window,
  // "ese" = last instruction day. Null if unknown, if the window has started, or if no class day is left.
  function cutoff(kind, d) {
    if (kind === "ese") return semesterEnd(d);
    const w = mseWindow(d);
    if (!w || key(d) >= key(w.from)) return null;
    for (let x = addDays(w.from, -1), i = 0; i < 30; x = addDays(x, -1), i++) {
      if (key(x) < key(d)) return null;
      if (dayInfo(x).classDay) return x;
    }
    return null;
  }

  return { key, parse, addDays, dayInfo, semesterEnd, mseWindow, cutoff, known: (d) => !!yearOf(key(d)) };
})();

if (typeof module !== "undefined") module.exports = Cal;
