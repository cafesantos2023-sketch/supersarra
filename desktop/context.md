# Contexte du projet Sarra Desktop

## Objectif et interface

Sarra est un overlay Windows Electron pour un avatar VRM humanoïde, accompagné
d'une fenêtre de réglages séparée. La tête seule est affichée par défaut et
animée au repos comme pendant la parole : respiration discrète, mouvements de
tête, regards et clignements irréguliers. Un VRM choisi dans les réglages est
transmis à la fenêtre avatar et y remplace le modèle actif.

Le panneau met en avant la conversation directe Gemini Live (audio → audio),
la génération de réponses Gemini à prononcer, et le réglage automatique du
lipsync. En mode vocal direct, le lipsync suit l'audio du modèle, sans
transcription. Pour le texte, Edge TTS transmet les repères réels des mots ; les
voix Windows compatibles émettent les événements Qt `sayingWord` avec les
offsets de caractères. Les options expertes restent accessibles, mais les
anciens outils de calibration par caméra ont été retirés. La page recale les
visèmes au début des mots et adapte leur vitesse intra-mot d'après les
intervalles mesurés. Google TTS n'ayant pas ici
de repères exploitables, sa synchronisation reste estimée par le texte, le
débit, la durée audio et son enveloppe. Le réglage automatique mesure le débit
de la voix locale et la géométrie des morphs VRM. Aucun moteur ne donne un
alignement phonème complet ; une synchronisation parfaite ne peut pas être
promise.

## Structure

- `main.js` : processus principal Electron, serveur HTTP local (ports 8642 à
  8660), fenêtres, IPC, raccourci global, zone de notification et démarrage
  vocal.
- `preload.js` : API `sarraDesktop` exposée avec isolation du contexte.
- `live.js` : session WebSocket Gemini Live audio → audio, reprise de session
  et limites de quota.
- `shell.html` : coque transparente qui charge l'avatar dans une iframe.
- `tts/tts_host.py` : hôte Python/PyQt6 pour les voix Windows, normalement
  accessible sur `127.0.0.1:8649`.
- `vendor/electron/` : version Electron embarquée ; aucune installation npm
  n'est nécessaire.
- `assets/` et `screenshots/` : ressources graphiques et captures.
- `start.bat` : raccourci de compatibilité vers le lanceur canonique
  `..\start.bat`.

Le HTML principal et le modèle VRM sont dans le dossier parent. `main.js`
résout leurs chemins par rapport à ce dossier.

## Lancement

Utiliser `..\start.bat` depuis la racine du projet, ou `start.bat` depuis ce
dossier. Le lanceur canonique :

1. cherche `pythonw` puis `python` et démarre l'hôte vocal séparément
   d'Electron afin que les voix Windows soient disponibles ;
2. démarre l'Electron embarqué avec `--no-sandbox` ;
3. attend une réponse HTTP 200 contenant la page Sarra sur un port de 8642 à
   8660, puis écrit le résultat dans `start.log` ;
4. lance le mode navigateur de repli uniquement si Electron est absent ou ne
   peut pas être exécuté. En cas d'échec du serveur Electron, le lancement
   s'arrête explicitement : le mode navigateur ne possède pas le pont IPC des
   tests audio en ligne ni les fenêtres flottantes.

Avant de démarrer l'hôte vocal, il repère une instance Sarra lancée depuis
l'Electron embarqué de ce projet. Si elle existe, le lanceur demande de la
fermer depuis l'icône Sarra de la zone de notification, puis de réessayer.
Il ne termine pas de processus et ne prétend pas recharger une instance déjà
ouverte ; après sa fermeture, il reprend le démarrage normal.

Le serveur essaie les ports 8642 à 8660 ; il passe au suivant si Windows
occupe ou interdit un port (`EADDRINUSE` ou `EACCES`). Une erreur
d'initialisation ferme Electron plutôt que de laisser un processus sans
fenêtre ni serveur.

Si Python ou PyQt6 est indisponible, Electron tente son propre démarrage vocal
de repli ; l'avatar peut s'afficher sans voix Windows. Ne pas lancer un second
hôte vocal manuellement en parallèle du lanceur.

- `Ctrl+Shift+K` ouvre ou ferme les réglages.
- Le panneau de réglages est caché au démarrage, y compris lorsqu'une seconde
  instance est lancée ; il n'est même pas créé avant sa première ouverture
  avec le raccourci global. Ce raccourci ouvre/ferme l'unique panneau de
  configuration.
- Les réglages des fournisseurs IA, des directives et des options de voix
  (moteur, clé, enregistrement et essai) sont rassemblés dans le panneau.
