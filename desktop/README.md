# Sarra — overlay de bureau (Electron)

Cette coque transforme l'application web Sarra en **deux fenêtres Windows natives** :

1. **Avatar** : une fenêtre **sans cadre**, **transparente**, **flottante**, **déplaçable à la souris** et **toujours au-dessus des fenêtres Windows ordinaires**. Elle contient une **iframe** (`shell.html`) qui affiche la tête de l'avatar VRM par défaut. Le niveau de premier plan est réappliqué lorsque la fenêtre est affichée ou reprend le focus.
2. **Réglages** : un seul panneau **déplaçable** et **redimensionnable**, lui aussi au-dessus des fenêtres ordinaires. Il n'est créé qu'à sa première ouverture, avec **Ctrl+Shift+K**, puis ce même raccourci l'affiche ou le cache. Les réglages Gemini/Groq, le choix de la voix de synthèse, ses clés et son essai sont regroupés dans la section **Voix de synthèse et moteurs IA**.

L'application web d'origine reste utilisable telle quelle dans un navigateur : le fichier `start-browser.bat` (serveur `server.ps1` + `open.ps1`) sert de repli si Electron est absent ou bloqué.

## Lancer

Double-cliquez sur **`start.bat`** à la racine du projet. Il démarre Electron,
qui sert les fichiers sur `http://127.0.0.1:8642` (port suivant si occupé ou
réservé par Windows),
ouvre l'avatar et démarre l'hôte vocal Python si disponible. Le lanceur attend
que le serveur réponde et écrit le résultat dans **`start.log`**. Si Electron
quitte avant que le serveur soit prêt, ou si le délai d'attente expire, le
lanceur signale l'échec et garde la fenêtre ouverte pour consulter le message.
Si Electron ne démarre pas son serveur, le lanceur ne bascule pas vers le
navigateur : le navigateur ne dispose pas du pont IPC nécessaire aux voix en
ligne ni à l'avatar flottant.
Le lancement utilise `--no-sandbox`, nécessaire dans cet environnement où
Electron quitte immédiatement sans cette option. Cela réduit l'isolation
Chromium ; ne lancez pas dans Sarra de contenu web non fiable.

## Utilisation

| Action | Comment |
|---|---|
| Déplacer l'avatar | Glisser l'avatar à la souris |
| Redimensionner l'avatar | Molette au-dessus de l'avatar |
| Ouvrir/fermer les réglages | **Ctrl+Shift+K** (raccourci global, fonctionne même si une autre application a le focus ; caché au démarrage) |
| Déplacer les réglages | Glisser la barre du haut, ou la poignée **⣿** à gauche |
| Redimensionner les réglages | Coin inférieur droit (poignée dédiée) ou bords de la fenêtre |
| Fermer les réglages | Bouton **Fermer**, **Échap**, ou re-**Ctrl+Shift+K** |
| Menu de l'avatar | **Clic droit** sur l'avatar (réglages, masquer, quitter) |
| Ouvrir les réglages rapidement | **Double-clic** sur l'avatar |
| Quitter complètement | Icône de la zone de notification → **Quitter Sarra** |

Les positions/tailles des deux fenêtres sont mémorisées dans `desktop/state.json`.

## Voix (important)

Chromium/Electron **ne fournit aucune voix** à `speechSynthesis`. L'overlay utilise donc un petit hôte **Python + PyQt6 + QTextToSpeech** (voix Windows) :

- lancé par `start.bat` **avant** Electron, il écoute sur `127.0.0.1:8649` ;
- les repères de mots sont envoyés par une file d'écriture dédiée afin que
  l'envoi TCP ne bloque pas le thread audio Qt ;
- il s'arrête automatiquement quand Electron se ferme ;
- si vous lancez Electron directement, l'application tente de démarrer l'hôte elle-même (repli) ;
- si Python/PyQt6 est absent, l'avatar s'affiche mais reste muet.

Prérequis : Python 3.11+ avec `PyQt6` (`pip install PyQt6`). Le journal se trouve dans `desktop/tts-host.log`.

