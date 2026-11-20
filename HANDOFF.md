# Handoff
Last updated: 2026-11-21 · branch main · last commit: see `git log -1` (the handoff commit, not pushed; 91b2744 and earlier are pushed)

## State in one paragraph
leavemealone is a buildless MV3 Chrome/Edge extension for the CUE portal, now at version 0.5.0 (`extension/manifest.json`). This session added a guided tour (popup and CUE pill/drawer), Settings backup export/import, clearer Minimum/ESE target settings, live settings sync to an open CUE tab, a timetable fix (old semesters leaked weekdays in; pre-0.5.0 timetables are wiped once), a cleanup pass (shared helpers, a Best days bug fix), and the Bangalorean copy ("bunk" everywhere, "pakka detain" below 75%, "susegad" at 85%+ as quiet italic asides). How everything works: `CLAUDE.md`; rules for the maths: `docs/attendance_rules.md`.

## Done this session (and how it was verified)
- All of the above is pushed to `origin/main` up to `91b2744`.
- The last change (tour step 5: "View Details and mark it" in red, underlined, via `.tour-em`) is in the handoff commit, not pushed.
- Verified: `node --check extension/*.js` passes. The cleanup was checked by dumping `Cal`/`Plan` outputs for every day of 2026-27 before and after (identical). `Plan.bestDays` now returns ordinary days (bug: a dangling `if` only kept 3+ day breaks). Backup validation (`readBackup` in `popup.js`) was tested in Node.
- **Nothing UI-side was seen in a browser by Claude**: Antony checks in Chrome and sends screenshots.

## In flight / not verified
- Not checked in Chrome yet: the tour end-to-end (the drawer tour opens the drawer and switches tabs; the last step opens the timetable), whether the popup survives the Import file picker on Windows (fallback idea: open `popup.html#import` in a tab), the stepper fixes, live sync, the `.vibe` squiggle/tilt.
- The "NOT IN TABLE" rows on the Today card should disappear once a fresh timetable is captured. If they persist, the timetable and attendance course names differ: get a screenshot of the Timetable page.

## Next steps (ordered, concrete)
1. Antony reloads the extension, uses Settings → Quick tour → Replay, and reports what looks off.
2. Optional copy ideas Antony hasn't picked yet: "Full safe, machaa", "Sakkath! N bunks in hand", "Swalpa adjust maadi" (no bunks left), "Class ge hogu" (attend next), "Ayyo" (a bunk drops a course), "chill maadi" (long weekend), "Scene illa" (nothing left), "Namaskara, guru" (tour), "Yen guru" (stale data alert).
3. Footer tagline: suggested replacing "Unofficially vibecoded UI just like this website, but better." with "Made in Namma Bengaluru…" before a public Web Store listing. Not decided.
4. Popup button "Plan on CUE" was not renamed; asked if it should become "Put a bunk on CUE". No answer yet.
5. Chrome Web Store publishing: steps were given (Unlisted first, $5 account, zip `extension/*`, privacy tab, no real data in screenshots). Not started.

## User decisions and preferences to respect
- "Bunk", not "skip", in all copy; the tab is "Put a bunk".
- "pakka detain" is tied to 75% and "susegad" to 85%, not to the user's Minimum. Jokes must stay visually quieter than the can-bunk / attend chips.
- Onboarding lives inside the extension (tour), never a separate welcome tab.
- Commit when asked; **push only when Antony says "push"** (a push without that was blocked).
- Antony is on the Claude Pro plan: keep work focused, no subagents unless asked.

## Watch out for
- `Pages/` and any saved portal HTML hold a real student's attendance: never commit them.
- Editing from Git Bash: heredocs mangle backslashes in regexes (one turned `\b` into a backspace). Write edit scripts to a file, or use the Edit tool.
- Contributor aliciaa-20 also pushes to this repo (PRs #1–#3 merged); pull before starting.
