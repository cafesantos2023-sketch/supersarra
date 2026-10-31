// decisions.test.js
//
// Mocked test for decisions.js. Spins up a local HTTP server that impersonates
// the Experiential gateway (https://api.experientiallabs.ai/v1/decisions) and
// asserts the exact request shape. No real network call, no live charge.
//
// Each test owns its own server (no module-level shared state) so the suite is
// safe to run concurrently and no server can keep another test's process alive.

import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { createServer } from 'node:http';
import {
  decide,
  decideRequest,
  validateQuestions,
  reviewDecision,
  ConfigurationError,
  TransportError,
} from './decisions.js';

const MODEL = 'gpt-6-luna-decisions';
const PATH = '/v1/decisions';

// Run one test against a local mock gateway. `ctx.serverUrl` includes the
// /v1/decisions path so `decide({ endpoint: ctx.serverUrl })` targets the mock.
// `ctx.last()` returns the most recent captured request.
async function withMock(handler, fn) {
  const received = [];
  const server = createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      received.push({
        method: req.method,
        url: req.url,
        headers: req.headers,
        body,
      });
      handler(req, res, body);
    });
  });
  await new Promise((resolve) => server.listen(0, resolve));
  const port = server.address().port;
  const serverUrl = `http://127.0.0.1:${port}${PATH}`;
  try {
    await fn({ serverUrl, received, last: () => received[received.length - 1] });
  } finally {
    // Destroy held sockets (a handler may never end its response, e.g. the
    // timeout test) and close without blocking on the graceful close event,
    // so a stubborn connection cannot hang the suite.
    try {
      if (typeof server.closeAllConnections === 'function') server.closeAllConnections();
    } catch {}
    server.close(() => {});
  }
}

// Gateway-ish success response: answers in question order, a refusal, an
// unnamed answer (no name), and reported usage.
function successHandler(req, res, body) {
  const parsed = JSON.parse(body || '{}');
  const answers = parsed.questions.map((q, i) => {
    const ans = {};
    if (q.name) ans.name = q.name; // named questions echo their name; unnamed -> none
    if (i === 1) return { ...ans, type: 'refusal', refusal: true }; // unnamed, declined
    if (q.type === 'predicate') return { ...ans, type: 'answer.prediction', probability: 0.5 };
    if (q.type === 'choice')
      return { ...ans, type: 'answer.choice', choice: q.choices[0]?.value ?? 'approve' };
    if (q.type === 'score') return { ...ans, type: 'answer.score', score: 4 };
    return { ...ans, type: 'answer.prediction', probability: 0.5 };
  });
  res.writeHead(200, {
    'Content-Type': 'application/json',
    'Connection': 'close',
  });
  res.end(
    JSON.stringify({
      id: 'dec_test_123',
      model: MODEL,
      answers,
      usage: { input_tokens: 110, output_tokens: 7, total_tokens: 117 },
    })
  );
}

test('requireApiKey throws ConfigurationError and makes no network call when EXPERIENTIAL_API_KEY is missing', async () => {
  const prev = process.env.EXPERIENTIAL_API_KEY;
  delete process.env.EXPERIENTIAL_API_KEY;
  try {
    await assert.rejects(
      decide({ input: 'summary', questions: [] }),
      (err) => err instanceof ConfigurationError
    );
  } finally {
    if (prev === undefined) delete process.env.EXPERIENTIAL_API_KEY;
    else process.env.EXPERIENTIAL_API_KEY = prev;
  }
});

