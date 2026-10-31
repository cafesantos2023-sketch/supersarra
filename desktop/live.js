'use strict';

/**
 * Session vocale directe avec l'API Gemini Live.
 *
 * La conversation ne passe ni par une transcription (STT) ni par une synthèse
 * séparée (TTS) : l'audio du microphone est envoyé dans la session et l'audio
 * du modèle revient dans la même session. Le processus principal garde la clé
 * API hors de l'URL manipulée par la page et sert de relais IPC.
 *
 * Documentation : https://ai.google.dev/gemini-api/docs/live-api
 */

const ENDPOINT =
  'wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent';

const DEFAULT_MODEL = 'gemini-3.8-live';
const FALLBACK_MODELS = ['gemini-3.1-flash-live-preview'];
const DEFAULT_VOICE = 'Kore';
const DEFAULT_INSTRUCTION =
  'Tu es Sarra, une assistante virtuelle chaleureuse et serviable. Réponds naturellement à la conversation audio en français.';

const MODEL_RE = /^[a-z0-9][a-z0-9.\-]{2,80}$/i;
const VOICE_RE = /^[A-Za-z]{2,32}$/;

function normalizeModel(value) {
  const model = String(value || '').trim().replace(/^models\//i, '');
  return MODEL_RE.test(model) ? model : DEFAULT_MODEL;
}

function normalizeVoice(value) {
  const voice = String(value || '').trim();
  return VOICE_RE.test(voice) ? voice : DEFAULT_VOICE;
}

function closeReason(event) {
  let reason = String((event && event.reason) || '').trim();
  if (reason) {
    try {
      const parsed = JSON.parse(reason);
      reason = String(
        (parsed && parsed.error && parsed.error.message)
        || (parsed && parsed.message)
        || reason,
      );
    } catch (_error) {
      /* le serveur peut renvoyer un texte brut */
    }
  }
  if (!reason) {
    const code = event && Number.isFinite(event.code) ? event.code : 0;
    reason = code ? `Connexion fermée (code ${code}).` : 'Connexion Gemini Live fermée.';
  }
  return reason.replace(/\s+/g, ' ').trim().slice(0, 300);
}

async function messageToText(data) {
  if (typeof data === 'string') return data;
  if (Buffer.isBuffer(data)) return data.toString('utf8');
  if (data instanceof ArrayBuffer) return Buffer.from(data).toString('utf8');
  if (ArrayBuffer.isView(data)) return Buffer.from(data.buffer, data.byteOffset, data.byteLength).toString('utf8');
  if (data && typeof data.text === 'function') return String(await data.text());
  return String(data || '');
}

function buildSetup(session) {
  const setup = {
    model: `models/${session.model}`,
    generationConfig: {
      responseModalities: ['AUDIO'],
      speechConfig: {
        voiceConfig: {
          prebuiltVoiceConfig: { voiceName: session.voice },
        },
      },
    },
    outputAudioTranscription: {},
    systemInstruction: {
      parts: [{ text: session.instruction || DEFAULT_INSTRUCTION }],
    },
    realtimeInputConfig: {
      automaticActivityDetection: {
        prefixPaddingMs: 120,
        silenceDurationMs: 600,
      },
    },
    // Session longue : compression du contexte + reprise après une coupure
    // réseau, sans perdre le fil de la conversation.
    contextWindowCompression: { slidingWindow: {} },
    sessionResumption: {},
  };
  if (session.handle) setup.sessionResumption.handle = session.handle;
  return setup;
}

class LiveManager {
  constructor(options = {}) {
    this.WebSocketImpl = options.WebSocket || globalThis.WebSocket;
    this.log = typeof options.log === 'function' ? options.log : () => {};
    this.connectTimeout = Number(options.connectTimeout) || 15000;
    this.maxReconnects = Number.isFinite(options.maxReconnects) ? options.maxReconnects : 4;
    this.sessions = new Map();
    this.counter = 0;
  }

  /**
   * Ouvre une session et attend `setupComplete`.
   * @returns {Promise<{ok:boolean, sessionId?:string, model?:string, voice?:string, error?:string}>}
   */
  async start(config = {}) {
    const key = String(config.key || '').trim();
    if (!key) return { ok: false, error: 'Clé Gemini manquante.' };
    if (!this.WebSocketImpl) {
      return { ok: false, error: 'WebSocket indisponible dans ce processus Electron.' };
    }
    if (config.owner != null) this.stopOwner(config.owner);

    const id = `live-${Date.now().toString(36)}-${++this.counter}`;
    const session = {
      id,
      key,
      owner: config.owner != null ? config.owner : null,
      model: normalizeModel(config.model),
      voice: normalizeVoice(config.voice),
      instruction: String(config.instruction || DEFAULT_INSTRUCTION).slice(0, 8000),
      emit: (event) => {
        try {
          if (typeof config.emit === 'function') {
            config.emit({ ...event, sessionId: id });
          }
        } catch (_error) {
          /* la fenêtre peut avoir disparu */
        }
      },
      ws: null,
      ready: false,
      everReady: false,
      stopped: false,
      reconnecting: false,
      reconnectTimer: null,
      goAwayTimer: null,
      attempts: 0,
      handle: '',
      _finishConnect: null,
    };

    const models = [session.model, DEFAULT_MODEL, ...FALLBACK_MODELS].filter(
      (model, index, list) => list.indexOf(model) === index,
    );
    let lastError = null;
    for (const model of models) {
      session.model = model;
      this.sessions.set(id, session);
      try {
        await this._connect(session);
        return { ok: true, sessionId: id, model: session.model, voice: session.voice };
      } catch (error) {
        lastError = error;
        this.sessions.delete(id);
        session.ready = false;
        if (session.stopped) break;
        // Une clé invalide ou un quota épuisé ne se règle pas en changeant de
        // modèle : on ne réessaie que pour un modèle inconnu/indisponible.
        if (!/not found|not_found|not supported|unsupported|inconnu|indisponible|404/i.test(String(error && error.message))) {
          break;
        }
      }
    }
    return {
      ok: false,
      error: (lastError && lastError.message) || 'Connexion Gemini Live impossible.',
    };
  }

  _connect(session) {
    return new Promise((resolve, reject) => {
      if (session.stopped) {
        reject(new Error('Session arrêtée.'));
        return;
      }
      let settled = false;
      let ws = null;
      let errorTimer = null;
      const finish = (error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (errorTimer) clearTimeout(errorTimer);
        session._finishConnect = null;
        if (error) {
          reject(error);
          // Une erreur peut précéder la fermeture du socket : on le ferme pour
          // ne pas laisser une connexion orpheline qui consommerait du quota.
          try { if (ws && ws.readyState !== 3) ws.close(); } catch (_error) { /* ignore */ }
        } else {
          resolve();
        }
      };
      const timer = setTimeout(() => {
        finish(new Error('Délai de connexion Gemini Live dépassé.'));
        try { if (ws) ws.close(); } catch (_error) { /* ignore */ }
      }, this.connectTimeout);
      session._finishConnect = finish;

      const url = `${ENDPOINT}?key=${encodeURIComponent(session.key)}`;
      try {
        ws = new this.WebSocketImpl(url);
      } catch (error) {
        finish(error);
        return;
      }
      session.ws = ws;
      session.ready = false;
      try { ws.binaryType = 'arraybuffer'; } catch (_error) { /* ignore */ }

      ws.onopen = () => {
        if (session.ws !== ws) return;
        try {
          ws.send(JSON.stringify({ setup: buildSetup(session) }));
          this.log(`session ${session.id} ouverte (${session.model})`);
        } catch (error) {
          finish(error);
        }
      };

      ws.onmessage = (event) => {
        if (session.ws !== ws) return;
        this._handle(session, event).catch((error) => {
          this.log(`message ignoré : ${error && error.message ? error.message : error}`);
        });
      };

      ws.onerror = () => {
        if (session.ws !== ws) return;
        if (settled || session.ready) return;
        // Laisse une chance à `close` d'arriver avec le message détaillé du
        // serveur ; sinon on échoue après un court délai.
        if (!errorTimer) {
          errorTimer = setTimeout(() => {
            finish(new Error('Connexion Gemini Live refusée (clé, quota ou réseau).'));
          }, 300);
        }
      };

      ws.onclose = (event) => {
        clearTimeout(timer);
        if (errorTimer) clearTimeout(errorTimer);
        if (session.ws !== ws) return;
        if (!settled) {
          finish(new Error(closeReason(event)));
          return;
        }
        session.ready = false;
        if (session.stopped || session.reconnecting) return;
        // Échec de la connexion initiale : `start()` va rejeter (et tenter le
        // modèle de secours). On ne lance pas une reconnexion en parallèle.
        if (!session.everReady) return;
        this._scheduleReconnect(session, closeReason(event));
      };
    });
  }

  async _handle(session, event) {
    if (session.stopped || !this.sessions.has(session.id)) return;
    const text = await messageToText(event && event.data);
    if (!text) return;
    let message;
    try {
      message = JSON.parse(text);
    } catch (_error) {
      return;
    }
    if (!message || typeof message !== 'object') return;

    if (message.setupComplete) {
      const resumed = session.everReady;
      session.ready = true;
      session.attempts = 0;
      session.everReady = true;
      session.emit({
        type: resumed ? 'reconnected' : 'ready',
        model: session.model,
        voice: session.voice,
      });
      if (session._finishConnect) {
        const finish = session._finishConnect;
        session._finishConnect = null;
        finish(null);
      }
      return;
    }

    if (message.serverContent) {
      const content = message.serverContent;
      if (content.interrupted) session.emit({ type: 'interrupted' });
      const parts = (content.modelTurn && content.modelTurn.parts) || [];
      for (const part of parts) {
        const inline = part && part.inlineData;
        if (inline && inline.data) {
          session.emit({
            type: 'audio',
            data: inline.data,
            mimeType: inline.mimeType || 'audio/pcm;rate=24000',
          });
        }
      }
      const outputTranscription = content.outputTranscription;
      if (outputTranscription && typeof outputTranscription.text === 'string') {
        session.emit({
          type: 'text',
          text: outputTranscription.text,
          finished: outputTranscription.finished === true,
        });
      }
      if (content.generationComplete) session.emit({ type: 'generation-complete' });
      if (content.turnComplete) session.emit({ type: 'turn-complete' });
    }

    if (message.usageMetadata) {
      const usage = message.usageMetadata;
      session.emit({
        type: 'usage',
        total: Number(usage.totalTokenCount) || 0,
        prompt: Number(usage.promptTokenCount) || 0,
        response: Number(usage.responseTokenCount) || 0,
      });
    }

    if (message.sessionResumptionUpdate) {
      const update = message.sessionResumptionUpdate;
      if (update.resumable && update.newHandle) session.handle = String(update.newHandle);
    }

    if (message.goAway) {
      const ms = message.goAway.timeLeft
        ? Number(message.goAway.timeLeft.seconds || 0) * 1000
        : 0;
      session.emit({ type: 'go-away', ms });
      // Laisse le tour en cours se terminer, puis reconnecte avant la coupure.
      // Une fermeture naturelle entre-temps déclenche déjà la reconnexion.
      if (session.goAwayTimer) clearTimeout(session.goAwayTimer);
      const delay = ms > 2000 ? Math.min(ms - 1500, 8000) : 0;
      if (delay > 0) {
        session.goAwayTimer = setTimeout(() => {
          session.goAwayTimer = null;
          if (!session.stopped && !session.reconnecting) {
            this._scheduleReconnect(session, 'Fin de connexion annoncée par Gemini.');
          }
        }, delay);
        if (session.goAwayTimer.unref) session.goAwayTimer.unref();
      } else {
        this._scheduleReconnect(session, 'Fin de connexion annoncée par Gemini.');
      }
    }

  }

  _scheduleReconnect(session, reason) {
    if (session.stopped || session.reconnecting) return;
    if (session.goAwayTimer) {
      clearTimeout(session.goAwayTimer);
      session.goAwayTimer = null;
    }
    // Une clé invalide, un quota épuisé ou un projet sans accès (facturation)
    // ne se règle pas en réessayant : on ferme proprement pour ne pas
    // multiplier les connexions.
    if (/quota exceeded|resource.?exhausted|rate.?limit|429|permission.?denied|unauthenticated|api key (?:not valid|invalid|expired)|free tier|billing|paid tier|not available for this project/i.test(String(reason || ''))) {
      session.emit({ type: 'closed', error: reason || 'Session Gemini Live refusée.' });
      this._dispose(session);
      return;
    }
    if (session.attempts >= this.maxReconnects) {
      session.emit({ type: 'closed', error: reason || 'Session Gemini Live interrompue.' });
      this._dispose(session);
      return;
    }
    session.reconnecting = true;
    session.ready = false;
    session.attempts += 1;
    session.emit({ type: 'reconnecting', attempt: session.attempts });
    try { if (session.ws) session.ws.close(1000, 'reconnect'); } catch (_error) { /* ignore */ }
    const delay = Math.min(3000, 350 * session.attempts);
    session.reconnectTimer = setTimeout(async () => {
      session.reconnectTimer = null;
      if (session.stopped) return;
      try {
        await this._connect(session);
        session.reconnecting = false;
      } catch (error) {
        session.reconnecting = false;
        // Un handle de reprise expiré ne doit pas bloquer toutes les tentatives :
        // on repart sur une nouvelle session après l'avoir oublié.
        if (/handle|resumption|expired|invalid/i.test(String((error && error.message) || ''))) {
          session.handle = '';
        }
        if (!session.stopped) this._scheduleReconnect(session, (error && error.message) || reason);
      }
    }, delay);
    if (session.reconnectTimer.unref) session.reconnectTimer.unref();
  }

  _dispose(session) {
    session.stopped = true;
    session.ready = false;
    if (session.reconnectTimer) clearTimeout(session.reconnectTimer);
    session.reconnectTimer = null;
    if (session.goAwayTimer) clearTimeout(session.goAwayTimer);
    session.goAwayTimer = null;
    try { if (session.ws) session.ws.close(1000, 'dispose'); } catch (_error) { /* ignore */ }
    this.sessions.delete(session.id);
  }

  sendAudio(sessionId, data, mimeType) {
    const session = this.sessions.get(sessionId);
    if (!session || !session.ready || !session.ws) return false;
    if (typeof data !== 'string' || !data || data.length > 2 * 1024 * 1024) return false;
    try {
      session.ws.send(JSON.stringify({
        realtimeInput: {
          audio: {
            data,
            mimeType: String(mimeType || 'audio/pcm;rate=16000'),
          },
        },
      }));
      return true;
    } catch (_error) {
      return false;
    }
  }

  /** Signale la fin d'une prise de parole (VAD hybride, latence réduite). */
  sendAudioEnd(sessionId) {
    const session = this.sessions.get(sessionId);
    if (!session || !session.ready || !session.ws) return false;
    try {
      session.ws.send(JSON.stringify({ realtimeInput: { audioStreamEnd: true } }));
      return true;
    } catch (_error) {
      return false;
    }
  }

  /** Entrée texte ponctuelle (le mode vocal reste audio → audio). */
  sendText(sessionId, text) {
    const session = this.sessions.get(sessionId);
    const value = String(text || '').trim().slice(0, 3000);
    if (!session || !session.ready || !session.ws || !value) return false;
    try {
      session.ws.send(JSON.stringify({ realtimeInput: { text: value } }));
      return true;
    } catch (_error) {
      return false;
    }
  }

  stop(sessionId) {
    const session = this.sessions.get(sessionId);
    if (!session) return false;
    this._dispose(session);
    return true;
  }

  stopOwner(owner) {
    for (const session of [...this.sessions.values()]) {
      if (session.owner === owner) this._dispose(session);
    }
  }

  closeAll() {
    for (const session of [...this.sessions.values()]) this._dispose(session);
  }

  get size() {
    return this.sessions.size;
  }
}

module.exports = {
  LiveManager,
  DEFAULT_MODEL,
  DEFAULT_VOICE,
  FALLBACK_MODELS,
  DEFAULT_INSTRUCTION,
  buildSetup,
  normalizeModel,
  normalizeVoice,
  closeReason,
};
