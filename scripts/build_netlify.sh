#!/usr/bin/env bash
set -euo pipefail

python3 scripts/build_data.py --input data/source/recommandations-de-vote-des-partis.xlsx --output data/votes.json
rm -rf _site
mkdir -p _site/data
cp index.html styles.css theme.css app.js .nojekyll _site/
cp solid-state-proposal.html _site/
cp -R templates _site/templates
cp data/votes.json _site/data/votes.json
