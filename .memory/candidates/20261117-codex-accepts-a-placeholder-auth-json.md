---
about: "spikes/cloudflare-sandbox/src/codex-credentials.ts"
saw:
  - "codex-cli 0.169.0 run in the sandbox on 2026-11-17, and a local probe against a fake backend"
---

Codex 0.169.0 runs on a placeholder `auth.json` the sandbox writes into `CODEX_HOME`: its
`access_token` and `id_token` need only three non-empty segments and a base64url JSON payload
(the signature is never checked), `last_refresh` must be set, and a plan type must be present.
A far-future `exp` stops Codex refreshing on its own. The ChatGPT backend sends WebSocket
upgrades first; `outbound.ts` answers them 426 so every response passes through token redaction,
and Codex falls back to HTTPS. The real access and refresh tokens never reach the container.
