# leavemealone

A Chrome / Edge extension for the CUE student portal. It reads your attendance page and tells you how many classes you can bunk, or must attend, to stay above your minimum.

> **Unofficial.** This project is not affiliated with, endorsed by, or connected to CHRIST (Deemed to be University) or the ESPro / CUE portal. Numbers shown here are estimates; the portal is always the source of truth.

Developed by **Alicia & Antony Co.** Free and open source.

## Get it (for students)

**Chrome Web Store:** [install leavemealone](https://chromewebstore.google.com/detail/leavemealone/komhapklhkoicjaklcanacmnfgcffceb). It is one click and updates itself.

For Edge, or to try the latest build before the store has it, install it from the ZIP:

**[Download the extension (ZIP)](https://github.com/antiiiiny/leavemealone/releases/latest/download/leavemealone.zip)**

1. Download the ZIP above and unzip it. You get a folder called `leavemealone`: that is the whole extension.
2. Open `chrome://extensions` (Edge: `edge://extensions`) and turn on **Developer mode** (top right).
3. Click **Load unpacked** and choose that `leavemealone` folder.
4. Log in to the CUE portal and open **Attendance** (table or grid view, both are read). A small pill with your percentage appears at the bottom right; click it.
5. Optional: open the portal's **Timetable** page once. That unlocks *Put a bunk today?* and *Put a bunk*.

To update, download the ZIP again, replace the old folder, and press the reload icon on the extension's card in `chrome://extensions`.

## What it does
- Shows your **actual attendance**: the portal's numbers plus hours you typed in or marked.
- Tells you per course and overall: **can skip N** or **attend next N**.
- **Skip today?** lists the next class day's classes and which you can skip.
- Tap a course to see **what it needs**, with the real dates of its next classes.
- **Put a bunk:** pick days on a calendar, see the cost, get best days to bunk. Your picks are saved automatically, so you can close the drawer and come back to the same plan; they never change your real numbers.
- Plans for **MSE** (every course at 75%) and **ESE** (overall at 85%).
- **Mark absent hours** as Absent, Co-curricular, Medical or Later, one course at a time or from the all-courses list.
- Counts co-curricular hours in the overall and in their course; medical in the overall only (74.5% to 84.49%).
- Matches up with the portal when it catches up, so nothing is counted twice.
- **Toolbar popup** with the same numbers, exam countdowns and best days.
- **Daily alert** if a course is low (can be turned off). The popup also warns when your data is more than 3 days old.
- **Quick tour** the first time you open the popup and the pill: Next, Next, Done (or Skip). Its last step opens your Timetable and Absence Details once, in the same tab, so the extension has all its data, then returns you to Attendance. Replay it from Settings.
- Overall % is shown to two decimals, like the portal.
- **Backup:** Settings → Export saves all your data to a file; Import brings it back, e.g. on a new browser.

Every rule used in the maths is in [docs/attendance_rules.md](docs/attendance_rules.md).

## Contribute
It's free and stays free. If it saved your attendance:
- **Chip in by UPI:** the QR is on the extension's welcome page (popup → Help & support → Chip in).
- **Build it with us:** star the repo, report a bug (popup → Help & support → Report a bug, or [open an issue](https://github.com/antiiiiny/leavemealone/issues)), or send a fix. See [CONTRIBUTING.md](CONTRIBUTING.md).

## Privacy
Full policy: [PRIVACY.md](PRIVACY.md).
- Everything stays in your browser (`chrome.storage.local`).
- If more than one student logs in on CUE in the same browser, each gets their own profile, picked by the name the portal shows. Only the first name is kept, as the profile's label.
- No requests to any server (it only loads its own bundled stylesheet and font); nothing is sent anywhere.
- It only runs on `https://cue.christuniversity.in/*`.

| Permission | Why |
|---|---|
| `https://cue.christuniversity.in/*` | Read the attendance table and Absent Details page you are viewing |
| `storage` | Keep the last snapshot, your marks and settings locally |
| `alarms` | Run the once-a-day low-attendance check |
| `notifications` | Show that alert |

## How it works
- `extension/content.js` parses the portal tables and draws the UI inside a Shadow DOM, so the portal's CSS can't interfere.
- `extension/calc.js` and `extension/plan.js` hold the pure maths; `extension/calendar.js` holds the academic calendar.
- `extension/popup.*` is the toolbar popup; `extension/background.js` runs the daily alert.
- Plain JS, no build step, no dependencies.

## Open to
Issues and pull requests are welcome, especially:
- **Portal changes:** the portal's markup can change, so selector fixes are the most useful contribution.
- **New academic years:** add an entry to `YEARS` in `extension/calendar.js` (holidays, vacations, MSE and ESE dates, working Saturdays), taken from the university's public calendar PDF.
- **Other browsers, fonts and screen sizes:** testing and fixes.
- **Ideas and bug reports:** open an issue.

Ground rules:
- **Never commit real portal pages or screenshots.** They contain a student's name and attendance. Anonymise or invent the data first.
- Keep it dependency-free and buildless unless there's a clear need.
- Check scripts with `node --check extension/*.js`; `calc.js`, `calendar.js` and `plan.js` also load from Node for quick tests.

## License
MIT, see [LICENSE](LICENSE).
