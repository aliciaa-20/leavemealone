// Profiles: more than one student using the same browser. The portal's header shows who is logged in (name, then the
// class code such as "6BTIT"), and each person's data is kept apart. The active person's data stays at the top-level
// keys every screen reads; everyone else's waits in profiles[id].data and is swapped in when they log in again.
// Settings (minimum, ESE target, alerts, medical, tour) are shared by everyone on the browser.
const Profile = (() => {
  // The per-person keys. A new per-person storage key goes here too.
  const DATA = ["snapshots", "latest", "adjust", "excused", "lastCourse", "timetable", "timetableSem", "timetableSavedAt", "absentList", "bunkPlan"];

  // FNV-1a of the normalised name: a stable id that doesn't spell the name out.
  const idOf = (name) => {
    let x = 0x811c9dc5;
    for (const ch of name.trim().toUpperCase().replace(/\s+/g, " ")) { x ^= ch.codePointAt(0); x = Math.imul(x, 0x01000193) >>> 0; }
    return "p" + x.toString(36);
  };
  const labelOf = (name) => name.trim().split(/\s+/)[0]; // the first name, shown in the popup

  // Who the portal says is logged in: a name <p> followed by a class-code <span> ("6BTIT"). Null if it isn't on the page.
  function who(doc = document) {
    for (const p of doc.querySelectorAll("p.MuiTypography-body2")) {
      const s = p.nextElementSibling;
      if (!s || !s.matches("span.MuiTypography-caption")) continue;
      const name = p.textContent.trim(), cls = s.textContent.trim();
      if (name && !/\d/.test(name) && /^\d+\s*[A-Z]{2,}/i.test(cls)) return { name, cls };
    }
    return null;
  }

  // Make `id` the active profile: park the current person's data under their profile and bring id's in.
  // The first profile on a browser takes the data already there (it was saved before profiles existed).
  // Resolves to true if the data was swapped.
  async function activate(id, label, st = chrome.storage.local) {
    const d = await st.get({ profile: null, profiles: {} });
    const profiles = d.profiles;
    if (d.profile === id) return false;
    let next = {};
    if (d.profile) {
      const cur = await st.get(DATA);
      profiles[d.profile] = { ...profiles[d.profile], data: cur };
      next = profiles[id]?.data || {};
    }
    profiles[id] = { label: profiles[id]?.label || label || "Profile" };
    if (d.profile) await st.remove(DATA.filter((k) => !(k in next))); // the first profile keeps what is already here
    await st.set({ ...next, profile: id, profiles });
    return !!d.profile;
  }

  // Forget a parked (not active) profile and its data.
  async function remove(id, st = chrome.storage.local) {
    const d = await st.get({ profile: null, profiles: {} });
    if (id === d.profile || !d.profiles[id]) return;
    delete d.profiles[id];
    await st.set({ profiles: d.profiles });
  }

  return { DATA, idOf, labelOf, who, activate, remove };
})();

if (typeof module !== "undefined") module.exports = Profile;
