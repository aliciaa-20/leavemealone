// The welcome / about page (welcome.html): who makes it, the UPI section (once UI.ABOUT.upi is set) with its QR shown big
// in a dialog, and a report form that opens a pre-filled GitHub issue. The extension sends nothing itself.
const A = UI.ABOUT;
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);
const version = (() => { try { return chrome.runtime.getManifest().version; } catch { return ""; } })();
$$("[data-ver]").forEach((e) => (e.textContent = version ? `v${version}` : ""));
$$("[data-by]").forEach((e) => (e.textContent = A.by));
$$("[data-na]").forEach((e) => (e.textContent = A.notAffiliated));
$$("[data-repo]").forEach((e) => (e.href = A.repo));
$$("[data-contrib]").forEach((e) => (e.href = `${A.repo}/blob/main/CONTRIBUTING.md`));
$$("[data-privacy]").forEach((e) => (e.href = `${A.repo}/blob/main/PRIVACY.md`));
// Links out of the extension open in a new tab, so this page stays.
$$("a[href^='http']").forEach((e) => { e.target = "_blank"; e.rel = "noopener"; });

if (A.upi) {
  $("[data-pay]").hidden = false;
  $$("[data-upi]").forEach((e) => (e.textContent = A.upi));
  const copy = $("[data-copy]");
  copy.addEventListener("click", () => navigator.clipboard.writeText(A.upi).then(() => {
    copy.textContent = "Copied";
    setTimeout(() => (copy.textContent = "Copy"), 1500);
  }));
  // The QR, centre stage: a modal dialog. Esc, Done or a click on the dimmed backdrop closes it.
  const dlg = $("[data-qr]");
  $("[data-qr-open]").addEventListener("click", () => dlg.showModal());
  $("[data-qr-close]").addEventListener("click", () => dlg.close());
  dlg.addEventListener("click", (e) => { // only a click outside the white box (on the backdrop), not on its padding
    const r = dlg.getBoundingClientRect();
    if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) dlg.close();
  });
}
// Arriving from the popup's "Chip in" (#support): open the QR straight away. (No element has that id, so the page doesn't jump.)
if (location.hash === "#support" && A.upi) $("[data-qr]").showModal();

// The demo: a cursor marks a missed day as C (co-curricular), the overall counts up past 75% and the chip flips.
// Invented numbers: 63 of 85 hours, +2 co-curricular = 65 of 85. Loops while the tab is visible; a still end state under reduced motion.
(() => {
  const demo = $("[data-demo]");
  if (!demo) return;
  const num = $("[data-d-num]"), fill = $("[data-d-fill]"), chip = $("[data-d-chip]"), line = $("[data-d-line]");
  const btnA = demo.querySelector(".seg .a"), btnC = $("[data-d-c]"), tags = $$("[data-d-tag]"), cur = $("[data-d-cursor]");
  const FROM = 74.12, TO = 76.47;
  const fmt = (v) => `${v.toFixed(2)}%`;
  const setChip = (cls, text) => { chip.className = `chip ${cls}`; chip.textContent = text; };
  const mark = (on) => {
    btnA.classList.toggle("on", !on); btnC.classList.toggle("on", on);
    tags.forEach((t, i) => setTimeout(() => { t.className = `chip ${on ? "gold" : "mute"}`; t.textContent = on ? "co-curricular" : "absent"; }, on ? i * 120 : 0));
  };
  const end = () => { mark(true); demo.classList.add("up"); num.textContent = fmt(TO); fill.style.width = `${TO}%`; setChip("good", "can bunk 1"); line.textContent = "65 of 85 hours · 2 co-curricular"; };
  if (matchMedia("(prefers-reduced-motion: reduce)").matches) { end(); return; }

  const reset = () => { mark(false); demo.classList.remove("up"); num.textContent = fmt(FROM); fill.style.width = `${FROM}%`; setChip("bad", "attend next 3"); line.textContent = "63 of 85 hours"; };
  const at = (el, dx = 0, dy = 0) => { // the cursor tip over an element, in the demo's own coordinates
    const d = demo.getBoundingClientRect(), r = el.getBoundingClientRect();
    return `translate(${r.left - d.left + r.width / 2 + dx - 5}px, ${r.top - d.top + r.height / 2 + dy - 3}px)`;
  };
  const count = () => {
    const t0 = performance.now(), dur = 900;
    const step = (now) => {
      const k = Math.min(1, (now - t0) / dur), v = FROM + (TO - FROM) * (1 - (1 - k) ** 3);
      num.textContent = fmt(v);
      if (v >= 75 && !demo.classList.contains("up")) { demo.classList.add("up"); setChip("good", "can bunk 1"); }
      if (k < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  };
  const wait = (ms) => new Promise((ok) => setTimeout(ok, ms));
  const run = async () => {
    for (;;) {
      if (document.hidden) { await wait(500); continue; }
      reset();
      cur.style.transition = "none"; cur.style.transform = at(demo.querySelector(".demo-day .hx"), 40, 30); cur.style.opacity = "0";
      await wait(900);
      cur.style.transition = ""; cur.style.opacity = "1"; cur.style.transform = at(btnC);
      await wait(950);
      cur.classList.add("tap"); btnC.classList.add("press");
      await wait(120);
      cur.classList.remove("tap"); btnC.classList.remove("press");
      mark(true);
      await wait(350);
      fill.style.width = `${TO}%`; count();
      line.textContent = "65 of 85 hours · 2 co-curricular";
      await wait(900);
      cur.style.opacity = "0";
      await wait(3200);
    }
  };
  run();
})();

// Report form -> github.com/<repo>/issues/new with the title and body filled in.
const form = $("[data-report]");
form.addEventListener("submit", (e) => {
  e.preventDefault();
  const f = new FormData(form);
  const title = String(f.get("title") || "").trim();
  form.elements.title.setAttribute("aria-invalid", title ? "false" : "true");
  $("[data-err]").hidden = !!title;
  if (!title) { form.elements.title.focus(); return; }
  const ua = navigator.userAgentData?.brands?.filter((b) => !/not.a.brand/i.test(b.brand)).map((b) => `${b.brand} ${b.version}`).join(", ") || navigator.userAgent;
  const body = [
    `**Type:** ${f.get("kind")}`,
    `**Where:** ${f.get("where")}`,
    "",
    String(f.get("details") || "").trim() || "_(no details)_",
    "",
    "---",
    `leavemealone ${version || "?"} · ${ua}`,
  ].join("\n");
  const url = `${A.repo}/issues/new?title=${encodeURIComponent(`[${f.get("kind")}] ${title}`)}&body=${encodeURIComponent(body)}`;
  window.open(url, "_blank", "noopener");
});
