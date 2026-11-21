# Contributing

Thanks for helping. Bug reports, ideas and fixes are all welcome.

## Report a bug or idea
Open an [issue](https://github.com/antiiiiny/leavemealone/issues). Say which page you were on and what you expected. **Don't paste screenshots or HTML with your real name or attendance**: blur them or describe the problem instead.

## Run it locally
1. Fork and clone the repo.
2. `chrome://extensions` → Developer mode → **Load unpacked** → pick the `extension/` folder.
3. After an edit, press reload on the extension's card and refresh the CUE tab.
4. Before a pull request: `node --check extension/*.js`.

There is no build step and no dependencies; please keep it that way. How the code fits together is in [CLAUDE.md](CLAUDE.md); the maths rules are in [docs/attendance_rules.md](docs/attendance_rules.md).

## A few rules
- **No network requests.** The extension only loads its own bundled files. Our privacy promise depends on it.
- **No real portal data in the repo.** Invent any test data.
- **Copy voice:** Bangalore college slang. "Bunk", never "skip".
- For a big change, open an issue first so we can agree on the approach.
