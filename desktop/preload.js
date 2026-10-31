'use strict';

// Preload des fenêtres Electron de Sarra.
// Expose une API minimale au monde de la page (contexte isolé) : l'avatar est
// chargé dans une iframe de la page « shell », qui relaie cette API via
// window.__sarraBridge ; la fenêtre Réglages l'utilise directement.

const { contextBridge, ipcRenderer } = require('electron');

const ttsHandlers = new Set();
const aiTokenHandlers = new Set();
const liveHandlers = new Set();
// --- Espace de développement (IDE) -----------------------------------------
const ideLogHandlers = new Set();
const screenCaptureHandlers = new Set();
let idePollContentHandler = null;
let pendingScreenCapture = null;
ipcRenderer.on('sarra:ide-log', (_event, data) => {
  for (const handler of [...ideLogHandlers]) {
    try { handler(data); } catch (_error) { ideLogHandlers.delete(handler); }
  }
});
ipcRenderer.on('sarra:screen-captured', (_event, data) => {
  if (screenCaptureHandlers.size === 0) {
    pendingScreenCapture = data;
    return;
  }
  for (const handler of [...screenCaptureHandlers]) {
    try { handler(data); } catch (_error) { screenCaptureHandlers.delete(handler); }
  }
});
ipcRenderer.on('sarra:ide-poll-content', (_event, payload) => {
  if (typeof idePollContentHandler === 'function') {
    try {
      const content = idePollContentHandler(payload);
      ipcRenderer.send('sarra:ide-content-response', {
        requestId: payload && payload.requestId,
        content: String(content || ''),
      });
    } catch (_error) {
      /* ignore — l’éditeur n’est pas encore prêt */
    }
  }
});
ipcRenderer.on('sarra:live-event', (_event, data) => {
  for (const handler of [...liveHandlers]) {
    try { handler(data); } catch (_error) { liveHandlers.delete(handler); }
  }
});
ipcRenderer.on('sarra:ai-token', (_event, data) => {
  for (const handler of [...aiTokenHandlers]) {
    try { handler(data); } catch (_error) { aiTokenHandlers.delete(handler); }
  }
});
const vrmLoadHandlers = new Set();
const vrmLoadResultHandlers = new Set();
const pendingVrmLoads = [];
ipcRenderer.on('sarra:tts-event', (_event, data) => {
  for (const handler of [...ttsHandlers]) {
    try {
      handler(data);
    } catch (_error) {
      ttsHandlers.delete(handler);
    }
  }
});
ipcRenderer.on('sarra:load-vrm', (_event, payload) => {
  if (vrmLoadHandlers.size === 0) {
    pendingVrmLoads.push(payload);
    return;
  }
  for (const handler of [...vrmLoadHandlers]) handler(payload);
});
ipcRenderer.on('sarra:vrm-load-result', (_event, payload) => {
  for (const handler of [...vrmLoadResultHandlers]) handler(payload);
});

function safeVoices() {
  try {
    const voices = ipcRenderer.sendSync('sarra:voices-sync');
    return Array.isArray(voices) ? voices : [];
  } catch (error) {
    return [];
  }
}

