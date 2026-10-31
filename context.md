# Contexte du Projet Sarra VRM Desktop — Version « Super Sarra »

## État courant
Sarra est une application de bureau Windows construite avec Electron. Elle réunit un avatar VRM flottant, Sarra Studio (éditeur Monaco et terminal), une conversation vocale en temps réel et des parcours de chat et de vision déclenchés explicitement.

### Fenêtres et rendu
- `avatarWin` affiche l’avatar dans une fenêtre Electron transparente et toujours au premier plan.
- `ideWin` affiche Sarra Studio au démarrage, à côté de l’avatar. La page est servie par le serveur HTTP local sur `127.0.0.1:8642` à `/desktop/ide.html`; les fichiers `.html` sont servis en `text/html; charset=utf-8`.
- La fenêtre Réglages est indépendante. Le raccourci `Ctrl+Shift+K` ouvre/ferme les réglages; Studio est également disponible via le menu de la zone de notification.
- Les fenêtres définissent `contextIsolation: true`, `nodeIntegration: false` et `sandbox: true`. Les capacités natives passent par `desktop/preload.js` et `contextBridge`.

### Modèles et conversation
- Le parcours vocal utilise Gemini Live par WebSocket dans `desktop/live.js`. Il transporte l’audio et demande également la transcription de sortie pour repérer les blocs Python explicites à transmettre à Monaco. Il n’y a pas de tool calling dans Live.
- Le chat écrit de Sarra Studio et l’analyse visuelle utilisent Gemini Flash via `generateAiResponse` et l’IPC `sarra:ai-generate` ou `sarra:ide-chat-message`.
- La synthèse vocale Windows est pilotée par l’hôte Python/PyQt6 `desktop/tts/tts_host.py`, relié en TCP sur le port 8649.

### Vision et communication entre fenêtres
- Les renderers avatar et Studio communiquent avec `BroadcastChannel('sarra-shell')`.
- Le bouton `Screen 1` de la coque envoie `trigger-screen-capture` avec un identifiant de requête. Studio appelle `window.sarraDesktop.captureScreen()` et renvoie la capture ainsi que le contenu courant de Monaco dans `screen-capture-result`.
- `desktop/main.js` lance PowerShell de façon asynchrone, avec un timeout de 3 secondes, pour écrire `desktop/.tts-tmp/screen_capture.png`. La capture est lue en base64, affichée dans Studio et envoyée à Gemini Flash avec le code de l’éditeur comme contexte. Ce parcours n’arrête et ne mute pas le microphone ni Gemini Live.
- Les réponses contenant un bloc balisé `python` sont publiées en `ide-inject-code` et insérées dans Monaco. Les réponses texte restent affichées dans la coque ou le chat selon leur origine.

### Chat écrit dans Sarra Studio
- La colonne « Discussion avec Sarra » affiche les messages Vous/Sarra et accepte Entrée pour envoyer (Maj+Entrée insère une nouvelle ligne).
- Le preload expose `ideChatMessage`, qui invoque `sarra:ide-chat-message`. Le processus principal vérifie que l’appel vient de `ideWin`, valide les tailles et transmet message, historique et contexte Monaco à Gemini Flash.
- La réponse est affichée dans le fil. Un bloc Python balisé est extrait et injecté dans l’éditeur.

## Fichiers principaux
- `Sarra — avatar VRM & lipsync avancé.html` : moteur WebGL de l’avatar, interface de conversation et pont BroadcastChannel côté avatar.
- `desktop/main.js` : fenêtres Electron, serveur local, capture PowerShell et handlers IPC de génération, chat et exécution IDE.
- `desktop/live.js` : session WebSocket audio Gemini Live et transcription de sortie; aucun outil automatique.
- `desktop/preload.js` : API restreinte exposée par `contextBridge`.
- `desktop/shell.html` : coque de l’avatar et bouton Screen 1.
- `desktop/ide.html` : Sarra Studio, Monaco, terminal, aperçu des captures et chat.
- `desktop/tts/tts_host.py` : hôte de synthèse vocale Windows.

## Exécution du code dans Studio
Le code Monaco est écrit de manière asynchrone dans `desktop/.tts-tmp/sandbox_script.py`, puis lancé avec `child_process.spawn` et l’interpréteur Python résolu par `main.js` (priorité à `SARRA_PYTHON`, `C:\Python315\python.exe`, puis `py -3.15` et `python`). Le processus a un timeout de 15 secondes. Ses flux `stdout` et `stderr` sont envoyés en continu à Studio via `sarra:ide-log`; `sarra:ide-stop` permet de demander son arrêt.

Cette exécution est séparée du processus principal et limitée dans le temps, mais ce n’est pas un sandbox système: le script Python conserve les permissions du compte Windows qui exécute Sarra. Ne pas présenter cette séparation comme une isolation contre du code malveillant.

## Avatar et animation
Le modèle local `sarra7.vrm` est animé dans l’application WebGL. Le lipsync vocal s’appuie sur l’enveloppe et le spectre de l’audio Gemini Live. Les règles de BlendShapes et les expressions émotionnelles décrites dans les notes de conception doivent rester cohérentes avec les morphs réellement disponibles du modèle.
