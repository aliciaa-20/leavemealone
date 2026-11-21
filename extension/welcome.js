// The welcome / about page (welcome.html): who makes it, the UPI section (once UI.ABOUT.upi is set), and a report form
// that opens a pre-filled GitHub issue. The extension sends nothing itself: the person submits the issue on GitHub.
const A = UI.ABOUT;
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);
$$("[data-by]").forEach((e) => (e.textContent = A.by));
$$("[data-na]").forEach((e) => (e.textContent = A.notAffiliated));
$$("[data-repo]").forEach((e) => (e.href = A.repo));
$$("[data-contrib]").forEach((e) => (e.href = `${A.repo}/blob/main/CONTRIBUTING.md`));
$$("[data-privacy]").forEach((e) => (e.href = `${A.repo}/blob/main/PRIVACY.md`));
// Links out of the extension open in a new tab, so this page stays.
$$("a[href^='http']").forEach((e) => { e.target = "_blank"; e.rel = "noopener"; });

if (A.upi) {
  $("[data-pay]").hidden = false;
  $("[data-upi]").textContent = A.upi;
  const copy = $("[data-copy]");
  copy.addEventListener("click", () => navigator.clipboard.writeText(A.upi).then(() => {
    copy.textContent = "Copied";
    setTimeout(() => (copy.textContent = "Copy UPI ID"), 1500);
  }));
}

// Report form -> github.com/<repo>/issues/new with the title and body filled in.
const form = $("[data-report]");
form.addEventListener("submit", (e) => {
  e.preventDefault();
  const f = new FormData(form);
  const title = String(f.get("title") || "").trim();
  const err = $("[data-err]");
  form.elements.title.setAttribute("aria-invalid", title ? "false" : "true");
  err.hidden = !!title;
  if (!title) { form.elements.title.focus(); return; }
  const ver = (() => { try { return chrome.runtime.getManifest().version; } catch { return "?"; } })();
  const ua = navigator.userAgentData?.brands?.filter((b) => !/not.a.brand/i.test(b.brand)).map((b) => `${b.brand} ${b.version}`).join(", ") || navigator.userAgent;
  const body = [
    `**Type:** ${f.get("kind")}`,
    `**Where:** ${f.get("where")}`,
    "",
    String(f.get("details") || "").trim() || "_(no details)_",
    "",
    "---",
    `leavemealone ${ver} · ${ua}`,
  ].join("\n");
  const url = `${A.repo}/issues/new?title=${encodeURIComponent(`[${f.get("kind")}] ${title}`)}&body=${encodeURIComponent(body)}`;
  window.open(url, "_blank", "noopener");
});