contextBridge.exposeInMainWorld('sarraDesktop', {
  voices: safeVoices(),
  speak: (payload) => ipcRenderer.invoke('sarra:tts-speak', payload),
  ttsAudio: (payload) => ipcRenderer.invoke('sarra:tts-audio', payload),
  testApiKey: (payload) => ipcRenderer.invoke('sarra:test-key', payload),
  generateResponse: (payload) => ipcRenderer.invoke('sarra:ai-generate', payload),
  transcribeAudio: (payload) => ipcRenderer.invoke('sarra:ai-transcribe', payload),
  // Conversation directe Gemini Live : audio → audio, sans transcription.
  liveStart: (payload) => ipcRenderer.invoke('sarra:live-start', payload),
  liveAudio: (payload) => ipcRenderer.send('sarra:live-audio', payload),
  liveAudioEnd: (payload) => ipcRenderer.send('sarra:live-audio-end', payload),
  liveText: (payload) => ipcRenderer.send('sarra:live-text', payload),
  liveStop: (payload) => ipcRenderer.send('sarra:live-stop', payload),
  onLiveEvent: (callback) => { if (typeof callback === 'function') liveHandlers.add(callback); },
  offLiveEvent: (callback) => { liveHandlers.delete(callback); },
  openExternal: (url) => ipcRenderer.send('sarra:open-external', url),
  onAiToken: (callback) => { if (typeof callback === 'function') aiTokenHandlers.add(callback); },
  stop: () => ipcRenderer.send('sarra:tts-stop'),
  onTtsEvent: (callback) => {
    if (typeof callback === 'function') ttsHandlers.add(callback);
  },
  offTtsEvent: (callback) => {
    ttsHandlers.delete(callback);
  },
  // --- IDE ---
  ideChatMessage: (payload) => ipcRenderer.invoke('sarra:ide-chat-message', payload || {}),
  executeIdeCode: (code) => ipcRenderer.invoke('sarra:ide-execute', code),
  ideExecute: (code) => ipcRenderer.invoke('sarra:ide-execute', code),
  ideStop: () => ipcRenderer.invoke('sarra:ide-stop'),
  ideGetContent: () => ipcRenderer.invoke('sarra:ide-get-content'),
  ideOpen: () => ipcRenderer.send('sarra:ide-open'),
  ideClose: () => ipcRenderer.send('sarra:ide-close'),
  ideToggle: () => ipcRenderer.send('sarra:ide-toggle'),
  onIdeLog: (callback) => { if (typeof callback === 'function') ideLogHandlers.add(callback); },
  offIdeLog: (callback) => { ideLogHandlers.delete(callback); },
  onScreenCaptured: (callback) => {
    if (typeof callback !== 'function') return;
    screenCaptureHandlers.add(callback);
    if (pendingScreenCapture) {
      try { callback(pendingScreenCapture); } catch (_error) { screenCaptureHandlers.delete(callback); }
      pendingScreenCapture = null;
    }
  },
  offScreenCaptured: (callback) => { screenCaptureHandlers.delete(callback); },
  ideOnPollContent: (callback) => {
    if (typeof callback === 'function') idePollContentHandler = callback;
  },
  // --- Pont Windows Google App Multimodal (Vision) --------------------------
  captureScreen: () => ipcRenderer.invoke('sarra:capture-screen'),
  dragStart: (point) => ipcRenderer.send('sarra:drag-start', point),
  dragMove: (point) => ipcRenderer.send('sarra:drag-move', point),
  dragEnd: () => ipcRenderer.send('sarra:drag-end'),
  resizeAvatar: (size) => ipcRenderer.send('sarra:resize-avatar', size),
  repositionAvatar: () => ipcRenderer.send('sarra:reposition-avatar'),
  resizeSettings: (size) => ipcRenderer.send('sarra:resize-settings', size),
  settingsDragStart: (point) => ipcRenderer.send('sarra:settings-drag-start', point),
  settingsDragMove: (point) => ipcRenderer.send('sarra:settings-drag-move', point),
  settingsDragEnd: () => ipcRenderer.send('sarra:settings-drag-end'),
  showMenu: () => ipcRenderer.send('sarra:show-menu'),
  toggleSettings: () => ipcRenderer.send('sarra:toggle-settings'),
  closeSettings: () => ipcRenderer.send('sarra:close-settings'),
  loadVrm: (payload) => ipcRenderer.invoke('sarra:load-vrm', payload),
  onVrmLoad: (callback) => {
    if (typeof callback !== 'function') return;
    vrmLoadHandlers.add(callback);
    while (pendingVrmLoads.length) callback(pendingVrmLoads.shift());
  },
  onVrmLoadResult: (callback) => {
    if (typeof callback === 'function') vrmLoadResultHandlers.add(callback);
  },
  vrmLoaded: (payload) => ipcRenderer.send('sarra:vrm-loaded', payload),
  hideAvatar: () => ipcRenderer.send('sarra:hide-avatar'),
  quit: () => ipcRenderer.send('sarra:quit'),
  platform: process.platform,
});
