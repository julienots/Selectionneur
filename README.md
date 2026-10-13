# ⚽ Sélectionneur — manager de foot 3D

Dirigez l'équipe de France (et votre club de ville), composez votre onze, choisissez votre tactique…
puis vivez chaque match **en direct dans un stade 3D** : 30 000 supporters, projecteurs, écrans
géants, joueurs animés, caméras façon retransmission TV.

## 📱 Installer l'APK sur Android

1. Sur le téléphone, ouvrez la page **Releases** du dépôt (colonne de droite sur GitHub).
2. Téléchargez `Selectionneur-v5.0.0.apk` dans la release la plus récente.
3. Ouvrez le fichier et autorisez « l'installation d'applications inconnues » si Android le demande.

Les nouvelles versions s'installent **par-dessus** l'ancienne (même signature) : la sauvegarde est conservée.

L'APK est compilé automatiquement par GitHub Actions à chaque push
(onglet **Actions** → « APK Android »).

## 🎮 Jouer le match (1re personne)

Avant un match, touchez **« 🎮 Jouer le match »** : vous contrôlez un joueur pendant tout le match
dans le stade 3D, les 21 autres sont pilotés par l'IA, et le score vient de ce qui se passe sur la
pelouse.

| Commande | Effet |
| --- | --- |
| Joystick | Avancer / tourner (poussé à fond : sprint) |
| PASSE / CHANGER | Passe au partenaire visé · sans ballon : prendre le joueur le plus proche du ballon |
| TIR / TACLE | Maintenir pour doser la puissance, la direction du joueur vise · sans ballon : tacle |
| DRIBBLE | Crochet, passement de jambes ou roulette |
| 👁 / ⏸ | Vue 1re personne, 3e personne ou TV · pause |

Sur ordinateur : flèches ou ZQSD, Espace (passe), J (tir), K (dribble), V (vue), P (pause).

## 🎮 Pendant le match

| Bouton | Effet |
| --- | --- |
| 🎥 | Change de caméra : TV, Proche, Tactique (2.5D), Tribune, Drone |
| ▶ | Rythme du match : Rapide, Normal, Réaliste |
| ⛶ | Plein écran (tournez le téléphone pour le paysage) |
| 2D | Revient au terrain 2D classique (bouton « 🎥 Vue 3D » pour repasser en 3D) |

## 🛠️ Développement

```bash
npm install          # Capacitor, three.js, polices
npm run vendor       # copie three.js et les polices dans www/
npm run check        # vérifie la syntaxe JS du jeu
npm run serve        # joue dans le navigateur : http://localhost:8080
npm run standalone   # dist/selectionneur_v42.html : le jeu en un seul fichier HTML
npm run apk          # APK local (nécessite le SDK Android)
```

| Fichier | Rôle |
| --- | --- |
| `www/index.html` | Le jeu (interface + logique). Le guide de reprise et le changelog sont en tête de fichier. |
| `www/js/stade3d.js` | Le moteur 3D du match en direct (lecture seule de l'état du match). |
| `android/` | Projet Android (Capacitor). |
| `scripts/make_icons.py` | Génère les icônes et l'écran de démarrage. |
