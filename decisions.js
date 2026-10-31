// decisions.js
//
// Native HTTP helper for the OpenAI Decisions API shape, sent to the
// Experiential gateway:
//   POST https://api.experientiallabs.ai/v1/decisions
//
// Model: gpt-6-luna-decisions (decision helper only — it answers typed
// decision questions; it does NOT generate chat completions).
//
// This module:
//  * reads the Bearer key ONLY from EXPERIENTIAL_API_KEY;
//  * never calls api.openai.com and never requests an OpenAI API key;
//  * sends model "gpt-6-luna-decisions" exactly;
//  * is POST-only, has a bounded timeout, surfaces HTTP/transport errors,
//    does NOT retry automatically, and does NOT send Idempotency-Key
//    (an unknown outcome may already be charged);
//  * does not stream and has no Chat Completions / Responses / Messages facade;
//  * never executes a returned choice, merges a change, or bypasses review.
//
// Gateway admission bounds (platform limits, enforced here):
//  * at most 32 questions per request;
//  * at most 64 options per choice question;
//  * 2-10 levels per score question.
//
// Request reference: https://developers.openai.com/api/docs/guides/decisions

import http from 'node:http';
import https from 'node:https';

const ENDPOINT = 'https://api.experientiallabs.ai/v1/decisions';
const MODEL = 'gpt-6-luna-decisions';
const DEFAULT_TIMEOUT_MS = 10_000;

const MAX_QUESTIONS = 32;
const MAX_CHOICE_OPTIONS = 64;
const MIN_SCORE_LEVELS = 2;
const MAX_SCORE_LEVELS = 10;

const VALID_TYPES = new Set(['predicate', 'choice', 'score']);

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export class DecisionsError extends Error {
  constructor(message, { statusCode, body, cause } = {}) {
    super(message);
    this.name = 'DecisionsError';
    this.statusCode = statusCode;
    this.body = body;
    this.cause = cause;
  }
}

// Configuration problem: the API key is missing locally.
export class ConfigurationError extends DecisionsError {
  constructor(message) {
    super(message);
    this.name = 'ConfigurationError';
  }
}

// HTTP or transport problem (non-2xx, connection refused, timeout, ...).
export class TransportError extends DecisionsError {
  constructor(message, { statusCode, body, cause } = {}) {
    super(message, { statusCode, body, cause });
    this.name = 'TransportError';
  }
}

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

// Read the Bearer key ONLY from EXPERIENTIAL_API_KEY.
// If missing, stop with a ConfigurationError directing the user to set it
// locally. Never prompt for/paste/log the key.
export function requireApiKey() {
  const key = process.env.EXPERIENTIAL_API_KEY;
  if (!key || !key.trim()) {
    throw new ConfigurationError(
      'EXPERIENTIAL_API_KEY is not set. Set it in your local environment ' +
      'before calling the decisions endpoint. Do not paste the key here, ' +
      'and do not log it.'
    );
  }
  return key.trim();
}

// ---------------------------------------------------------------------------
// Input / question validation
// ---------------------------------------------------------------------------

// Normalize the caller's input into the decisions request shape.
// Accepts a plain string (treated as text) or an object { text } / { messages }.
// Keep it concise: a diff + test summary, not the whole repository.
export function normalizeInput(input) {
  if (typeof input === 'string') return { text: input };
  if (input && typeof input === 'object') {
    if (typeof input.text === 'string') return { text: input.text };
    if (Array.isArray(input.messages)) return { messages: input.messages };
    return { text: String(input) };
  }
  return { text: String(input ?? '') };
}

