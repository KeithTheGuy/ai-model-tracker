# MODELWATCH

Live feed of AI model releases, price changes, and context-window bumps across
every major lab, sourced from OpenRouter's public catalog API (no key needed).

- `.github/workflows/update.yml` polls every 30 minutes, diffs the catalog, and
  appends typed events (NEW / CUT / HIKE / CTX / GONE) to `data/events.json`.
- `index.html` renders the signal feed plus a searchable, sortable catalog of
  every tracked model with $/M-token pricing.

Local dev: `node scripts/fetch.mjs`, `node scripts/smoke-test.mjs`, then
`python -m http.server 4601`.
