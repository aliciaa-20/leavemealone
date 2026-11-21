# Handoff
Last updated: 2026-11-21 · branch main · last commit: see `git log -1` (pushed to origin/main)

## State in one paragraph
leavemealone is a buildless MV3 Chrome/Edge extension for the CUE portal, now at version 0.6.0 (`extension/manifest.json`). 0.5.0 brought the guided tour, backup export/import, the Bangalorean copy and a cleanup pass. 0.6.0 adds: medical leave counting per course until the MSE is over (a setting, on by default), whole-day marking on both absent pages, and per-student profiles on a shared browser. Pushing a change under `extension/` runs `.github/workflows/release.yml`, which attaches `leavemealone.zip` to release `v<version>`; the README links to `releases/latest/download/leavemealone.zip`. How everything works: `CLAUDE.md`; rules for the maths: `docs/attendance_rules.md`.

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

## Next steps (ordered, concrete)
1. Confirm the v0.6.0 release zip exists and installs (Load unpacked on the unzipped `leavemealone` folder).
2. Antony tests the three features in Chrome and reports what looks off.
3. Calendar checked against the official 2026-27 PDF (2026-11-21): holidays and student working Saturdays match; ESE start fixed to 9 Mar. The PDF's per-month instructional-day table does not reconcile with its own listing, so it is ignored.
4. Open copy ideas, footer tagline, "Plan on CUE" rename, Web Store listing: unchanged from the last handoff (see git history of this file, commit a9b28f8).

## User decisions and preferences to respect
- "Bunk", not "skip", in all copy; the tab is "Put a bunk".
- "pakka detain" is tied to 75% and "susegad" to 85%, not to the user's Minimum. Jokes stay quieter than the can-bunk / attend chips.
- Onboarding lives inside the extension (tour), never a separate welcome tab.
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