function validateQuestion(q, index) {
  const at = `question at index ${index}`;
  if (!q || typeof q !== 'object') {
    throw new DecisionsError(`${at} must be an object`);
  }
  if (!q.instructions || typeof q.instructions !== 'string') {
    throw new DecisionsError(`${at} must have a non-empty 'instructions' string`);
  }
  if (!q.type || !VALID_TYPES.has(q.type)) {
    throw new DecisionsError(`${at} must have type 'predicate', 'choice', or 'score'`);
  }
  if (q.name !== undefined && (typeof q.name !== 'string' || !q.name.trim())) {
    throw new DecisionsError(`${at} 'name' must be a non-empty string if provided`);
  }

  if (q.type === 'predicate') {
    if (!q.statement || typeof q.statement !== 'string') {
      throw new DecisionsError(`${at} (predicate) must have a non-empty 'statement'`);
    }
    return;
  }

  if (q.type === 'choice') {
    if (!Array.isArray(q.choices) || q.choices.length === 0) {
      throw new DecisionsError(`${at} (choice) must have a non-empty 'choices' list`);
    }
    if (q.choices.length > MAX_CHOICE_OPTIONS) {
      throw new DecisionsError(
        `${at} (choice) has ${q.choices.length} options; gateway allows at most ${MAX_CHOICE_OPTIONS} options`
      );
    }
    for (const c of q.choices) {
      if (!c || typeof c.value !== 'string' || !c.value.trim()) {
        throw new DecisionsError(`${at} (choice) every option needs a non-empty 'value'`);
      }
      if (typeof c.description !== 'string') {
        throw new DecisionsError(`${at} (choice) every option needs a 'description'`);
      }
    }
    return;
  }

  // score
  if (!Array.isArray(q.levels)) {
    throw new DecisionsError(`${at} (score) must have a 'levels' list`);
  }
  if (q.levels.length < MIN_SCORE_LEVELS || q.levels.length > MAX_SCORE_LEVELS) {
    throw new DecisionsError(
      `${at} (score) has ${q.levels.length} levels; gateway requires ${MIN_SCORE_LEVELS}-${MAX_SCORE_LEVELS} levels`
    );
  }
  for (const l of q.levels) {
    if (!l || typeof l.label !== 'string' || !l.label.trim()) {
      throw new DecisionsError(`${at} (score) every level needs a non-empty 'label'`);
    }
    if (typeof l.description !== 'string') {
      throw new DecisionsError(`${at} (score) every level needs a 'description'`);
    }
  }
}

// Validate the full questions list against the gateway admission bounds.
export function validateQuestions(questions) {
  if (!Array.isArray(questions)) {
    throw new DecisionsError("'questions' must be an array");
  }
  if (questions.length === 0) {
    throw new DecisionsError("'questions' must not be empty");
  }
  if (questions.length > MAX_QUESTIONS) {
    throw new DecisionsError(
      `At most ${MAX_QUESTIONS} questions per request; got ${questions.length}`
    );
  }
  const names = new Set();
  for (const [i, q] of questions.entries()) {
    validateQuestion(q, i);
    if (q.name) {
      const name = q.name.trim();
      if (names.has(name)) {
        throw new DecisionsError(`Duplicate question name '${name}'`);
      }
      names.add(name);
    }
  }
}

// ---------------------------------------------------------------------------
// HTTP request (POST only, bounded timeout, no retries, no Idempotency-Key)
// ---------------------------------------------------------------------------

function postJson(url, body, { timeoutMs = DEFAULT_TIMEOUT_MS, signal }) {
  const apiKey = requireApiKey(); // throws ConfigurationError before any network call
  const parsed = new URL(url);

  // Pick the native module by scheme. The production default endpoint is HTTPS;
  // the test seam may use HTTP against a local mock.
  const lib = parsed.protocol === 'https:' ? https : http;

  const options = {
    hostname: parsed.hostname,
    port: parsed.port || (parsed.protocol === 'https:' ? 443 : 80),
    path: parsed.pathname + parsed.search,
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(body),
      // Intentionally NO Idempotency-Key: an unknown outcome may already be charged.
    },
  };

  return new Promise((resolve, reject) => {
    const req = lib.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => {
        data += chunk;
      });
      res.on('end', () => {
        if (timer) clearTimeout(timer);
        // Surface HTTP errors (non-2xx) as TransportError; never retry.
        if (res.statusCode < 200 || res.statusCode >= 300) {
          reject(
            new TransportError(`HTTP ${res.statusCode} from ${url}`, {
              statusCode: res.statusCode,
              body: data,
            })
          );
          if (!req.destroyed) req.destroy();
          return;
        }
        let parsedJson;
        try {
          parsedJson = data ? JSON.parse(data) : {};
        } catch (e) {
          parsedJson = { _raw: data, _parseError: e.message };
        }
        resolve({ statusCode: res.statusCode, body: parsedJson, raw: data });
        // Release the socket immediately so the helper does not linger on a
        // keep-alive connection after the response is fully read.
        if (!req.destroyed) req.destroy();
      });
    });

    req.on('error', (err) => {
      if (timer) clearTimeout(timer);
      reject(
        new TransportError(`Transport error calling ${url}: ${err.message}`, {
          cause: err,
        })
      );
    });

    // Bounded timeout: destroy the request so it cannot hang indefinitely.
    let timer;
    if (timeoutMs && timeoutMs > 0) {
      timer = setTimeout(() => {
        req.destroy(new Error(`Request timed out after ${timeoutMs}ms`));
      }, timeoutMs);
      if (typeof timer.unref === 'function') timer.unref();
    }

    // Allow external abort (e.g. AbortSignal).
    if (signal) {
      const onAbort = () => {
        req.destroy(new Error('Request aborted'));
      };
      if (signal.aborted) {
        onAbort();
      } else {
        signal.addEventListener('abort', onAbort, { once: true });
      }
    }

    req.write(body);
    req.end();
  });
}

