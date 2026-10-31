# gpt-6-luna-decisions helper

Small native HTTP helper (Node stdlib only, no dependencies) for the OpenAI
Decisions API shape, sent to the Experiential gateway.

## Files
- `decisions.js` — the helper
- `decisions.test.js` — mocked tests (local HTTP mock server; no live calls)
- `package.json` — `node --test decisions.test.js`

## What it does
- POST-only to `https://api.experientiallabs.ai/v1/decisions`
- Model `gpt-6-luna-decisions` exactly
- Bearer key read ONLY from `EXPERIENTIAL_API_KEY`; if missing it throws
  `ConfigurationError` before any network call (set it locally; never paste or log it)
- Never calls `api.openai.com`, never requests an OpenAI API key
- No streaming, no Chat Completions / Responses / Messages facade
- GPT-6 Luna Decisions answers typed decision questions only; it does NOT generate chat completions
- Your coding agent stays on its current chat model

## Request shape
`{ model, input, questions }` where `input` is a concise diff + test summary
(string or `{ text }` / `{ messages }` with `input_text` / inline base64
`input_image` parts) and `questions` is a list. Each question needs
`instructions` + `type` (`predicate` | `choice` | `score`) and may carry a
unique `name`. Gateway admission bounds are enforced locally:
- at most 32 questions per request
- at most 64 options per choice
- 2-10 levels per score

## Answers
Answers come back in question order. An unnamed question's answer has no name;
a refusal answer means the model declined that question. Read the answer at the
review question's position (`reviewDecision(result, position)`) and show the
decision + reported usage to the user. Probabilities and confidence are NOT
guarantees of correctness.

## Safety
- Never executes a returned choice, never merges a change, never bypasses review
- Bounded timeout; surfaces HTTP and transport errors
- NO automatic retries, NO `Idempotency-Key` (an unknown outcome may already be charged)

## Live calls
Do not make a potentially charged live call without asking first, and do not
claim it worked without a real response. All tests here are mocked against
localhost.