- Avatar et réglages utilisent le niveau Electron `screen-saver` et réappliquent
  le premier plan après affichage/reprise du focus. L'avatar est la fenêtre
  native transparente contenant `shell.html`, lui-même une iframe plein cadre
  au fond transparent.
- L'avatar peut être déplacé et redimensionné à la molette.
- L'avatar et la fenêtre Réglages restent au premier plan.
- Les positions et tailles sont enregistrées dans `state.json`.
- Les arguments supplémentaires du lanceur sont transmis à Electron ;
  `--smoke` active son test intégré.

`--no-sandbox` est conservé pour l'environnement cible ; ne pas charger de
contenu web non fiable dans cette application.

## Journaux et validation

- `start.log` : lancement Electron et vérification du serveur.
- `boot.log` : démarrage du processus principal, serveur et fenêtres.
- `tts-host.log` : hôte vocal et erreurs de synthèse.
- `desktop/_smoke/report.json` : rapport du test intégré.

Le smoke test peut effectuer des appels réseau et modifier le profil
`localStorage`. Le lancer dans une copie isolée du projet, pas sur le profil
utilisé au quotidien. Les anciennes vérifications du catalogue IA dans le
smoke test ne correspondent plus à l'interface et ne doivent pas être
interprétées comme des régressions de l'avatar.

## Conversation vocale directe (Gemini Live)

- Le bouton « Parler à Sarra », au bas-centre de l'avatar, ouvre une session
  WebSocket Gemini Live via `desktop/live.js`. L'audio du microphone est
  envoyé en PCM16 mono 16 kHz et la voix du modèle revient en PCM16 24 kHz,
  lue par Web Audio. Aucun enregistrement WAV, aucune transcription STT et
  aucun TTS séparé ne sont utilisés.
- Modèle par défaut `gemini-3.8-live`, voix `Kore`. Le modèle et la voix sont
  persistés dans `sarra.liveModel` et `sarra.liveVoice`. Un repli automatique
  sur `gemini-3.1-flash-live-preview` est tenté si le modèle demandé n'est pas
  exposé à la clé.
- La clé Gemini reste dans le processus principal. La page utilise seulement
  `sarra:live-start`, `sarra:live-audio`, `sarra:live-audio-end`,
  `sarra:live-stop` et l'événement `sarra:live-event`.
- Pour préserver le quota gratuit : détection locale d'activité vocale (seuls
  les segments de voix sont envoyés), aucune transcription d'entrée ou de
  sortie, fermeture après 3 minutes de silence, compression du contexte et
  reprise automatique via `sessionResumption` lors d'une coupure réseau.
- Le lipsync est calculé directement sur l'enveloppe et le spectre de l'audio
  de sortie : aucun texte intermédiaire n'est nécessaire.
- Le raisonnement écrit utilise `gemini-3.8-flash` (repli `gemini-2.5-flash`)
  via `sarra:ai-generate`. La synthèse pour le texte utilise
  `gemini-3.8-flash-lite-tts` (API Interactions), avec repli sur
  `gemini-3.1-flash-tts-preview` puis `gemini-2.5-flash-preview-tts`.
- Les fonctions STT (`sarra:ai-transcribe`) restent dans le processus principal
  pour compatibilité, mais ne sont plus appelées par le bouton vocal.
- Les erreurs de connexion, de quota, de facturation ou de clé sont affichées
  sous le bouton ; une erreur de facturation / free tier arrête la session sans
  reconnexion. Aucun repli silencieux vers une transcription n'est effectué.

## Thème et préférences

- Le thème clair/sombre s'applique à l'interface et est stocké sous
  `localStorage['sarra.theme']`. Le thème initial suit la préférence système
  si aucun choix n'a encore été mémorisé.
- L'éditeur de directives permet de sélectionner un modèle, de suivre la
  limite de caractères, de sauvegarder, de réinitialiser et de tester une
  directive avec le fournisseur choisi.

## Dépannage et modifications

1. Lire `start.log`, puis `boot.log` pour repérer l'étape du démarrage.
2. Tester `http://127.0.0.1:8642/` ; le serveur peut utiliser un port jusqu'à
   8660 si le précédent est occupé.
3. Consulter `tts-host.log` si l'avatar est muet ; vérifier Python, PyQt6 et
   la disponibilité d'une voix Windows.
4. Si une fenêtre ou le raccourci manque, vérifier le verrou de l'instance
   unique et les erreurs du processus Electron.

Conserver les chemins relatifs, l'isolation Electron et le lanceur canonique
à la racine. Après toute modification du démarrage, vérifier le journal et
qu'une réponse HTTP Sarra est disponible ; ne pas considérer la présence d'un
processus `electron.exe` quelconque comme une preuve de démarrage réussi.
