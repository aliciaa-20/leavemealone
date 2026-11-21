# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

`leavemealone`: a Manifest V3 Chrome/Edge extension for the CHRIST University CUE portal (`https://cue.christuniversity.in/*`). Bunk calculator, absent-hour marking, daily low-attendance alert, and a "Put a bunk" planner. Plain JS in `extension/`, **no build step, no dependencies, no package.json**. Keep it that way unless there's a clear need.

## Commands

- Syntax-check everything: `node --check extension/*.js`
- Quick tests: `calc.js`, `calendar.js` and `plan.js` export via `module.exports` when loaded in Node, so test them ad hoc, e.g.
  `node -e "const C=require('./extension/calc.js'); console.log(C.canSkip(60,80,0.75))"`
  (`plan.js` `require`s `calc.js` and `calendar.js` itself when the globals are absent). There is no test suite or test runner.
- Run: `chrome://extensions` → Developer mode → Load unpacked → `extension/`. After edits, reload the extension and the portal tab. Verifying UI needs the live portal (login required).

## Architecture

**Script loading order matters.** No modules: files share globals. Both `manifest.json` content_scripts and `popup.html` load `calc.js` → `calendar.js` → `plan.js` → `ui.js` → `profile.js` → then `content.js` / `popup.js` (`background.js` doesn't need `profile.js`). A new shared file must be added to both lists, in dependency order.

- `calc.js` (`Calc`): pure maths. `Calc.effective(snap, adj, exc)` is the core: it merges the portal snapshot with the user's adjustments and absent-hour marks into effective per-course and overall numbers. Every view (pill, drawer, popup, planner) should go through it rather than recomputing. The on-page drawer (pill, Overview, Put a bunk, Skip today) uses `Calc.actual(snap, adj, exc, { medInCourse })` = `effective` plus co-curricular hours counted in their own course too (overall counts them once). Medical counts in its own course only while `Plan.medInCourse(medBeforeMse)` is true (setting on and the MSE window not over yet); in the overall it is always the 74.5% to 84.49% band. Every `Calc.actual` caller must pass that option. The toolbar popup and the daily alert use `Calc.actual` too, so every surface shows the same numbers; the popup's Reclassified card lists the marked hours with the portal's own % for comparison.
- `calendar.js` (`Cal`): academic-calendar data (`YEARS`: semesters, holidays, working Saturdays) plus `dayInfo(date)`, `mseWindow(date)` and `cutoff("mse"|"ese", date)` (the last day attendance counts for an exam). `cutoffRef(kind, date)` is the same but keeps answering after the cutoff, until the MSE window ends (or the semester's optional `ese: { from, to }` ends), so the planner can show the numbers that counted; alerts use the strict `cutoff`. Third Saturdays are off unless listed in `workingSaturdays`. Needs a new `YEARS` entry each academic year; otherwise the planner falls back to Mon–Sat minus third Saturdays.
- `plan.js` (`Plan`): pure bunk-planning functions shared by the drawer and popup. `basis` is `now | mse | end`; `thresholdFor(basis, t, esePct)` gives the line and `horizon(basis, from)` the cutoff, and `budgets` / `mseRisks` give the per-course bunk budget. The timetable is keyed by `Date.getDay()`; courses are matched to timetable entries by trimmed, upper-cased name, always through `Plan.courseOf(courses)` (name -> course, cached per `courses` array) or the internal `keyOf`. Don't re-implement the matching. `Plan.periodNum` sorts periods.
- `content.js`: runs on every portal page. The portal is a SPA, so it routes on `location.pathname`: `/main/attendence` (sic) parses the course table and saves a snapshot; `/main/AbsentDetails` handles marking; `/main/absence` (the all-courses list) saves its rows to `absentList` for the popup and shows only a pill, except when the course filter is set to one course, which gets the same marking panel as `/main/AbsentDetails` (course from the filter text, not `lastCourse`); `/main/timeTable` saves the timetable. All injected UI lives in one Shadow DOM host; `ui.css` is fetched via `web_accessible_resources` and injected into it; the bundled Space Grotesk font is declared in the page `<head>` (a shadow root can't load fonts). The drawer shell (`buildShell`) is built once and only its contents are swapped.
  Overview extras: `todayCard` ("Skip today?": next class day from `Plan.upcomingFrom`, per-class verdicts via `Plan.impact`, ticks in `todayPick`) and `needView` (a course row opens, `courseOpen`, to show what it needs with dates from `Plan.courseClasses`). The all-courses absent drawer has a "Mark hours" mode (`absMark`, `markAbs`, `drawAbsBody`) that writes the same `excused[sem][courseKey].rows` as the per-course panel (row key `date|period`, course key `code || name`). Both marking views put a whole-day A/C/M/L control (`UI.daySeg`) on any day with 2+ markable hours; it skips hours the portal labelled itself, and in the all-courses view one day can span courses (`markAbs(list, choice)`).
  The Overview IS the actual view: the same layout as before (hero with the number, bar and status lines, Skip today, course list), now fed by `Calc.actual`; one sub line under the status lines says how much you added and what the portal shows (`effPortal = Calc.effective(snap, {}, {})`). Each course row opens (`needView`) to say what it needs and what was counted. The per-hour breakdown lives on the absent pages and the marking panel.
- `ui.js` (`UI`): DOM helper `h`, `semRank` (the latest semester by its trailing Roman numeral), `plural`, icons, chips, bars, segmented pills (with a sliding thumb), stepper, switch, accordion, the number `tween` and the date/period/time formatters (`niceDate`, `nicePeriod`, `startTime`), shared by the drawer and popup. `ui.css` holds the design tokens and every component rule.
  Planner ticks mean "you attend this class", but the planner state is still the set of periods *skipped* per day (`Plan.setAttend` converts). The dock keeps 16px from the portal's own scrollbar (`syncGutter`, the portal scrolls inside a container, not the window).
- `popup.js`: toolbar popup, reads the same storage. It rebuilds everything on each `draw()`, so it restores focus by `data-key` and defers a redraw while a number box (`.stv`) has focus. Settings has Backup: Export writes `{ app: "leavemealone", schema: 1, version, exportedAt, data }` (the `KEYS` list) to a JSON download; Import (`readBackup`) keeps only `KEYS` and replaces, not merges. Add any new storage key to `KEYS`.
- Guided tour: `UI.tour({ mount, steps, onEnd })` dims everything but a hole over one element per step (`data-tour` anchors). The popup runs it on the first open with data (`startTour`), the drawer on the first attendance render (`maybeTour`, mounted on the shadow root); each sets `tour.popup` / `tour.drawer` on Done or Skip. Keep the steps' text in sync with the UI. `content.js` listens to `chrome.storage.onChanged` (attendance page only) so popup settings show up without a reload.
- `profile.js` (`Profile`): several students on one browser. `Profile.who()` reads the logged-in student from the portal header (a `p.MuiTypography-body2` name followed by a `span.MuiTypography-caption` class code like `6BTIT`), `idOf(name)` hashes it. The active person's data stays at the top-level keys (every screen reads those, unchanged); `activate(id)` parks the current person's `Profile.DATA` keys in `profiles[id].data` and swaps in the new one's. `content.js` `tick()` calls `syncProfile()` first and reads or saves nothing until the profile is settled. The first profile on a browser adopts the data already there. The popup shows whoever logged in last; it has no switch (a switch while a CUE tab is open could save one person's portal data into another's profile), only Remove for parked profiles. Settings are shared. **A new per-person storage key goes in `Profile.DATA`.**
- `background.js`: daily alarm + notification; it loads `calc.js`, `calendar.js` and `plan.js` with `importScripts` at the top so it can warn about the MSE line (`Plan.mseRisks`).

**State** is all in `chrome.storage.local`, keyed per semester label (the portal's semester combobox text):
- `snapshots[sem]` (portal data), `latest` (highest semester by trailing Roman numeral)
- `adjust[sem]` = `{ cocurricular, courses: { [key]: { att, sch, baseSch } } }`: hours typed in that aren't on the portal yet
- `excused[sem][key]` = `{ rows: [{ k, h, s, p?, gone? }], baseAbsent }`: per-absent-hour marks, `s` ∈ `later | cc | med`
- `lastCourse`: the Absent Details page doesn't say which course it shows, so the course whose "View Details" was last clicked is remembered
- `tour` (`{ popup?, drawer? }`: which guided tours have been seen), `threshold` (the minimum, per course and overall; MSE is always `Plan.MSE_MIN`), `alerts`, `timetable` (merged per weekday from the one week the Timetable page shows, so a holiday week doesn't wipe days, but only with a timetable from the same semester: `timetableSem`), `ttSchema` (set by `background.js` after its one-time wipe of pre-0.5.0 timetables), `sortBy`, `bunkBasis` (`now | mse | end`, where `end` is ESE), `profile` (active profile id), `profiles` (`{ [id]: { label, data? } }`: label = first name; `data` = a parked person's `Profile.DATA` keys), `eseTarget` (ESE target %, unset = the minimum), `medBeforeMse` (medical counts per course until the MSE is over; unset = on), `absentList` (`{ sem, at, rows: [{ date, day, period, time, code, name, type, kind, h }] }`, saved from the all-courses absent page; the popup groups it by day)

Course key = `code || name`.

## Attendance rules (easy to break)

The full, current list lives in `docs/attendance_rules.md`; keep it in step with the code. Summary: MSE = every course at 75% (no overall); ESE = overall at 85% (medical helps the overall); "now" = both.

- **Reconciliation:** `baseSch`/`baseAbsent` record the portal's counts at the time of an adjustment. If the portal's count changes, the adjustment is flagged `stale`. Rows the portal itself labels (`p`) are locked; rows it stops listing (`gone`) are already in its numbers and are not counted, pending "Confirm present". Excused hours are scaled so they never exceed the portal's own absent count.
- **Co-curricular** counts as attended in the overall and, through `Calc.actual` (every main number), in its own course too. `Calc.effective` alone keeps it overall-only. When the snapshot has a Co-curricular column (`snap.hasCc`, semester end), the portal has already included it, so the extension adds none.
- **Medical** follows the portal's policy text. It's computed on the aggregate *with* co-curricular: below 74.5% it's not considered, from 74.5% to under 85% it's added to overall attended, and at 85% or more it's not needed. It is not capped at 85%. Per course, medical counts as attended until the MSE window ends (setting `medBeforeMse`, on by default), then resets to not counted.

## Rules

- **Never commit real portal pages or screenshots.** `Pages/` (gitignored) holds saved portal HTML with a real student's name and attendance; use it locally for selector work only. Anonymise or invent any fixture data.
- The extension must make no network requests besides loading its own bundled files (`ui.css`, `fonts/`) (the README's privacy claim depends on it).
- Portal markup changes; selectors like `table[aria-label="coursewise attendance table"]` are the fragile part. Only the table view of the course list is parsed.

## Copy and tone

- The voice is Bangalore college slang: "bunk", never "skip" ("Put a bunk" tab, "can bunk 3", "no bunks left").
- Jokes are tied to fixed lines, not the user's minimum: `UI.DETAIN` (75, "pakka detain") and `UI.SUSEGAD` (85, "susegad", Goan). Render them only through `UI.vibeTag` / `UI.vibeLead` (`.vibe`: quiet italic aside, no fill or icon). The can-bunk / attend chips (`.chip`) must stay the loudest element; never style a joke as a chip.
- Tour steps take `text` as a string or an array with nodes; `.tour-em` (red, underlined) highlights the one action to take.
