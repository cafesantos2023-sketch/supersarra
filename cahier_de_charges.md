
Cahier des Charges — Projet "Super Sarra"


1. Présentation du Projet

Le projet Super Sarra vise à concevoir un agent de bureau incarné en 3D (format .vrm), combinant les capacités d'analyse visuelle et audio en temps réel de l'application Windows Google App (propulsée par Gemini 3.8) [1.14] et l'utilité productive d'un environnement de programmation assisté (type OpenCode).
L'application cible une fluidité humaine maximale (latence minimale grâce à l'audio-à-audio direct) et se positionne comme un compagnon d'ingénierie et de vie, inspirant confiance, sécurité et chaleur.

2. Spécifications Fonctionnelles


A. Le Pilier Visuel : Vision d'Écran et Multimodalité (Style Google App)

• Déclenchement Déterministe : L'utilisateur dispose d'un bouton physique persistant Screen 1 sur l'interface flottante et au sein de l'IDE.
• Capture Non-Bloquante : L'activation du bouton lance instantanément une capture d'écran via PowerShell (System.Drawing) sans bloquer le thread d'affichage d'Electron.
• Analyse Contextuelle : L'image capturée est convertie en Base64 et poussée vers le modèle de vision gemini-3.8-flash. L'IA peut corréler ce qu'elle voit à l'écran (un bug dans un navigateur, une vidéo, un schéma) avec le code présent dans son éditeur.

B. Le Pilier Productivité : L'IDE Autonome (Style OpenCode)

• Interface Éditeur : Intégration de l'éditeur Monaco (le moteur de VS Code) par liaison CDN sécurisée au sein d'une fenêtre Electron dédiée (ide.html).
• Exécution en Bac à Sable (Sandbox) : Le code écrit par l'utilisateur ou suggéré par Sarra est exécuté dans un processus Python 3.15 distinct. L'agent ne modifie jamais ses propres fichiers sources (main.js, live.js), garantissant une immunité totale contre les crashs d'auto-édition.
• Boucle de Rétroaction des Erreurs : En cas d'échec du code dans le bac à sable, le flux d'erreur (stderr) est automatiquement capturé et envoyé à Sarra. Celle-ci peut alors expliquer oralement l'erreur et proposer une correction directement dans l'éditeur Monaco.

C. Le Pilier Humain : Présence 3D et Empathie

• Modèle Tridimensionnel : Support complet des fichiers d'avatars humanoïdes .vrm (versions sarra7.vrm) avec chargement direct en mémoire locale (~2 Mo).
• Lipsync Audio Temps Réel : Animation labiale calculée dynamiquement sur l'enveloppe et le spectre de fréquence de l'audio sortant de la WebSocket Gemini Live. La bouche réagit instantanément au timbre et à l'intonation du modèle.
• Comportement Chaleureux : Le prompt système impose l'usage d'un ton bienveillant, d'un langage fluide et l'expression d'empathie. Les yeux et les expressions de l'avatar (BlendShapes) se modifient en fonction du contexte de la discussion (ex. sourire lors d'une réussite de script).

3. Contraintes Techniques & Sécurité

• Environnement : Windows 10/11, Electron (Architecture multi-processus native).
• Langages : JavaScript (ES6 strict pour le frontend et la coque), Python 3.15 (pour l'hôte TTS et l'exécution du bac à sable).
• Sécurité Critique : contextIsolation: true et sandbox: true doivent être maintenus sur toutes les fenêtres Chromium pour empêcher toute injection de code malveillant depuis l'extérieur.
• Performance : L'envoi de captures d'écran et l'analyse de code ne doivent pas saturer la mémoire vive ni créer de micro-coupures (gigue/jitter) sur le flux audio PCM en temps réel de Gemini Live.