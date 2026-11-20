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
        { name: "Even", start: "2026-10-27", end: "2027-03-05", mse: { from: "2027-01-04", to: "2027-01-09" }, ese: { from: "2027-03-13", to: "2027-03-24" } }, // ESE exams 13-24 Mar; the ESE planner stays open until ese.to
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
        "2026-11-28": "Compensatory holiday for 21 Nov",
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
  const day0 = (d = new Date()) => addDays(d, 0); // midnight at the start of d (today by default)
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

  // The semester containing d, or the next one that hasn't ended yet.
  const semesterOf = (d) => {
    const k = key(d);
    for (const y of YEARS) for (const s of y.semesters) if (k <= s.end) return s;
    return null;
  };
  // Last instruction day of that semester, or null if unknown.
  const semesterEnd = (d) => { const s = semesterOf(d); return s ? parse(s.end) : null; };

  // The last class day before `date` (looking back up to 30 days), or null. With `notBefore`, null if it falls before that.
  function lastClassBefore(date, notBefore) {
    for (let x = addDays(date, -1), i = 0; i < 30; x = addDays(x, -1), i++) {
      if (notBefore && key(x) < key(notBefore)) return null;
      if (dayInfo(x).classDay) return x;
    }
    return null;
  }

  // Mid-semester exam window { from, to } for that semester, or null if unknown or already over.
  function mseWindow(d) {
    const s = semesterOf(d);
    if (!s || !s.mse || key(d) > s.mse.to) return null;
    return { from: parse(s.mse.from), to: parse(s.mse.to) };
  }

  // The ESE exam window of the semester that holds d (null if the calendar has none, or it is over).
  function eseWindow(d) {
    const k = key(d); // the exams fall after the last class day, outside semesterOf(), so look at every semester
    for (const y of YEARS) for (const s of y.semesters) if (s.ese && s.ese.from && k >= s.start && k <= s.ese.to) return { from: parse(s.ese.from), to: parse(s.ese.to) };
    return null;
  }

  // Last day attendance counts for an exam: "mse" = last class day before the MSE window,
  // "ese" = last instruction day. Null if unknown, if the window has started, or if no class day is left.
  function cutoff(kind, d) {
    if (kind === "ese") return semesterEnd(d);
    const w = mseWindow(d);
    if (!w || key(d) >= key(w.from)) return null;
    return lastClassBefore(w.from, d);
  }

  // Named holidays from `from` to `to` (inclusive), oldest first: [{ date, name }].
  function holidays(from, to) {
    const a = key(from), b = key(to), out = [];
    for (const y of YEARS) for (const [k, name] of Object.entries(y.holidays)) if (k >= a && k <= b) out.push({ date: parse(k), name });
    return out.sort((x, y) => x.date - y.date);
  }

  // Like cutoff(), but it still answers after the cutoff has passed, until the exam window is over, so the planner can
  // keep showing the numbers that counted. mse: the last class day before the MSE window, through the window's last day.
  // ese: the last instruction day, through the semester's optional `ese.to` (else it ends with the instruction days).
  function cutoffRef(kind, d) {
    const k = key(d);
    if (kind === "ese") {
      for (const y of YEARS) for (const s of y.semesters) if (k <= (s.ese ? s.ese.to : s.end)) return parse(s.end);
      return null;
    }
    const s = semesterOf(d);
    if (!s || !s.mse || k > s.mse.to) return null;
    return lastClassBefore(parse(s.mse.from));
  }

  return { key, parse, addDays, day0, dayInfo, semesterEnd, mseWindow, eseWindow, cutoff, cutoffRef, holidays, known: (d) => !!yearOf(key(d)) };
})();

if (typeof module !== "undefined") module.exports = Cal;
