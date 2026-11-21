# Handoff
Last updated: 2026-11-21 · branch main · 1.0.0 (first Chrome Web Store version; not submitted yet)

## State in one paragraph
leavemealone is a buildless MV3 Chrome/Edge extension for the CUE portal, now at version 0.7.1 (`extension/manifest.json`). 0.5.0 brought the guided tour, backup export/import, the Bangalorean copy and a cleanup pass. 0.6.0 adds: medical leave counting per course until the MSE is over (a setting, on by default), whole-day marking on both absent pages, and per-student profiles on a shared browser. Pushing a change under `extension/` runs `.github/workflows/release.yml`, which attaches `leavemealone.zip` to release `v<version>`; the README links to `releases/latest/download/leavemealone.zip`. How everything works: `CLAUDE.md`; rules for the maths: `docs/attendance_rules.md`.

## Done this session (and how it was verified)
- **Medical per course until MSE** (`Calc.actual(..., { medInCourse })`, `Plan.medInCourse(setting)`, storage `medBeforeMse`). Node test: course 30/40 + 3h medical shows 33/40 through 9 Jan 2027 and 30/40 from 10 Jan, and 30/40 with the setting off; the overall's 74.5-85% band is unchanged.
- **Whole-day marking** (`UI.daySeg`): a day with 2+ markable hours gets a "Whole day" A/C/M/L control, on `/main/AbsentDetails` and in the all-courses "Mark hours" mode (`markAbs(list, choice)` writes several courses in one go). Smoke-tested `absentDays` with a fake DOM.
- **Profiles** (`extension/profile.js`): detected from the portal header (name `p.MuiTypography-body2` + class-code `span.MuiTypography-caption`, e.g. "6BTIT"); data swapped per student. Node test with a fake `chrome.storage`: adopt, swap, switch back, remove; a bug where the first profile wiped existing data was found and fixed.
- Calendar: 21 Nov 2026 working, 28 Nov compensatory holiday, third Saturdays off unless listed: already correct, checked with `Cal.dayInfo`.
- `node --check extension/*.js` passes.
- **Nothing UI-side was seen in a browser by Claude.** Antony checks in Chrome.

## In flight / not verified
- In Chrome: the medical setting row, the whole-day controls, and profiles with a real second login. If a second student sees the first one's numbers, the header name probably isn't on the page (e.g. only in a menu): check `Profile.who()` in the console.
- Release Action for v0.6.0: not checked (no `gh` CLI on this laptop). Check the Actions tab / releases on github.com.
- Still unverified from 0.5.0: tour end to end, Import file picker on Windows, `.vibe` styling.