test('decision request shape sent to the gateway: POST /v1/decisions, Bearer key, model, no Idempotency-Key', async () => {
  process.env.EXPERIENTIAL_API_KEY = 'test-secret-key-do-not-log';

  const questions = [
    {
      name: 'review',
      instructions: 'Should this change be reviewed before merge? Answer true if yes.',
      type: 'predicate',
      statement: 'This change requires human review before it can be merged.',
    },
    {
      instructions: 'Pick a disposition.',
      type: 'choice',
      choices: [
        { value: 'approve', description: 'Approve as-is' },
        { value: 'request_changes', description: 'Request changes' },
      ],
    },
    {
      name: 'confidence',
      instructions: 'Rate review confidence.',
      type: 'score',
      levels: [
        { label: 'low', description: 'Low confidence' },
        { label: 'medium', description: 'Medium confidence' },
        { label: 'high', description: 'High confidence' },
      ],
    },
  ];

  await withMock(successHandler, async ({ serverUrl, last }) => {
    const result = await decide({
      input: 'diff summary: add decisions helper',
      questions,
      timeoutMs: 5000,
      endpoint: serverUrl,
    });
    const req = last();

    assert.strictEqual(req.method, 'POST');
    assert.strictEqual(req.url, PATH);
    assert.strictEqual(req.headers.authorization, 'Bearer test-secret-key-do-not-log');
    assert.strictEqual(req.headers['idempotency-key'], undefined, 'no Idempotency-Key header');
    assert.ok(req.headers['content-type'].includes('application/json'));

    const body = JSON.parse(req.body);
    assert.strictEqual(body.model, MODEL);
    assert.deepStrictEqual(body.input, { text: 'diff summary: add decisions helper' });
    assert.strictEqual(body.questions.length, 3);
    assert.deepStrictEqual(body.questions[0], {
      name: 'review',
      instructions: questions[0].instructions,
      type: 'predicate',
      statement: questions[0].statement,
    });
    assert.strictEqual(body.questions[1].name, undefined, 'unnamed question carries no name');
    assert.strictEqual(body.questions[2].name, 'confidence');

    // Answers in question order.
    assert.strictEqual(result.answers.length, 3);
    assert.strictEqual(result.answers[0].name, 'review');
    assert.strictEqual(result.answers[0].type, 'predicate');
    assert.strictEqual(result.answers[0].decision, 0.5);
    assert.strictEqual(result.answers[0].refusal, false);

    assert.strictEqual(result.answers[1].name, null, 'unnamed question answer has no name');
    assert.strictEqual(result.answers[1].type, 'refusal');
    assert.strictEqual(result.answers[1].refusal, true);
    assert.strictEqual(result.answers[1].decision, null);

    assert.strictEqual(result.answers[2].name, 'confidence');
    assert.strictEqual(result.answers[2].type, 'score');
    assert.strictEqual(result.answers[2].decision, 4);

    // Usage reported.
    assert.deepStrictEqual(result.usage, { input_tokens: 110, output_tokens: 7, total_tokens: 117 });
    assert.strictEqual(result.id, 'dec_test_123');
  });
});

test('reviewDecision reads the answer at the review question position and reports decision + usage', async () => {
  process.env.EXPERIENTIAL_API_KEY = 'test-secret-key-do-not-log';

  const questions = [
    {
      name: 'review',
      instructions: 'Should this change be reviewed before merge?',
      type: 'predicate',
      statement: 'This change requires human review before it can be merged.',
    },
  ];

  await withMock(successHandler, async ({ serverUrl }) => {
    const result = await decide({ input: 'summary', questions, endpoint: serverUrl });
    const review = reviewDecision(result, 0);
    assert.strictEqual(review.position, 0);
    assert.strictEqual(review.name, 'review');
    assert.strictEqual(review.refusal, false);
    assert.deepStrictEqual(review.usage, { input_tokens: 110, output_tokens: 7, total_tokens: 117 });
  });
});

