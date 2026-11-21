// The welcome / about page (welcome.html). Fills in who makes it, the repo links and, once UI.ABOUT.upi is set, the UPI section.
const A = UI.ABOUT;
const $$ = (sel) => document.querySelectorAll(sel);
$$("[data-by]").forEach((e) => (e.textContent = A.by));
$$("[data-na]").forEach((e) => (e.textContent = A.notAffiliated));
$$("[data-repo]").forEach((e) => (e.href = A.repo));
$$("[data-issues]").forEach((e) => (e.href = `${A.repo}/issues`));
// Links leave the extension page in a new tab, so the welcome page stays open.
$$("a[href^='http']").forEach((e) => { e.target = "_blank"; e.rel = "noopener"; });

if (A.upi) {
  document.querySelector("[data-pay]").hidden = false;
  document.querySelector("[data-upi]").textContent = A.upi;
  const copy = document.querySelector("[data-copy]");
  copy.addEventListener("click", () => navigator.clipboard.writeText(A.upi).then(() => {
    copy.textContent = "Copied";
    setTimeout(() => (copy.textContent = "Copy"), 1500);
  }));
}
