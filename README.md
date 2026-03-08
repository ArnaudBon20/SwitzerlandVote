# SwitzerlandVote

Interface web publique, moderne et minimaliste pour consulter les recommandations de vote des partis politiques suisses pour les objets fédéraux depuis 1848.

## Fonctionnalités

- Consultation publique sur GitHub Pages.
- Bloc d'accueil **Archives** avec un résultat tiré au hasard (renouvelé à chaque refresh, bouton `Nouvelle archive`).
- Recherche plein texte sur les objets de votation.
- Filtres par période, résultat, parti et type de recommandation.
- Vue synthétique des partis (alignement gagné/perdu sur la sélection), avec distinction visuelle des partis historiques (PBD, PRD, PLS).
- Fusion automatique des recommandations historiques complémentaires:
  - JLR;
  - Parti radical (PRD);
  - Parti libéral (PLS).
- Lien externe officiel sur chaque objet vers la page correspondante de la Chancellerie fédérale (BK), dans:
  - la liste des objets;
  - le bloc Archives;
  - les classements de l'onglet Statistiques.
- Onglet **Statistiques** avec:
  - votations les plus acceptées;
  - votations les plus refusées;
  - résultats par parti et par législature (découpage électoral officiel, y compris la législature 1917-1919).
- Pipeline de données reproductible à partir du fichier source Excel.
- Mise à jour automatique des résultats et statistiques le soir des dimanches de votation via GitHub Actions (calendrier BK officiel).

## Structure du projet

- `index.html`, `styles.css`, `app.js`: interface web statique.
- `data/source/recommandations-de-vote-des-partis.xlsx`: source brute.
- `data/source/bk-objects-links.json`: cache local des liens officiels BK.
- `scripts/build_data.py`: conversion Excel/CSV vers `data/votes.json` avec:
  - fusion des feuilles `JLR` et `PRD-PLS`;
  - enrichissement des objets avec `url` BK (fetch live + fallback sur cache local);
  - enrichissement automatique des résultats BK récents (`yesPercent`, `noPercent`, `result`);
  - recalcul automatique des statuts `won/perdu` pour les recommandations oui/non;
  - normalisation des recommandations (oui/non/liberté de vote/neutre/pas de position).
- `scripts/is_votation_sunday.py`: vérification de la date de votation selon le calendrier BK officiel.
- `data/votes.json`: base de données consommée par le frontend.
- `.github/workflows/deploy-pages.yml`: publication automatique GitHub Pages.
- `.github/workflows/build-data.yml`: vérification que `data/votes.json` est synchronisé.
- `.github/workflows/bk-results-refresh.yml`: rafraîchissement automatique des résultats BK les soirs de votation.

## Lancer localement

```bash
cd /Users/arnaudbonvin/Documents/SwitzerlandVote
python3 -m http.server 8000
```

Puis ouvrir `http://localhost:8000`.

## Mettre à jour les données

1. Remplacer le fichier source:
   - `data/source/recommandations-de-vote-des-partis.xlsx`
2. Régénérer la base JSON:

```bash
./scripts/build_data.py --input data/source/recommandations-de-vote-des-partis.xlsx --output data/votes.json
```

Pour forcer le rafraîchissement des résultats officiels BK récents:

```bash
./scripts/build_data.py \
  --input data/source/recommandations-de-vote-des-partis.xlsx \
  --output data/votes.json \
  --refresh-bk-results \
  --recent-year-window 2
```

3. Commit + push sur `main`.

Le workflow GitHub Pages republie automatiquement le site.

Notes:

- La génération tente de récupérer les liens BK en ligne et met à jour `data/source/bk-objects-links.json`.
- Si le réseau est indisponible, le script utilise automatiquement le cache local BK existant.

## Automatisation du soir de votation

- Le workflow `.github/workflows/bk-results-refresh.yml` tourne chaque dimanche soir (`18:30` et `20:30` UTC).
- Avant toute mise à jour, il vérifie la date du jour (timezone `Europe/Zurich`) via le calendrier BK et le répertoire chronologique BK.
- Si oui, il régénère `data/votes.json` avec les résultats BK publiés, commit et push sur `main`.
- Le push déclenche ensuite automatiquement la publication GitHub Pages.

## Ajouter rapidement de nouveaux objets de votation

Option recommandée:

1. Ajouter les nouveaux objets directement dans l'Excel source.
2. Lancer la commande de génération ci-dessus.
3. Push sur `main`.

Le script conserve automatiquement les objets sans résultat officiel comme `À venir`.

## Créer le dépôt GitHub (compte personnel)

Si nécessaire, ré-authentifier GitHub CLI:

```bash
gh auth login -h github.com
```

Puis créer et pousser le dépôt public:

```bash
git init
git add .
git commit -m "Initial commit: SwitzerlandVote"
gh repo create SwitzerlandVote --public --source=. --remote=origin --push
```

## Source Excel ou CSV?

Le script accepte les deux (`.xlsx` et `.csv`).
Pour votre cas actuel, le format Excel est préférable car il préserve mieux la structure d'origine et évite les collisions de colonnes dupliquées.
