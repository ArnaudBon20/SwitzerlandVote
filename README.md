# SwitzerlandVote

Interface web publique, moderne et minimaliste pour consulter les recommandations de vote des partis politiques suisses pour les objets fédéraux depuis 1848.

## Fonctionnalités

- Consultation publique sur GitHub Pages.
- Recherche plein texte sur les objets de votation.
- Filtres par période, résultat, parti et type de recommandation.
- Vue synthétique des partis (alignement gagné/perdu sur la sélection).
- Onglet **Statistiques** avec:
  - votations les plus acceptées;
  - votations les plus refusées;
  - résultats par parti et par législature.
- Pipeline de données reproductible à partir du fichier source Excel.

## Structure du projet

- `index.html`, `styles.css`, `app.js`: interface web statique.
- `data/source/recommandations-de-vote-des-partis.xlsx`: source brute.
- `scripts/build_data.py`: conversion Excel/CSV vers `data/votes.json`.
- `data/votes.json`: base de données consommée par le frontend.
- `.github/workflows/deploy-pages.yml`: publication automatique GitHub Pages.
- `.github/workflows/build-data.yml`: vérification que `data/votes.json` est synchronisé.

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

3. Commit + push sur `main`.

Le workflow GitHub Pages republie automatiquement le site.

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