// ---------------------------------------------------------------------------
// Answer normalization
// ---------------------------------------------------------------------------

// Answers come back in question order. An unnamed question's answer has no
// name. A refusal answer means the model declined that question.
// Probabilities and confidence are NOT guarantees of correctness.
export function normalizeAnswer(answer, question, index) {
  const out = {
    index,
    name: null,
    type: 'unknown',
    decision: null,
    refusal: false,
    raw: answer,
  };

  if (!answer || typeof answer !== 'object') return out;

  // Only a present answer name is used; an unnamed question has no name.
  if (typeof answer.name === 'string' && answer.name.trim()) {
    out.name = answer.name.trim();
  }

  const answerType = String(answer.type ?? '');

  if (
    answer.refusal === true ||
    answerType.includes('refusal') ||
    answerType.includes('decline')
  ) {
    out.type = 'refusal';
    out.refusal = true;
    out.decision = null;
    return out;
  }

  switch (question.type) {
    case 'predicate':
      out.type = 'predicate';
      out.decision =
        answer.probability ??
        (answer.prediction && answer.prediction.probability) ??
        answer.score ??
        null;
      break;
    case 'choice':
      out.type = 'choice';
      out.decision =
        answer.choice ??
        answer.selected_value ??
        answer.value ??
        answer.selectedChoice ??
        null;
      break;
    case 'score':
      out.type = 'score';
      out.decision =
        answer.score ??
        answer.selected_level ??
        answer.level ??
        answer.value ??
        null;
      break;
    default:
      out.type = 'unknown';
      out.decision = null;
  }

  return out;
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

export function decideRequest(input, questions) {
  requireApiKey();
  validateQuestions(questions);
  return JSON.stringify({
    model: MODEL,
    input: normalizeInput(input),
    questions,
  });
}

export async function decide({
  input,
  questions,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  signal,
  // Test seam: override the gateway URL. Defaults to the Experiential gateway.
  // Production calls POST to ENDPOINT only.
  endpoint = ENDPOINT,
}) {
  requireApiKey(); // stop locally if the key is missing; no network call
  validateQuestions(questions);

  const body = JSON.stringify({
    model: MODEL,
    input: normalizeInput(input),
    questions,
  });

  const response = await postJson(endpoint, body, { timeoutMs, signal });

  const raw = response.body;
  const answers = Array.isArray(raw.answers) ? raw.answers : [];
  const normalized = answers.map((ans, i) => {
    const question = questions[i] || { type: 'unknown' };
    return normalizeAnswer(ans, question, i);
  });

  return {
    id: raw.id ?? null,
    model: raw.model ?? MODEL,
    answers: normalized,
    usage: raw.usage ?? raw.usage_details ?? null,
    raw,
  };
}

// Read the answer at a given position (e.g. the review question's position).
// Returns the normalized answer for that position, or null if absent.
export function answerAt(result, position) {
  if (!result || !Array.isArray(result.answers)) return null;
  if (position < 0 || position >= result.answers.length) return null;
  return result.answers[position];
}

// Convenience: read the review-answer and report the decision + usage.
// position = index of the review question in the questions list.
export function reviewDecision(result, position) {
  const ans = answerAt(result, position);
  if (!ans) {
    return { position, decision: null, refusal: null, usage: result.usage ?? null, answer: null };
  }
  return {
    position,
    name: ans.name,
    type: ans.type,
    decision: ans.refusal ? null : ans.decision,
    refusal: ans.refusal,
    usage: result.usage ?? null,
    answer: ans,
  };
}
