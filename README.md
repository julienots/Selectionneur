# ⚽ Sélectionneur — le match se joue depuis le banc (2.5D)

Dirigez l'équipe de France (et votre club de ville), composez votre onze, choisissez votre tactique…
puis **vivez chaque match depuis la zone technique** : vous ne contrôlez aucun joueur, les 22 sont
pilotés par l'IA en temps réel dans un stade en 2.5D, et ce sont VOS consignes qui changent le match.

## 📱 Installer l'APK sur Android

1. Sur le téléphone, ouvrez la page **Releases** du dépôt (colonne de droite sur GitHub).
2. Téléchargez `Selectionneur-v5.2.0.apk` dans la release la plus récente.
3. Ouvrez le fichier et autorisez « l'installation d'applications inconnues » si Android le demande.

Les nouvelles versions s'installent **par-dessus** l'ancienne (même signature) : la sauvegarde est conservée.

L'APK est compilé automatiquement par GitHub Actions à chaque push
(onglet **Actions** → « APK Android »).

## 📋 Diriger le match (zone technique)

Pendant le match, la barre en bas du stade donne accès à la zone technique :

| Commande | Effet |
| --- | --- |
| 📋 Consignes | Mentalité (Bus → Tout attaque), pressing, ligne défensive, tempo, largeur : l'IA de vos joueurs change aussitôt |
| 📣 / 🧠 / 🤚 | Cris depuis le bord du terrain (« On pousse », « Concentration », « On calme le jeu ») : effet de 6 min, rechargement 9 min |
| ⚡ | Énergie de l'équipe : le pressing haut et le tempo vertical fatiguent, une équipe cuite court moins et perd ses duels |
| 🔄 | Remplacements (le remplaçant entre aussi sur la pelouse 3D) |
| Mi-temps | Causerie de vestiaire et changement de style pour la 2e période |

L'adversaire a aussi son entraîneur : il pousse quand il est mené et ferme le jeu quand il mène.

## 🎥 Caméras et rendu

| Bouton | Effet |
| --- | --- |
| 🎥 | 2.5D (vue maquette, par défaut), TV, Tactique, Proche, Tribune, Drone |
| ▶ | Rythme du match : Rapide, Normal, Réaliste |
| ⛶ | Plein écran (tournez le téléphone pour le paysage) |

Rendu : three.js 0.187, pelouse en shader (tonte qui change avec le point de vue, pluie), éclairage
PBR, bloom des projecteurs, étalonnage TV, grain, flou de bascule en 2.5D, occlusion ambiante en
qualité Ultra (Réglages → Qualité 3D ; « Économie » coupe le post-traitement pour les petits téléphones).

## 🛠️ Développement

```bash
npm install          # Capacitor, three.js, esbuild, polices
npm run vendor       # compile three.js + post-traitement (esbuild) et copie les polices dans www/
npm run check        # vérifie la syntaxe JS du jeu
npm run serve        # joue dans le navigateur : http://localhost:8080
npm run standalone   # dist/selectionneur_v52.html : le jeu en un seul fichier HTML
npm run apk          # APK local (nécessite le SDK Android)
```

| Fichier | Rôle |
| --- | --- |
| `www/index.html` | Le jeu (interface + logique). Le guide de reprise et le changelog sont en tête de fichier. |
| `www/js/stade3d.js` | Le moteur 3D du match en direct : simulation temps réel (IA), zone technique, caméras, shaders. |
| `scripts/three-entry.mjs` | Modules three.js embarqués dans `www/vendor/three.min.js`. |
| `android/` | Projet Android (Capacitor). |
| `scripts/make_icons.py` | Génère les icônes et l'écran de démarrage. |