test('messages input with inline base64 input_image passes through unchanged', async () => {
  process.env.EXPERIENTIAL_API_KEY = 'test-secret-key-do-not-log';

  const input = {
    messages: [
      {
        role: 'user',
        content: [
          { type: 'input_text', input_text: 'Review this screenshot diff.' },
          {
            type: 'input_image',
            input_image: { data: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhHmMIQAAAABJRU5ErkJggg==' },
          },
        ],
      },
    ],
  };

  await withMock(successHandler, async ({ serverUrl, last }) => {
    await decide({
      input,
      questions: [{ instructions: 'x', type: 'predicate', statement: 'y' }],
      endpoint: serverUrl,
    });
    const body = JSON.parse(last().body);
    assert.deepStrictEqual(body.input, input);
  });
});

test('HTTP non-2xx is surfaced as TransportError with statusCode and body (no retry)', async () => {
  process.env.EXPERIENTIAL_API_KEY = 'test-secret-key-do-not-log';

  await withMock((req, res) => {
    res.writeHead(502, {
      'Content-Type': 'application/json',
      'Connection': 'close',
    });
    res.end(JSON.stringify({ error: 'bad gateway' }));
  }, async ({ serverUrl }) => {
    await assert.rejects(
      decide({ input: 's', questions: [{ instructions: 'x', type: 'predicate', statement: 'y' }], endpoint: serverUrl }),
      (err) =>
        err instanceof TransportError &&
        err.statusCode === 502 &&
        /bad gateway/.test(err.body ?? '')
    );
  });
});

test('transport error (connection refused) is surfaced as TransportError', async () => {
  process.env.EXPERIENTIAL_API_KEY = 'test-secret-key-do-not-log';

  await withMock((req, res) => {
    req.destroy(); // abrupt transport error on the wire
  }, async ({ serverUrl }) => {
    await assert.rejects(
      decide({ input: 's', questions: [{ instructions: 'x', type: 'predicate', statement: 'y' }], endpoint: serverUrl, timeoutMs: 3000 }),
      (err) => err instanceof TransportError
    );
  });
});

test('bounded timeout: a non-responding gateway fails fast as TransportError', async () => {
  process.env.EXPERIENTIAL_API_KEY = 'test-secret-key-do-not-log';

  await withMock((req, res) => {
    // never respond
  }, async ({ serverUrl }) => {
    const start = Date.now();
    await assert.rejects(
      decide({ input: 's', questions: [{ instructions: 'x', type: 'predicate', statement: 'y' }], endpoint: serverUrl, timeoutMs: 800 }),
      (err) => err instanceof TransportError
    );
    const elapsed = Date.now() - start;
    assert.ok(elapsed < 5000, `should fail fast, took ${elapsed}ms`);
  });
});

test('validateQuestions enforces gateway admission bounds locally', () => {
  process.env.EXPERIENTIAL_API_KEY = 'test-secret-key-do-not-log';

  const base = { instructions: 'do it', type: 'predicate', statement: 's' };

  assert.ok(validateQuestions([{ ...base, name: 'a' }]) === undefined);
  assert.ok(
    validateQuestions(Array.from({ length: 32 }, (_, i) => ({ ...base, name: `q${i}` }))) === undefined
  );

  assert.throws(
    () => validateQuestions(Array.from({ length: 33 }, (_, i) => ({ ...base, name: `q${i}` }))),
    /At most 32 questions/
  );
  assert.throws(
    () => validateQuestions([{ ...base, type: 'choice', choices: Array.from({ length: 65 }, (_, i) => ({ value: `v${i}`, description: 'd' })) }]),
    /at most 64 options/
  );
  assert.throws(
    () => validateQuestions([{ ...base, type: 'score', levels: [{ label: 'a', description: 'd' }] }]),
    /2-10 levels/
  );
  assert.throws(
    () => validateQuestions([{ ...base, type: 'score', levels: Array.from({ length: 11 }, (_, i) => ({ label: `l${i}`, description: 'd' })) }]),
    /2-10 levels/
  );
  assert.throws(() => validateQuestions([{ type: 'predicate', statement: 's' }]), /instructions/);
  assert.throws(() => validateQuestions([{ ...base, type: 'bogus' }]), /type/);
  assert.throws(() => validateQuestions([{ ...base, name: 'dup' }, { ...base, name: 'dup' }]), /Duplicate/);
  assert.throws(() => validateQuestions([{ ...base, name: '' }]), /name/);
});

test('decideRequest builds the request body without sending (dry run)', () => {
  process.env.EXPERIENTIAL_API_KEY = 'test-secret-key-do-not-log';
  const questions = [{ name: 'r', instructions: 'i', type: 'predicate', statement: 's' }];
  const body = JSON.parse(decideRequest('summary', questions));
  assert.strictEqual(body.model, MODEL);
  assert.deepStrictEqual(body.input, { text: 'summary' });
  assert.deepStrictEqual(body.questions, questions);
});
