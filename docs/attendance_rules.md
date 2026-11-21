# Attendance rules used by leavemealone

Every rule the extension applies, where it lives in the code, and what is assumed. If a number on screen looks wrong, check it against this file first. Percentages shown on screen have one decimal; all maths is done unrounded.

Code references: `extension/calc.js` (`Calc`), `extension/plan.js` (`Plan`), `extension/calendar.js` (`Cal`).

## 1. The portal's own rules (source of truth)
From the portal's "Attendance Information" panel:
- **Total % = (Present / Conducted) x 100.**
- Value-added courses are not included.
- **Medical leave:** considered only if the aggregate is above 74.50% at the end of the semester; applied to aggregates between 74.50% and 84.49% (with co-curricular).
- **Co-curricular claims** (co-curricular, extra-curricular, departmental activities) are added to the total aggregate at the end of the semester.

## 2. The minimum and the criteria per exam
| | What must be true | Where |
|---|---|---|
| Plain minimum (the "75%" setting) | each course >= your minimum, default **75%**, editable 1 to 100 | `threshold` in storage |
| **MSE** | **every course >= 75%.** There is no overall criterion for MSE. | `Plan.MSE_MIN`, `CRITERIA.mse` |
| **ESE** | the **overall >= 85%** (the "ESE target", default 85, editable). Courses are not the criterion; for information they are shown against the plain minimum. Medical leave helps the overall get there (section 4). | `Plan.ESE_OVERALL`, `CRITERIA.end` |
| "After the bunk" (no exam) | both: courses and overall against your minimum | `CRITERIA.now` |

A day or a set of days is **safe** when the criteria for the chosen basis hold after skipping it. Only courses you actually skip are judged in a plan (a course already below the line that you do not skip is not blamed on the plan).

## 3. The maths (`Calc`)
a = attended hours, s = scheduled (conducted) hours, t = the line as a fraction.
- `percent(a, s)` = a / s x 100 (0 when s = 0).
- `canSkip(a, s, t)` = floor(a / t - s): classes you can still miss (as extra classes held) and stay at or above t. 0 when negative.
- `mustAttend(a, s, t)` = ceil((t x s - a) / (1 - t)): consecutive classes to attend to get back to t; 0 if already there. At a 100% minimum this is **Infinity** (a missed class can never be recovered) and the screens say "out of reach".
- `afterSkipping(a, s, n)` = a / (s + n).
- `budget(a, s, R, t)` = floor(a + R - t x (s + R)): classes that can still be missed out of the R already scheduled before a cutoff.
- `bestCase(a, s, R)` = (a + R) / (s + R): the best possible % if every remaining class is attended.

## 4. Your actual attendance (`Calc.effective`, `Calc.actual`)
This is what the Overview, the pill, the planner, the toolbar popup and the daily alert show.
1. Start from the portal's numbers per course.
2. Add **typed hours** (per course: attended and scheduled; and co-curricular for the overall).
3. Add **absent hours you marked "Later"** (the portal will update them to present) to that course.
4. **Co-curricular** hours (marked on an absent hour, or typed) count in the **overall** and, in the actual view, in **their own course** too (counted once in the overall). Once the portal shows a Co-curricular column (semester end) it has already included them, so the extension adds none.
5. **Medical** hours count in the **overall** only by the portal's band: overall (with co-curricular) **below 74.5%: not considered; 74.5% up to 84.49%: added; 85% or more: not needed**. Not capped at 85%.
   **Per course, until the MSE is over** (through the last day of the MSE window), medical hours also count as attended in their own course, so they help the MSE 75% line. From the day after the MSE window they reset: courses no longer count them, and only the overall band above applies. This is the Settings toggle "Medical counts per course until MSE" (`medBeforeMse`, on by default; `Plan.medInCourse`).
6. Marked hours are never more than the portal's own absent count for that course (scaled down if they are). An hour the portal stops listing as absent is already in its numbers and is not counted again.
7. If the portal's scheduled or absent count changes after you marked something, the mark is flagged "needs review".
8. The portal's own labels (e.g. "Medical Leave", co-curricular) are locked and read as marks.

## 5. The planner (`Plan`)
- **Projection:** for MSE and ESE the extension assumes you attend every class until the cutoff except the ones you pick to skip (`project`). "After the bunk" is the % right after skipping, nothing else.
- **Cutoff:** MSE counts up to the last class day before the MSE window. ESE counts up to the last instruction day.
- **Courses vs timetable:** a course is matched to the timetable by upper-cased name. A course that never matches has no known classes left, so it is flagged "not in timetable" instead of being judged.
- **Budgets** (before MSE / ESE): MSE shows what each course can still skip (the tightest course sets the headline); ESE shows the overall. "Out of reach" = even attending everything cannot reach the line.
- **Best days:** safe days first, then longer breaks, then days with fewer classes.
- **Skip today?:** the next class day that still has a class (a class that has ended today is not offered). Each class is "can skip" when skipping that one class alone keeps its course at or above your minimum.
- **Break length:** the run of days off (holidays, Sundays, non-working Saturdays) around a day. The label counts the break itself; skipping the day makes it one longer ("3-day break", skipping makes 4). A plain weekend plus a skipped day is a "long weekend".

## 6. Calendar rules (`Cal`, academic year 2026-27)
- Sundays are off. Third Saturdays are off unless listed as working (17 Oct, 21 Nov, 19 Dec 2026). A compensatory holiday replaces a working Saturday (28 Nov for 21 Nov).
- Holidays and vacations are listed in `calendar.js`; days with no regular classes (MSE weeks, Christmas vacation) are `noClass` ranges.
- Odd semester: 1 Jun to 26 Sep 2026 (last instruction day), MSE 3 to 8 Aug.
- Even semester: 27 Oct 2026 to 5 Mar 2027 (last instruction day), MSE 4 to 9 Jan 2027 (counts up to 22 Dec 2026), **ESE 13 to 24 Mar 2027**.
- After a cutoff the planner stays as a read-only reference until the exam window ends (MSE: 9 Jan; ESE: 24 Mar); alerts stop at the cutoff.
- A new academic year needs a new block in `YEARS`; without one the planner falls back to Monday to Saturday minus third Saturdays.

## 7. The timetable
Saved from the portal's Timetable page, one week at a time, keyed by weekday. Saving **merges per weekday**: a weekday with no classes in the visible week keeps what was saved before, so a holiday week does not wipe days.

## 8. Alerts (`background.js`)
Once a day: a notification if any course (actual numbers) is below your minimum; a "data is N days old" note after 3 days; and, if a timetable is saved, a warning for courses that cannot reach 75% by MSE ("out of reach") or have no spare class left within 7 days of it. Nothing is sent after the MSE cutoff or if alerts are turned off.

## 9. Decisions confirmed and what is not modelled
Confirmed by the owner (2026-11-20):
- **Medical threshold is 74.5%** (the portal's "above 74.50%"; it is 75% after rounding). Below 74.5% medical is not considered.
- **Only the overall matters for ESE.** No course is judged for ESE; courses are shown against the plain minimum for information only.

Not modelled:
- The portal's rounding of its own percentages is not reproduced (the extension keeps decimals).
- Attendance before the semester's first class or outside the calendar data is not known.
