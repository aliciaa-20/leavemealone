// CUE attendance helper. Runs on the whole portal host (it is a single-page app, so
// pages change without a reload) and acts by route:
//   /main/attendence    -> parse the course table, save a snapshot, show a pill + drawer,
//                          remember which course's "View Details" you click
//   /main/AbsentDetails -> mark each absent hour as absent / co-curricular / medical / later
// All UI lives in one Shadow DOM host so the portal's CSS and ours never touch.
(() => {
  const store = {
    get: (d) => chrome.storage.local.get(d),
    set: (o) => chrome.storage.local.set(o),
  };
  const route = () => {
    const p = location.pathname.toLowerCase();
    return p.includes("/main/attendence") ? "att" : p.includes("/main/absentdetails") ? "abs" : null;
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
  let attOpen = false;
  let attSig = "";
  let attArgs = null;

  function setOpen(v) {
    attOpen = v;
    store.set({ panelOpen: v });
    if (attArgs) { attArgs[4] = v; renderAtt(...attArgs); }
  }
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && attOpen) setOpen(false); });
  document.addEventListener("click", (e) => {
    if (attOpen && host && !e.composedPath().includes(host)) setOpen(false);
  });

  async function renderAtt(snap, threshold, adj, exc, open) {
    attArgs = [snap, threshold, adj, exc, open];
    attOpen = open;
    const eff = Calc.effective(snap, adj, exc);
    const sig = JSON.stringify([eff, threshold, open, snap.semester]);
    if (sig === attSig && host?.isConnected) return;
    await ensureHost();
    attSig = sig;
    const o = eff.overall, t = threshold / 100;
    const op = Calc.percent(o.attended, o.scheduled);
    const courses = eff.courses.filter((c) => c.scheduled > 0); // portal order, on purpose
    const lowN = courses.filter((c) => Calc.percent(c.attended, c.scheduled) < threshold).length;

    const pill = h(
      "button",
      { class: `pill ${tone(op, threshold)}`, "aria-expanded": String(open), "aria-label": "Attendance summary", onclick: () => setOpen(!attOpen) },
      h("span", { class: "dot" }),
      `${op.toFixed(1)}%`,
      lowN ? h("span", { class: "sub" }, `${lowN} low`) : null
    );

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
            h(
              "div",
              { class: "note" },
              h("b", {}, c.code || c.name),
              c.goneHrs ? ` · ${fmt(c.goneHrs)} h updated on the portal: open View Details and press Confirm present` : " · the portal's numbers changed since you adjusted this; check it"
            )
          )
        )
      : null;

    const list = courses.map((c) => {
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
        h(
          "div",
          { class: "row" },
          h("div", { class: "name" }, h("span", { class: "code" }, c.code || c.name), adjusted ? h("span", { class: "badge" }, "adj") : null, c.code ? h("div", { class: "full" }, c.name) : null),
          h("div", { style: "text-align:right" }, h("span", { class: `pct ${tone(pct, threshold)}` }, `${pct.toFixed(0)}%`), " ", chip)
        ),
        bar(pct, threshold)
      );
    });

    const drawer = h(
      "div",
      { class: `drawer${open ? " open" : ""}`, role: "dialog", "aria-label": "Attendance details" },
      h(
        "div",
        { class: "dh" },
        h("div", {}, h("div", { class: "title" }, "Attendance"), h("div", { class: "sub" }, `${snap.semester} · minimum ${threshold}%`)),
        h("button", { class: "x", "aria-label": "Close", onclick: () => setOpen(false) }, "✕")
      ),
      h(
        "div",
        { class: "card" },
        h("div", { class: "row" }, h("span", { class: `big ${tone(op, threshold)}` }, `${op.toFixed(1)}%`), h("span", { class: "sub" }, `${fmt(o.attended)} / ${o.scheduled} hrs`)),
        bar(op, threshold),
        notes
      ),
      reviewBox,
      h("div", { class: "card" }, list),
      h("div", { class: "sub" }, "Same order as the portal's table.")
    );
    dock.replaceChildren(drawer, pill, h("div", { class: "tag" }, "vibe-coded ui"));
  }

  async function tickAtt() {
    const snap = parseCourses();
    if (!snap) return;
    const d = await store.get({ threshold: 75, snapshots: {}, adjust: {}, excused: {}, panelOpen: false });
    d.snapshots[snap.semester] = snap;
    const ROMAN = { I: 1, II: 2, III: 3, IV: 4, V: 5, VI: 6, VII: 7, VIII: 8 };
    const rank = (n) => ROMAN[/\b(VIII|VII|VI|V|IV|III|II|I)\s*$/.exec(n.toUpperCase())?.[1]] || 0;
    const latest = Object.keys(d.snapshots).sort((a, b) => rank(b) - rank(a))[0];
    await store.set({ snapshots: d.snapshots, latest });
    renderAtt(snap, d.threshold, d.adjust[snap.semester], d.excused[snap.semester], d.panelOpen);
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
    if (r !== lastRoute) { dock?.replaceChildren(); attSig = ""; absSig = ""; lastRoute = r; } // page changed: clear the old UI
    if (r !== "att" && r !== "abs") {
      host?.remove();
      host = null;
      return;
    }
    if (r === "att") { absSig = ""; tickAtt(); }
    else { attSig = ""; tickAbs(); }
  }
  new MutationObserver((muts) => {
    if (muts.every((mu) => mu.target === host || host?.contains(mu.target))) return; // ignore our own DOM changes
    clearTimeout(timer);
    timer = setTimeout(tick, 600);
  }).observe(document.body, { childList: true, subtree: true });
  tick();
})();
