# SwitzerlandVote

A public, modern, and minimal web app to explore Swiss federal ballot objects and party voting recommendations from **1848 to today**.

## Why this project?

Swiss vote history is rich, but hard to browse in one place with party-level context. SwitzerlandVote provides a fast public interface to:

- search and filter all federal ballot objects in the dataset;
- compare party recommendations on each object;
- track official outcomes and party alignment over time.

## What you can do

### Explorer

- Full-text search on ballot object titles.
- Filters by year range, result, party, recommendation type, and sort mode.
- Random **Archives** spotlight on the homepage (changes at every page refresh and with the button).
- Official Federal Chancellery (BK) link attached to each object (cards, Archives block, and rankings).

### Visual summaries

- Clear **For vs Against** result breakdown on each object.
- Grouped party positions: **For**, **Against**, and optional **Other positions**.
- Party alignment summary on the current filtered selection.

### Statistics tab

- Most accepted federal ballots.
- Most rejected federal ballots.
- Results by party and legislature (official election-based legislature segmentation).

### Historical party handling

- Historical parties (**PBD, PRD, PLS**) are hidden by default and can be revealed with a toggle.
- Historical parties are visually distinguished.
- **PLR is counted only from 2009 onward** in legislature statistics (before that: PRD/PLS).

### Public deployment and automation

- Public GitHub Pages site.
- Automatic deploy on pushes to `main`.
- Automated BK refresh on voting Sundays (with date gating against BK calendar).

## Data pipeline

The dataset is generated from the source spreadsheet and enriched with official data.

### Source

- Main source: `data/source/recommandations-de-vote-des-partis.xlsx`
- Supported formats: `.xlsx` and `.csv`

### Build script

`scripts/build_data.py`:

- reads and normalizes recommendations (`oui/non/liberté de vote/neutre/pas de position`);
- merges complementary historical sheets (`JLR`, `PRD-PLS`);
- enriches each object with BK official URL;
- refreshes recent official BK results (`yesPercent`, `noPercent`, `result`);
- recomputes recommendation outcome alignment (`won/lost`) for yes/no recommendations;
- writes `data/votes.json` consumed by the frontend.

If BK is temporarily unavailable, the script falls back to local BK link cache (`data/source/bk-objects-links.json`).

## Project structure

- `index.html`, `styles.css`, `app.js`: static frontend.
- `data/source/recommandations-de-vote-des-partis.xlsx`: raw source file.
- `data/source/bk-objects-links.json`: BK links cache.
- `data/votes.json`: generated dataset used by the app.
- `scripts/build_data.py`: dataset generation and enrichment.
- `scripts/is_votation_sunday.py`: BK voting-day check.
- `.github/workflows/deploy-pages.yml`: GitHub Pages deployment.
- `.github/workflows/build-data.yml`: dataset consistency check.
- `.github/workflows/bk-results-refresh.yml`: scheduled BK refresh.

## Run locally

```bash
cd /Users/arnaudbonvin/Documents/SwitzerlandVote
python3 -m http.server 8000
```

Open [http://localhost:8000](http://localhost:8000).

## Update data manually

1. Replace the source file:
   - `data/source/recommandations-de-vote-des-partis.xlsx`
2. Regenerate dataset:

```bash
./scripts/build_data.py --input data/source/recommandations-de-vote-des-partis.xlsx --output data/votes.json
```

Optional: force refresh of recent official BK results:

```bash
./scripts/build_data.py \
  --input data/source/recommandations-de-vote-des-partis.xlsx \
  --output data/votes.json \
  --refresh-bk-results \
  --recent-year-window 2
```

3. Commit and push to `main`.

GitHub Pages redeploys automatically.

## Voting Sunday automation

Workflow: `.github/workflows/bk-results-refresh.yml`

- Scheduled every Sunday at `18:30` and `20:30` UTC.
- Checks whether the date is an official federal voting day (BK calendar + chronology).
- If yes (or if manually triggered), refreshes `data/votes.json` + BK link cache, then commits and pushes.
- Push to `main` triggers GitHub Pages deployment.

## Notes on source format

Both Excel and CSV are supported, but **Excel is recommended** for this project because it preserves sheet structure and reduces column-collision issues.
