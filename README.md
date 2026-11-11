# Clay Card

A squad scorecard for English Sporting. One phone scores up to 15 shooters, and each card is sent to a club Google Sheet, which combines every squad into one leaderboard.

- Tap a box to cycle it: ✕ kill → ○ lost → clear. **Rest killed** fills the rest of a stand.
- The first shooter rotates to the back on each stand (this can be switched off).
- Stand-by-stand totals, and a leaderboard with countback (last stand first, then working backwards).
- Results can be shared as WhatsApp text, a CSV file or a JSON backup.
- **Submit to club** sends the card to the Sheet. With no signal, the card waits on the phone and sends when signal returns. Re-submitting a card replaces its earlier rows.
- The **Club** tab shows a combined leaderboard for each shoot.
- It works offline after the first visit (it's a PWA), and the screen stays awake while scoring.

It's plain HTML, CSS and JavaScript modules, with no build step and no dependencies.

## Project layout

| Path | What it is |
|---|---|
| `index.html`, `styles.css` | App shell and styling |
| `src/scoring.js` | All scoring rules (pure functions, unit-tested) |
| `src/app.js` | UI: routes, views, events |
| `src/storage.js` | Saving to the phone (localStorage) |
| `src/api.js` | Club database client, with the offline queue |
| `src/config.js` | **Club name and API URL: the only file to edit** |
| `sw.js` | Offline cache. Bump `VERSION` on each deploy |
| `backend/Code.gs` | Google Apps Script for the club Sheet |
| `scripts/` | Local dev server, and a fake Sheet for tests |
| `tests/` | `npm test` (Node 20+) |

## Develop

```bash
npm test       # scoring and backend tests
npm run dev    # http://localhost:5173 with a fake club database, PIN 1234
```

## Deploy

See [SETUP.md](SETUP.md).
