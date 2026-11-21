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
