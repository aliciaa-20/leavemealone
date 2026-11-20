// Small DOM helpers shared by the on-page drawer (content.js) and the toolbar popup (popup.js).
// Loaded after plan.js and before content.js / popup.js (both manifest.json and popup.html list it).
const UI = (() => {
  // h("div", {class: "x", onclick: fn}, child, "text", ...)
  const h = (tag, attrs = {}, ...kids) => {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (k.startsWith("on")) el.addEventListener(k.slice(2), v);
      else if (k === "class") el.className = v;
      else if (v !== false && v != null) el.setAttribute(k, v === true ? "" : v);
    }
    el.append(...kids.flat(Infinity).filter((x) => x != null && x !== false));
    return el;
  };

  const plural = (n, word) => `${n} ${n === 1 ? word : word + (word.endsWith("s") ? "es" : "s")}`; // 1 class, 2 classes
  const fmt = (n) => (Number.isInteger(n) ? String(n) : n.toFixed(1));
  const tone = (pct, thr) => (pct < thr ? "bad" : pct < thr + 10 ? "warn" : "good");
  const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const dayLabel = (d) => `${DAYS[d.getDay()]} ${d.getDate()} ${MONTHS[d.getMonth()]}`; // Thu 12 Nov

  // Dates, periods and times the way the design shows them. The portal's formats vary, so fall back to the raw text.
  const niceDate = (raw) => { // "NOV 12 Thursday" -> "Thu 12 Nov"; without the weekday: "12 Nov"
    const m = /^([A-Za-z]{3})[A-Za-z]*\s+(\d{1,2})(?:\s+([A-Za-z]{3}))?/.exec((raw || "").trim());
    if (!m) return raw;
    const cap = (s) => s[0].toUpperCase() + s.slice(1).toLowerCase();
    return `${m[3] ? cap(m[3]) + " " : ""}${+m[2]} ${cap(m[1])}`;
  };
  const nicePeriod = (raw) => (raw || "").replace(/^Period-?\s*/i, "P"); // "Period-5" -> "P5"
  const startTime = (raw) => { // "9:00 – 10:00 AM" -> "9:00", "14:00:00 - 15:00:00" -> "14:00"
    const m = /(\d{1,2}):(\d{2})(?::\d{2})?\s*(?:[–-]\s*(\d{1,2}):(\d{2})(?::\d{2})?\s*(AM|PM)?)?/i.exec(raw || "");
    if (!m) return raw || "";
    let sh = +m[1];
    const ap = (m[5] || "").toUpperCase();
    if (ap && m[3] != null) { // AM/PM is only on the end time: put the start on the same side unless that puts it after the end
      const to24 = (x) => (ap === "PM" ? (x % 12) + 12 : x % 12);
      sh = to24(sh) > to24(+m[3]) ? to24(sh) - 12 : to24(sh);
    }
    return `${sh}:${m[2]}`;
  };

  const PATHS = {
    chev: "M6 3l5 5-5 5",
    close: "M4 4l8 8M12 4l-8 8",
    right: "M3 8h10M9 4l4 4-4 4",
    out: "M5 11l6-6M6 5h5v5",
    lock: "M4.5 7V5.5a3.5 3.5 0 017 0V7M3.5 7h9v6.5h-9z",
    cal: "M3 4.5h10v8.5H3zM3 7.5h10M6 2.5v2.5M10 2.5v2.5",
    list: "M5.5 4h8M5.5 8h8M5.5 12h8M2.5 4h.01M2.5 8h.01M2.5 12h.01",
    userx: "M8 2a6 6 0 100 12A6 6 0 008 2zM5.9 5.9l4.2 4.2M10.1 5.9l-4.2 4.2",
    clock: "M8 2a6 6 0 100 12A6 6 0 008 2zM8 4.8V8l2.2 1.4",
    sliders: "M2.5 5h6M11.5 5h2M2.5 11h2M7.5 11h6M10 3.2v3.6M5.5 9.2v3.6",
    checks: "M3 4.5l1.5 1.5L7 3.5M3 10.5l1.5 1.5L7 9.5M9.5 5h4M9.5 11h4",
    gauge: "M2.5 11a5.5 5.5 0 1111 0M8 11l2.5-3.5",
  };
  // Inline SVG icon (parsed through a template so it gets the SVG namespace).
  const ico = (name, cls = "ic") => {
    const t = document.createElement("template");
    t.innerHTML = `<svg class="${cls}" viewBox="0 0 16 16" aria-hidden="true"><path d="${PATHS[name]}" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
    return t.content.firstChild;
  };

  const sep = () => h("span", { class: "sep", "aria-hidden": "true" }, "|");
  // "attend next N", or a plain "out of reach" when no number of classes can get you back (a 100% minimum after a missed class).
  const mustText = (n) => (Number.isFinite(n) ? `attend next ${n}` : "out of reach");
  const chip = (kind, text, title) => h("span", { class: `chip ${kind}`, title }, text);
  const bar = (pct, thr) =>
    h("div", { class: "bar" },
      h("i", { style: `width:${Math.min(100, Math.max(0, pct))}%;background:var(--${tone(pct, thr)})` }),
      h("u", { style: `left:${thr}%` }));

  // Sliding thumb under a segmented control. Positions are remembered per key, so a control that is rebuilt
  // on every render still slides from where the thumb was instead of jumping.
  const thumbs = new Map();
  const placeThumb = (box, key) => {
    const on = box.querySelector("button.on");
    if (!on || !on.offsetWidth) return;
    let th = box.querySelector(".thumb");
    const fresh = !th;
    if (fresh) { th = h("i", { class: "thumb" }); box.prepend(th); box.classList.add("has-thumb"); }
    const to = { x: on.offsetLeft, w: on.offsetWidth };
    const from = fresh ? thumbs.get(key) || to : null;
    const set = (p) => { th.style.width = `${p.w}px`; th.style.transform = `translateX(${p.x}px)`; };
    thumbs.set(key, to);
    if (fresh) { th.style.transition = "none"; set(from); th.getBoundingClientRect(); th.style.transition = ""; }
    set(to);
  };

  // Count a number towards a new value (320ms), or up from 0 the first time it is shown (700ms).
  // `animate` false (drawer closed) just sets the text and remembers nothing, so the count-up plays on open.
  const lastNum = new Map();
  const tween = (el, key, to, format, { animate = true, countUp = false } = {}) => {
    el.textContent = format(to);
    if (!animate) return;
    const prev = lastNum.get(key);
    lastNum.set(key, to);
    const from = prev ?? (countUp ? 0 : to);
    if (from === to || matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const ms = prev == null ? 700 : 320, t0 = performance.now();
    const step = (t) => {
      const k = Math.min(1, (t - t0) / ms);
      el.textContent = format(from + (to - from) * (1 - Math.pow(1 - k, 3)));
      if (k < 1 && el.isConnected) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  };

  // Segmented control: opts = [[value, label], ...]. Used for tabs ("tab") and "Safe means".
  const pills = (opts, value, onpick, { label, role, keyPrefix } = {}) => {
    const box = h("div", { class: "pills", role: role === "tab" ? "tablist" : "group", "aria-label": label },
      opts.map(([v, text]) =>
        h("button", { class: v === value ? "on" : "", role: role === "tab" ? "tab" : null, "aria-selected": role === "tab" ? String(v === value) : null, "aria-pressed": role === "tab" ? null : String(v === value), "data-key": keyPrefix ? `${keyPrefix}-${v}` : null, onclick: () => v !== value && onpick(v) }, text)));
    requestAnimationFrame(() => placeThumb(box, keyPrefix || label)); // after it is in the page
    return box;
  };

  // Number stepper: - n +
  const stepper = (value, { min = 0, max = 999, onchange, label, key }) =>
    h("span", { class: "stp", role: "group", "aria-label": label },
      h("button", { "aria-label": `Decrease ${label || ""}`.trim(), "data-key": key ? `${key}-dec` : null, disabled: value <= min, onclick: () => onchange(Math.max(min, value - 1)) }, "−"),
      // The number can be typed too: digits only, clamped to min..max on Enter or blur, Escape puts the old value back.
      h("input", { class: "stv", type: "text", inputmode: "numeric", autocomplete: "off", "aria-label": label || "value", "data-key": key ? `${key}-val` : null, value: String(value),
        onfocus: (e) => e.target.select(),
        oninput: (e) => { e.target.value = e.target.value.replace(/\D/g, "").slice(0, 3); },
        onkeydown: (e) => { if (e.key === "Enter") e.target.blur(); else if (e.key === "Escape") { e.target.value = String(value); e.target.blur(); } e.stopPropagation(); },
        onchange: (e) => {
          const n = parseInt(e.target.value, 10);
          if (Number.isNaN(n)) { e.target.value = String(value); return; }
          const v = Math.min(max, Math.max(min, n));
          e.target.value = String(v);
          if (v !== value) onchange(v);
        } }),
      h("button", { "aria-label": `Increase ${label || ""}`.trim(), "data-key": key ? `${key}-inc` : null, disabled: value >= max, onclick: () => onchange(Math.min(max, value + 1)) }, "+"));

  const toggle = (on, onchange, label, key) =>
    h("button", { class: `sw${on ? " on" : ""}`, role: "switch", "aria-checked": String(on), "aria-label": label, "data-key": key, onclick: () => onchange(!on) });

  // Accordion row: title + one-line explanation + chevron that turns when open. The caller keeps `open` state.
  // An icon tile on the left says what the card is at a glance (`icon` is a PATHS name, `tone` a colour name).
  const tile = (icon, tone = "mute") => h("span", { class: `ai t-${tone}` }, ico(icon));
  const acc = ({ title, sub, open, ontoggle, key, icon, tone }, ...body) =>
    h("div", { class: `acc${open ? " open" : ""}` },
      h("button", { class: "ah", "aria-expanded": String(!!open), "data-key": key, onclick: () => ontoggle(!open) },
        h("span", { class: "ahl" }, icon ? tile(icon, tone) : null, h("span", {}, h("b", {}, title), sub ? h("small", {}, sub) : null)), ico("chev", "ic chev")),
      h("div", { class: "ab-wrap", inert: open ? null : "" }, h("div", { class: "ab" }, h("div", { class: "abp" }, body))));

  // Absent hours from the all-courses list (rows saved by content.js), shown day by day with the kind of absence.
  const KIND = { abs: ["bad", "absent"], cc: ["gold", "co-curricular"], med: ["blue", "medical"] };
  const hrsOf = (rows, k) => rows.filter((r) => r.kind === k).reduce((n, r) => n + r.h, 0);
  const absentSummary = (rows) => [`${fmt(hrsOf(rows, "abs"))}h absent`, hrsOf(rows, "cc") ? [sep(), `${fmt(hrsOf(rows, "cc"))}h co-curricular`] : null, hrsOf(rows, "med") ? [sep(), `${fmt(hrsOf(rows, "med"))}h medical`] : null];
  const absentDays = (rows) => {
    const groups = [];
    for (const r of rows) { // the portal lists them newest first, so a day's rows are next to each other
      let g = groups[groups.length - 1];
      if (!g || g.date !== r.date) groups.push((g = { date: r.date, label: niceDate(`${r.date} ${r.day}`), rows: [] }));
      g.rows.push(r);
    }
    return groups.map((g) => [
      h("div", { class: "pday" }, h("b", {}, g.label), h("span", { class: "sub" }, `${fmt(g.rows.reduce((n, r) => n + r.h, 0))}h`)),
      g.rows.map((r) => h("div", { class: "arow" }, h("span", {}, nicePeriod(r.period)), h("span", { class: "pt" }, startTime(r.time)), h("span", { class: "ac", title: r.name }, h("b", {}, r.code), r.name ? h("small", {}, r.name) : null), chip(KIND[r.kind][0], KIND[r.kind][1]))),
    ]);
  };

  // A cursor-following glow on cards (.blk, .acc, .cardcal, the popup tiles): a soft spotlight where the pointer is.
  const spotlight = (root) => root.addEventListener("pointermove", (e) => {
    const card = e.target.closest?.(".blk, .acc, .cardcal, .exam > div");
    if (!card) return;
    const r = card.getBoundingClientRect();
    card.style.setProperty("--mx", `${e.clientX - r.left}px`);
    card.style.setProperty("--my", `${e.clientY - r.top}px`);
  });

  return { h, tile, spotlight, absentSummary, absentDays, hrsOf, plural, fmt, tone, dayLabel, niceDate, nicePeriod, startTime, ico, sep, chip, bar, mustText, placeThumb, tween, pills, stepper, toggle, acc };
})();