## Publishing (1.0.0, in progress)
Built: welcome page (opens on install; own light navy/gold design, report form that pre-fills a GitHub issue), popup chip-in card from the first open, Help & support block at the end of the popup, `PRIVACY.md`, `CONTRIBUTING.md`, `docs/store-listing.md` (paste-ready store copy), `.github/workflows/store.yml`. Waiting on Antony:
1. Done: UPI `antonyjoyukken@ptyes` in `UI.ABOUT.upi`; `extension/support-qr.png` encodes `upi://pay?pa=antonyjoyukken@ptyes&pn=Alicia%20%26%20Antony%20Co.&tn=leavemealone&cu=INR` (made with Python `qrcode` 8.0). Antony must tap **Allow** on Paytm's "Receive money from all UPI apps" or GPay/PhonePe payers fail. Test with a Rs 1 payment.
2. First upload by hand in the dashboard: a zip with `manifest.json` at its root (zip the *contents* of `extension/`; the GitHub release zip has a top folder and won't do). Listing text from `docs/store-listing.md`; screenshots with invented data only.
3. Google Cloud OAuth client + refresh token → repo secrets `CWS_EXTENSION_ID`, `CWS_PUBLISHER_ID`, `CWS_CLIENT_ID`, `CWS_CLIENT_SECRET`, `CWS_REFRESH_TOKEN`.
4. Once approved: put the store link in the README's "Get it" section.

## Next steps (ordered, concrete)
1. Confirm the v0.6.0 release zip exists and installs (Load unpacked on the unzipped `leavemealone` folder).
2. Antony tests the three features in Chrome and reports what looks off.
3. Calendar checked against the official 2026-27 PDF (2026-11-21): holidays and student working Saturdays match; ESE start fixed to 9 Mar. The PDF's per-month instructional-day table does not reconcile with its own listing, so it is ignored.
4. Open copy ideas, footer tagline, "Plan on CUE" rename, Web Store listing: unchanged from the last handoff (see git history of this file, commit a9b28f8).
5. **Grid view is not parsed (TODO for Antony).** The attendance page has a `table view` / `grid view` toggle (`aria-label`s on the toggle); `parseCourses` only reads `table[aria-label="coursewise attendance table"]`, so in grid view nothing syncs and the pill goes stale. Card markup (seen live 2026-11-21, structure only): one `div[role=button][aria-label="<NAME> (<CODE>): ..."].MuiPaper-root` per course inside a parent with one child per course; inside it `span[role=heading].MuiTypography-caption` (a label), `span.MuiTypography-caption` ("<CODE> • <type>"), `h6.MuiTypography-h6` ("91.67%"), `p.MuiTypography-body2` ("11 of 12 hours attended"), `span[role=progressbar][aria-label="<NAME> attendance"]`. **No absent-hours count and no View Details button on the card**, so `absent` would be null and `lastCourse` tracking needs the card click. Confirm on a semester with a Co-curricular column; then parse it into the same `{ name, code, attended, scheduled, absent, type }` rows as `parseRow`, and make the "View Details" click tracking (`lastCourse`) work from the cards. Update `CLAUDE.md` ("Only the table view is parsed") and the README when done.
6. 0.7.0 polish (merged from `fix/tour-and-settings-polish`): tour rewritten (readable card, progress bar, box follows its target, View Details highlighted), first-run setup chain (Timetable, then Absence Details, then back to Attendance, same tab, `setup` storage flag with 10-minute expiry), settings grouped into Targets / Counting / Alerts / Your data / Help, pill's "pakka detain" now judged on the overall (was: any course), stale-data banner in the popup after 3 days, overall % shown to 2 decimals like the portal. None of it seen in Chrome yet.

## User decisions and preferences to respect
- "Bunk", not "skip", in all copy; the tab is "Put a bunk".
- "pakka detain" is tied to 75% and "susegad" to 85%, not to the user's Minimum. Jokes stay quieter than the can-bunk / attend chips.
- Onboarding is the in-extension tour. The one exception (decided 2026-11-21): a welcome/about tab opens once on install, mainly for the disclaimer and how to contribute.
- Publisher name: **Alicia & Antony Co.** Always say "Unofficial, not affiliated with CHRIST (Deemed to be University)".
- Contributions: Antony's unused Paytm UPI (payout to Antony), or open-source help on GitHub; both offered side by side.
- Medical counts per course in full (not limited by the band) until the MSE window ends; the overall always uses the band.
- Profiles are automatic from the portal login; settings are shared; the popup has no profile switch (to avoid saving one person's portal data into another's profile).
- Commit when asked; **push only when Antony says "push"**.
- Antony is on the Claude Pro plan: keep work focused, no subagents unless asked.

## Watch out for
- `Pages/` and any saved portal HTML hold a real student's attendance and name: never commit them. (`Pages/` isn't on the new laptop.)
- A new per-person storage key goes in `Profile.DATA` (and the popup's backup `KEYS`).
- Every `Calc.actual` caller must pass `{ medInCourse: Plan.medInCourse(medBeforeMse) }`.
- Editing from Git Bash: heredocs mangle backslashes, and a bare `cat > file` waits on stdin forever. Write edit scripts with the Write tool and run them.
- Contributor aliciaa-20 also pushes to this repo; pull before starting.
