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

  const PATHS = {
    chev: "M6 3l5 5-5 5",
    close: "M4 4l8 8M12 4l-8 8",
    right: "M3 8h10M9 4l4 4-4 4",
    out: "M5 11l6-6M6 5h5v5",
    lock: "M4.5 7V5.5a3.5 3.5 0 017 0V7M3.5 7h9v6.5h-9z",
  };
  // Inline SVG icon (parsed through a template so it gets the SVG namespace).
  const ico = (name, cls = "ic") => {
    const t = document.createElement("template");
    t.innerHTML = `<svg class="${cls}" viewBox="0 0 16 16" aria-hidden="true"><path d="${PATHS[name]}" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
    return t.content.firstChild;
  };

  const sep = () => h("span", { class: "sep", "aria-hidden": "true" }, "|");
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
      h("b", {}, String(value)),
      h("button", { "aria-label": `Increase ${label || ""}`.trim(), "data-key": key ? `${key}-inc` : null, disabled: value >= max, onclick: () => onchange(Math.min(max, value + 1)) }, "+"));

  const toggle = (on, onchange, label, key) =>
    h("button", { class: `sw${on ? " on" : ""}`, role: "switch", "aria-checked": String(on), "aria-label": label, "data-key": key, onclick: () => onchange(!on) });

  // Accordion row: title + one-line explanation + chevron that turns when open. The caller keeps `open` state.
  const acc = ({ title, sub, open, ontoggle, key }, ...body) =>
    h("div", { class: `acc${open ? " open" : ""}` },
      h("button", { class: "ah", "aria-expanded": String(!!open), "data-key": key, onclick: () => ontoggle(!open) },
        h("span", {}, h("b", {}, title), sub ? h("small", {}, sub) : null), ico("chev")),
      h("div", { class: "ab-wrap", inert: open ? null : "" }, h("div", { class: "ab" }, h("div", { class: "abp" }, body))));

  return { h, plural, fmt, tone, dayLabel, ico, sep, chip, bar, placeThumb, tween, pills, stepper, toggle, acc };
})();
