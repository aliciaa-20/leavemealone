# leavemealone

A Chrome / Edge extension for the CUE student portal. It reads your attendance page and tells you how many classes you can skip, or must attend, to stay above your minimum. It also lets you track hours the portal hasn't caught up with yet.

> **Unofficial.** This project is not affiliated with, endorsed by, or connected to CHRIST (Deemed to be University) or the ESPro / CUE portal. Numbers shown here are estimates; the portal is always the source of truth.

## What it does
- **Bunk calculator:** per course and overall, "can skip N" or "attend next N" against your minimum (default 75%, editable).
- **Pill and drawer on the attendance page:** courses stay in the portal's order, with a progress bar and a tick at your minimum.
- **Absent Details marking:** mark each absent hour as *Absent*, *Co-curricular*, *Medical* or *Later* (the portal will be updated, count it now). Changes save as you click, with Undo.
- **Reconciles with the portal:** hours the portal already labels (e.g. Medical Leave) are picked up and locked. Hours you marked that the portal has since updated are flagged so you can **Confirm present** and nothing is counted twice.
- **Semester-end handling:** once the portal shows a Co-curricular column, it has already added those hours, so the extension adds none of its own.
- **Actual tab:** appears in the drawer only when your typed hours or marks change the numbers. Your actual percentage is the big number with a bar that shows the portal's part and what you added; a day-by-day list shows where the extra hours come from; and a course-by-course list shows each changed course from the portal's % to yours. It is a reference view: co-curricular hours you marked also count in their own course here, and medical hours follow the portal's 74.5% to 84.49% rule.
- **Daily alert:** a notification if a course is below your minimum (can be turned off).
- **Plan a bunk:** open your CUE **Timetable** page once and the extension saves it. The drawer's *Plan a bunk* tab then shows:
  - **Best days to bunk:** safe days first, then the ones that make a long break with a holiday, then days with few classes.
  - **Calendar picker:** holidays are greyed and you can skip single periods.
  - **Result:** each course's % before and after.
  - **"Safe means" switch:** *right after the bunk*, *before MSE* (you need 75% to write it; counted up to the last class day before the exam window) or *before ESE* (your own target %, counted to the end of the semester). The last two assume you attend everything else.
  - **Bunk budget:** for MSE and ESE, how many classes each course can still miss and stay on the line, or its best possible % if that is already out of reach.
- **MSE alert and countdown:** the popup shows days to MSE and ESE, and the daily alert also warns about courses that can't reach 75% by MSE or have no spare classes left.

### Academic calendar (contributors, please update yearly)
Holidays, vacations, mid-sem exams (`mse` on each semester, also listed under `noClass`), working Saturdays and semester dates live in `extension/calendar.js`, taken from the university's public academic calendar PDF. Third Saturdays are treated as off unless listed in `workingSaturdays`. When a new academic year starts, add a new entry to `YEARS`; until then the planner falls back to "Mon–Sat, minus third Saturdays" and says so.

## Privacy
Everything stays in your browser (`chrome.storage.local`). The extension makes **no requests to any server** (it only loads its own bundled stylesheet) and sends nothing anywhere. It only runs on `https://cue.christuniversity.in/*`.

| Permission | Why |
|---|---|
| `https://cue.christuniversity.in/*` | Read the attendance table and Absent Details page you are viewing |
| `storage` | Keep the last snapshot, your marks and settings locally |
| `alarms` | Run the once-a-day low-attendance check |
| `notifications` | Show that alert |

## Install (unpacked)
1. Download or clone this repo.
2. Open `chrome://extensions` (or `edge://extensions`) and turn on **Developer mode**.
3. Click **Load unpacked** and choose the `extension` folder.
4. Log in to the portal and open the attendance page in **table view**.

## How it works
- `extension/content.js` parses the course table and the Absent Details table, and draws the UI inside a Shadow DOM so the portal's CSS can't interfere.
- `extension/calc.js` holds the pure maths (`canSkip`, `mustAttend`, `effective`). Plain JS, no build step, no dependencies.
- `extension/popup.*` is the toolbar popup; `extension/background.js` runs the daily alert.
- The Absent Details page doesn't say which course it shows, so the extension remembers the course whose **View Details** you last clicked in the table.

Medical leave follows the portal's own policy text: considered only if the aggregate is above 74.5% and applied between 74.50% and 84.49%.

## Contributing
Issues and pull requests are welcome. The portal's markup can change, so selector fixes are the most useful kind of contribution.

- **Never commit real portal pages or screenshots.** They contain a student's name and attendance. Anonymise or invent the data first.
- Keep it dependency-free and buildless unless there's a clear need.
- Check scripts with `node --check extension/*.js`; `calc.js` is also loadable from Node for quick tests.

## Known gaps
- Only the table view of the course list is parsed (not the grid view).
- The wording of a co-curricular status on Absent Details is a guess; only Medical Leave has been observed.
- Before-MSE assumes attendance counts up to the last class day before the MSE window, and the ESE target is one number for all courses.
- The Timetable page shows one week at a time; the saved timetable is merged per weekday, so a holiday week doesn't wipe days, but a weekday that really lost all its classes keeps the old ones until you erase your data in the popup.
- Chrome and Edge only.

## Licence
MIT, see [LICENSE](LICENSE).
