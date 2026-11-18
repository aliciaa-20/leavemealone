// Daily check against the last snapshot saved by the content script.
// It cannot fetch from the portal itself (login required).
chrome.runtime.onInstalled.addListener(() => {
  chrome.alarms.create("daily-check", { periodInMinutes: 24 * 60, delayInMinutes: 1 });
});

chrome.alarms.onAlarm.addListener((a) => {
  if (a.name !== "daily-check") return;
  importScripts("calc.js");
  chrome.storage.local.get({ threshold: 75, snapshots: {}, latest: null, adjust: {}, excused: {}, alerts: true }, (d) => {
    if (d.alerts === false) return; // turned off in the popup settings
    const snap = d.snapshots[d.latest];
    if (snap) snap.courses = Calc.effective(snap, d.adjust[d.latest], d.excused[d.latest]).courses; // include adjustments
    let title = "Attendance check";
    let message;
    if (!snap) {
      message = "No attendance data yet. Open the CUE attendance page once.";
    } else {
      const low = snap.courses.filter((c) => (c.attended / c.scheduled) * 100 < d.threshold);
      const ageDays = (Date.now() - snap.syncedAt) / 86400000;
      if (low.length) {
        title = `Low attendance in ${low.length} course(s)`;
        message = low.map((c) => `${c.code} ${((c.attended / c.scheduled) * 100).toFixed(0)}%`).join(", ");
      } else if (ageDays > 3) {
        message = `Data is ${Math.floor(ageDays)} days old. Open the CUE attendance page to refresh.`;
      } else return;
    }
    chrome.notifications.create({
      type: "basic",
      iconUrl: "icon.png",
      title,
      message,
    });
  });
});
