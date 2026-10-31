# Sarra — conversation directe Gemini Live

## Pipeline actuel
- **Voix** : Gemini Live, audio → audio dans une seule session WebSocket.
  Le microphone envoie du PCM16 mono 16 kHz ; le modèle renvoie du PCM16
  mono 24 kHz lu par Web Audio. Aucune transcription STT, aucun TTS séparé.
- **Raisonnement écrit** : Gemini 3.8 Flash (`gemini-3.8-flash`), avec repli
  automatique sur `gemini-2.5-flash`.
- **Lecture du texte** : Gemini 3.8 Flash-Lite TTS
  (`gemini-3.8-flash-lite-tts`) via l'API Interactions, avec repli sur
  `gemini-3.1-flash-tts-preview` puis `gemini-2.5-flash-preview-tts`.
- **Lipsync** : enveloppe et spectre de l'audio de sortie, sans texte
  intermédiaire.
- **Réponse écrite** : une seule synthèse à la fin de la génération (pas de
  TTS phrase par phrase), pour limiter les appels et éviter les coupures.

## Réglages
- Clé Gemini : `Réglages → Conversation directe → Clé Gemini`.
- Modèle vocal : `gemini-3.8-live` par défaut ; secours
  `gemini-3.1-flash-live-preview`.
- Voix : `Kore` par défaut (autres voix Live disponibles).
- Mode vocal : bouton `🎙 Parler à Sarra`. Parler pendant la réponse
  interrompt Sarra (barge-in) ; le bouton arrête la session.

## Économie de quota
- Détection locale d'activité : seuls les segments de voix sont envoyés.
- Aucune transcription d'entrée ou de sortie activée.
- Session fermée après 3 minutes de silence.
- Reprise automatique (`sessionResumption`) et compression du contexte pour
  les sessions longues.
- Le compteur de tokens de la session est affiché sous le bouton après chaque
  tour.

## Erreurs de facturation
- Si Google répond « free tier is not available for this project », la clé est
  valide mais le projet n'a pas accès au niveau gratuit. Le mode Live, le TTS
  et la génération échouent alors avec un message français.
- Activer la facturation dans Google AI Studio
  (`https://aistudio.google.com/billing`) ou utiliser une clé d'un projet
  éligible.
- Ces erreurs arrêtent la session immédiatement : aucune reconnexion en boucle.

## Fichiers
- `desktop/live.js` : gestionnaire de session Gemini Live (WebSocket,
  setup, audio, reprise, quota).
- `desktop/main.js` : IPC `sarra:live-*`, raisonnement Gemini, TTS.
- `desktop/preload.js` et `desktop/shell.html` : pont sécurisé.
- `Sarra — avatar VRM & lipsync avancé.html` : capture micro, lecture PCM,
  VAD, états du bouton et lipsync audio.