## Profil de lipsync par défaut

Les boutons **↩️ Revenir au défaut** et **🗑️ Réinitialiser à l’usine** utilisent
le profil calibré partagé : gain global **1,1**, attaque **29 ms**, relâchement
**35 ms**, fermeture **31 ms**, maintien **21 ms**, bouche au repos **0,025**,
micro-variations **0,06**, gains voyelles **0,476**, gains consonnes **0,432**,
gain mâchoire **0,681**, angle maximal **9,073°**, vitesse de parole **0,9** et
débit labial **14 caractères/s**. Les poids par phonème et par morph sont
également définis par ce profil dans l'application.

**Revenir au défaut** recharge le dernier profil enregistré avec « Enregistrer
comme défaut ». Après migration, ce défaut correspond au profil calibré
ci-dessus ; un profil enregistré ensuite peut rester personnalisé.
**Réinitialiser à l'usine** remplace le profil actif et le défaut enregistré par
ce même profil. Un réglage actif personnalisé est conservé lors de la migration.
Les valeurs antérieures sont sauvegardées dans `lipcfg_backup`,
`lipdef_backup` et `lipcalib_backup`.

## Avatar et synchronisation

L’avatar démarre désormais en **cadrage tête seule**. Les anciens profils sont
migrés une seule fois vers ce cadrage ; le choix fait ensuite dans les options
d’affichage est conservé. Un fichier VRM choisi depuis les réglages est validé,
chargé dans la fenêtre flottante et son résultat est annoncé dans le panneau.
Une respiration légère, des mouvements discrets de tête, des regards qui se
déplacent et des clignements irréguliers animent le repos et la parole.

Le lipsync utilise les repères temporels de mots fournis par Edge TTS et par
les voix Windows compatibles (événements `sayingWord` de Qt) pour recaler les
visèmes au début de chaque mot et adapter leur vitesse en cours de phrase.
Pour Edge TTS, la piste audio et ses repères sont générés dans la même requête.
Google TTS ne fournit pas ici de repères exploitables : sa synchronisation
reste estimée à partir du texte, du débit et de la durée réelle de l'audio.
Le bouton **Réglage Auto** mesure aussi le débit de la voix locale et calibre
les gains de morphs selon la géométrie du modèle VRM. L'alignement reste une
estimation à l'intérieur des mots, faute de repères phonème par phonème ; une
synchronisation parfaite ne peut donc pas être garantie.

## Voix de synthèse

La section « Choisir une voix de synthèse » conserve les moteurs réellement
utilisés par l’avatar :

| Voix | Clé | Notes |
|---|---|---|
| **Windows (local)** | aucune | 3 voix SAPI/OneCore (Hortense, Julie, Paul), hors ligne |
| **Google Translate TTS** | aucune | Voix française, service non officiel, réseau requis |
| **Microsoft Edge TTS** | aucune | 100+ voix neuronales ; nécessite `pip install edge-tts` dans le Python utilisé |
| **ElevenLabs** | oui (offre gratuite) | Lien « Obtenir une clé » → `elevenlabs.io/app/settings/api-keys` |

Le bouton d’essai joue un court échantillon. Les clés ElevenLabs, Gemini et
Groq sont enregistrées dans le `localStorage` du profil Electron
(`sarra.apiKeys`) ; elles ne sont pas chiffrées par l’application. Le moteur
vocal est mémorisé dans `sarra.voiceEngine`.

## Réponses IA à prononcer

La section **IA : Gemini / Groq**, ouverte par défaut dans le panneau, permet de choisir **Désactivé**, **Gemini**
ou **Groq**, et donne les liens officiels pour créer les clés :

