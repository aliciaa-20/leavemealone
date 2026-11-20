# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

`leavemealone`: a Manifest V3 Chrome/Edge extension for the CHRIST University CUE portal (`https://cue.christuniversity.in/*`). Bunk calculator, absent-hour marking, daily low-attendance alert, and a "Plan a bunk" planner. Plain JS in `extension/`, **no build step, no dependencies, no package.json**. Keep it that way unless there's a clear need.

## Commands

- Syntax-check everything: `node --check extension/*.js`
- Quick tests: `calc.js`, `calendar.js` and `plan.js` export via `module.exports` when loaded in Node, so test them ad hoc, e.g.
  `node -e "const C=require('./extension/calc.js'); console.log(C.canSkip(60,80,0.75))"`
  (`plan.js` `require`s `calc.js` and `calendar.js` itself when the globals are absent). There is no test suite or test runner.
- Run: `chrome://extensions` → Developer mode → Load unpacked → `extension/`. After edits, reload the extension and the portal tab. Verifying UI needs the live portal (login required).

## Architecture

**Script loading order matters.** No modules: files share globals. Both `manifest.json` content_scripts and `popup.html` load `calc.js` → `calendar.js` → `plan.js` → then `content.js` / `popup.js`. A new shared file must be added to both lists, in dependency order.

- `calc.js` (`Calc`): pure maths. `Calc.effective(snap, adj, exc)` is the core: it merges the portal snapshot with the user's adjustments and absent-hour marks into effective per-course and overall numbers. Every view (pill, drawer, popup, planner) should go through it rather than recomputing.
- `calendar.js` (`Cal`): academic-calendar data (`YEARS`: semesters, holidays, working Saturdays) plus `dayInfo(date)`, `mseWindow(date)` and `cutoff("mse"|"ese", date)` (the last day attendance counts for an exam). Third Saturdays are off unless listed in `workingSaturdays`. Needs a new `YEARS` entry each academic year; otherwise the planner falls back to Mon–Sat minus third Saturdays.
- `plan.js` (`Plan`): pure bunk-planning functions shared by the drawer and popup. `basis` is `now | mse | end`; `thresholdFor(basis, t, esePct)` gives the line and `horizon(basis, from)` the cutoff, and `budgets` / `mseRisks` give the per-course bunk budget. The timetable is keyed by `Date.getDay()`; courses are matched to timetable entries by upper-cased name.
- `content.js`: runs on every portal page. The portal is a SPA, so it routes on `location.pathname`: `/main/attendence` (sic) parses the course table and saves a snapshot; `/main/AbsentDetails` handles marking; `/main/timeTable` saves the timetable. All injected UI lives in one Shadow DOM host; `ui.css` is fetched via `web_accessible_resources` and injected into it.
- `popup.js`: toolbar popup, reads the same storage. `background.js`: daily alarm + notification; it loads `calc.js`, `calendar.js` and `plan.js` with `importScripts` at the top so it can warn about the MSE line (`Plan.mseRisks`).

**State** is all in `chrome.storage.local`, keyed per semester label (the portal's semester combobox text):
- `snapshots[sem]` (portal data), `latest` (highest semester by trailing Roman numeral)
- `adjust[sem]` = `{ cocurricular, courses: { [key]: { att, sch, baseSch } } }`: hours typed in that aren't on the portal yet
- `excused[sem][key]` = `{ rows: [{ k, h, s, p?, gone? }], baseAbsent }`: per-absent-hour marks, `s` ∈ `later | cc | med`
- `lastCourse`: the Absent Details page doesn't say which course it shows, so the course whose "View Details" was last clicked is remembered
- `threshold`, `alerts`, `timetable`, `panelOpen`, `sortBy`, `bunkBasis` (`now | mse | end`, where `end` is ESE), `eseTarget` (ESE target %, unset = the minimum)

Course key = `code || name`.

## Attendance rules (easy to break)

- **Reconciliation:** `baseSch`/`baseAbsent` record the portal's counts at the time of an adjustment. If the portal's count changes, the adjustment is flagged `stale`. Rows the portal itself labels (`p`) are locked; rows it stops listing (`gone`) are already in its numbers and are not counted, pending "Confirm present". Excused hours are scaled so they never exceed the portal's own absent count.
- **Co-curricular** adds to the overall aggregate only, never to per-course numbers. When the snapshot has a Co-curricular column (`snap.hasCc`, semester end), the portal has already included it, so the extension adds none.
- **Medical** follows the portal's policy text. It's computed on the aggregate *with* co-curricular: below 74.5% it's not considered, from 74.5% to under 85% it's added to overall attended, and at 85% or more it's not needed. It is not capped at 85%.

## Rules

- **Never commit real portal pages or screenshots.** `Pages/` (gitignored) holds saved portal HTML with a real student's name and attendance; use it locally for selector work only. Anonymise or invent any fixture data.
- The extension must make no network requests besides loading its own bundled `ui.css` (the README's privacy claim depends on it).
- Portal markup changes; selectors like `table[aria-label="coursewise attendance table"]` are the fragile part. Only the table view of the course list is parsed.
