# Testbench — Test Execution Dashboard

A static, dependency-free dashboard for all 32 eval cases: 22 core plus 10 bonus.
Cards show every case and its execution status; each card opens a modal with the
step-by-step execution timeline and a streaming log console. Bonus cards use an
azure surface and top rule so they read differently from the core grid at a glance.

## Open it

```bash
cd dashboard
python3 -m http.server 8000
# then open http://localhost:8000
```

Opening `index.html` directly from disk also works (no build step, no fetch calls).

## What the runner does

`Run test` (on a card or in the modal) replays the tool trace recorded in the eval
JSON through a small in-browser execution engine:

- steps move `Pending → Running → Passed/Failed`, with tool timeouts and rate limits preserved as failed steps;
- start/end/duration are measured live for each replay (the recorded eval JSON has no wall-clock timing);
- logs are appended as each step starts, finishes or fails, and the log auto-scrolls unless you scroll up;
- the final card verdict is `Passed` when the recorded run is `completed` and the judge score is ≥ 80, otherwise `Failed`;
- `Run all cases` replays four at a time; `Reset` clears every run back to `Not Run`.

This is a **trace replay demo** — no API calls are made and the snapshot data is from
09–10 Nov 2026, not live status.

## Data

`data.js` is generated from the lab's real artifacts (read-only):

```bash
python3 build_data.py
```

Sources of truth:

- core: `evals/cases.json` + `eval_after.json` (22 cases);
- bonus: `bonus/cases.json` + `eval_bonus.json` (10 cases).

Re-run the generator after a new eval run.

## Files

| File | Purpose |
| --- | --- |
| `index.html` | Page shell, header telemetry, modal markup |
| `styles.css` | Theme, responsive grid, modal, step/log styling |
| `app.js` | Replay engine, card painting, modal, filters |
| `build_data.py` | Generates `data.js` from the eval artifacts |
| `data.js` | Static dataset for the 32 cases (generated) |
