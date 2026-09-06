# Chatr — AI providers

Inference is delegated to third-party cloud APIs. The app normalizes them, maps
failures to user-safe codes, and never sends client secrets upstream beyond the
provider key required by each API.

## Providers

Set `AI_PROVIDER` to one of: `openai`, `anthropic`, `gemini` (or `mock` in dev
only). A provider needs its API key configured (see `docs/DEPLOYMENT.md`).

| `AI_PROVIDER` | Key env                | Default model            | API                                    |
| ------------- | ---------------------- | ------------------------ | -------------------------------------- |
| `openai`      | `OPENAI_API_KEY`       | `gpt-4o-mini`            | `https://api.openai.com/v1/...`        |
| `anthropic`   | `ANTHROPIC_API_KEY`    | `claude-3-5-haiku-latest`| `https://api.anthropic.com/v1/...`     |
| `gemini`      | `GEMINI_API_KEY`       | `gemini-2.0-flash`       | `https://generativelanguage.googleapis.com/v1beta/...` |
| `mock`        | — (none)               | `mock-1`                 | local, dev/test only                   |

Model defaults can be overridden per provider with `{PROVIDER}_MODEL`.

## How the layer is structured

- `src/server/ai/types.ts` — `ChatProvider` interface + normalized types.
- `src/server/ai/providers/*.ts` — API adapters (translate protocol specifics,
  e.g. Anthropic `assistant` role ↔ normalized `assistant`).
- `src/server/ai/sse.ts` — SSE line/`data:` parsing used by the adapters.
- `src/server/ai/httperrors.ts` — maps HTTP/network failures to `ProviderError`.
- `src/server/ai/factory.ts` — `createProvider()` and `listAvailableProviders()`.
- `src/server/ai/errors.ts` — `ProviderError` with a stable `code`.

## Error codes (client-facing)

| Code            | Meaning                                              | HTTP |
| --------------- | ---------------------------------------------------- | ---- |
| `config`        | Provider not configured (key missing, bad `AI_PROVIDER`) | 500 |
| `auth`          | Provider rejected the API key                        | 502  |
| `rate_limited`  | Transient rate limit (retryable)                     | 429  |
| `quota_exceeded`| Quota exhausted (billing limit, retryable)          | 429  |
| `bad_request`   | Provider rejected the request                        | 502  |
| `content_filter`| Blocked by provider safety filters                   | 400  |
| `upstream`/`network` | Provider outage or network failure (retryable)   | 503  |
| `aborted`       | Request cancelled by the client                      | 499  |

Error messages shown to users are fixed, generic strings — raw provider
responses are never surfaced (they can contain request content or key details).

## Streaming

`POST /api/chat` responds as SSE with frames:

- `event: delta`  → `{"delta":"..."}` streamed tokens
- `event: done`   → `{"conversationId":"...","message":{...}}` the persisted reply
- `event: error`  → `{"code":"...","message":"..."}` a mid-stream failure

Each turn persists the user message before streaming and the assistant message
after the stream completes (so a crash never saves partial output).

## Testing without accounts

`npm run dev` defaults to the `mock` provider: no accounts, no keys, no network
calls. For real conversations set `AI_PROVIDER` + the matching key before
running the dev server. Provider adapters are unit-tested against stub HTTP
servers (`tests/ai/providers.test.ts`).