- Gemini : [Google AI Studio](https://aistudio.google.com/app/apikey)
- Groq : [GroqCloud](https://console.groq.com/keys)

Quand un moteur IA est activé, le texte saisi dans le champ principal est
utilisé comme demande. **Parler** envoie cette demande au fournisseur choisi,
affiche la réponse générée dans le champ, puis la fait lire par la voix de
synthèse sélectionnée. Sans moteur IA, le texte saisi est prononcé directement
comme auparavant. Une erreur de génération est affichée et ne déclenche pas de
lecture de remplacement.

La requête IA passe par le processus principal Electron ; la clé n’est pas
envoyée par le navigateur directement au fournisseur. Gemini utilise
`gemini-2.5-flash` et Groq `llama-3.3-70b-versatile`. Le bouton **Tester la
clé** vérifie l’accès au compte. Les services nécessitent Internet et peuvent
appliquer leurs propres quotas ou tarifs. Cette intégration traite chaque
demande séparément, sans historique de conversation.

## Réglages : migration depuis le navigateur

Le profil Electron est séparé de celui de Chrome/Edge : les réglages `localStorage`
(lipsync, affichage, voix, etc.) **ne sont pas repris automatiquement**.
Pour les récupérer :

1. dans l'ancienne version navigateur, ouvrir les réglages et cliquer **Exporter** (le JSON est copié) ;
2. dans la fenêtre Réglages de l'overlay, coller le JSON dans la zone de texte et cliquer **Importer**.

## Fichiers

```
start.bat                     lanceur (hôte vocal + Electron + journal start.log)
start-browser.bat             ancien mode navigateur (repli)
desktop/
  main.js                     processus principal : serveur local, fenêtres, IPC, TTS, tray
  preload.js                  API sarraDesktop exposée aux pages
  shell.html                  page transparente avec l'iframe de l'avatar
  package.json                application Electron
  tts/tts_host.py             hôte vocal Python/Qt (TCP 8649 ou stdin/stdout)
  assets/tray.png             icône de la zone de notification
  screenshots/                captures de l'avatar et du panneau
  vendor/electron/            Electron 40.10.2 (win32-x64), embarqué
Sarra — avatar VRM & lipsync avancé.html
                              application web + intégration `?shell=avatar|settings`
```

## Développement / test

Un mode `--smoke` vérifie automatiquement : chargement du VRM, Ctrl+Shift+K,
redimensionnement, déplacement des deux fenêtres, événements vocaux et captures.

```powershell
# Hôte vocal (voix Windows)
Start-Process C:\Python315\pythonw.exe -ArgumentList 'desktop\tts\tts_host.py','--port','8649','--log','desktop\tts-host.log'
# Test (dans un environnement Windows normal)
desktop\vendor\electron\electron.exe desktop --smoke
```

Dans le bac à sable DSH, Electron doit être lancé hors bac à sable et avec
`--no-sandbox` (les canaux IPC de Chromium sont bloqués par le bac à sable) ;
ce n'est **pas** nécessaire pour l'utilisateur final.

## Dépannage — « start.bat ne fait rien »

1. Ouvrir **`start.log`** pour voir si Electron s'est arrêté ou si le serveur n'a pas répondu à temps.
2. Si Electron s'est arrêté, vérifier l'antivirus / SmartScreen et autoriser `vendor/electron/electron.exe` si nécessaire.
3. Si le serveur est prêt mais qu'aucune fenêtre n'est visible, regarder la zone de notification (icône Sarra) et **`boot.log`**.
4. Si Python ou PyQt6 est indisponible, l'avatar doit quand même s'afficher ; seule la voix Windows est désactivée.

Le lanceur neutralise `ELECTRON_RUN_AS_NODE`, utilise `--no-sandbox` pour
contourner le plantage observé au démarrage et arrête l'attente si Electron
quitte avant que le serveur soit prêt.

## Limites connues

- « Toujours au-dessus » = fenêtre Windows `HWND_TOPMOST`. Une autre fenêtre
  explicitement topmost peut passer au-dessus, et un jeu en plein écran exclusif
  peut recouvrir l'overlay.
- Les zones transparentes de la fenêtre avatar restent cliquables (pas de
  click-through) ; la fenêtre est volontairement compacte.
- Le panneau Réglages est un panneau de configuration : la bouche de l'avatar
  est pilotée par la fenêtre avatar, les changements sont synchronisés en direct.
