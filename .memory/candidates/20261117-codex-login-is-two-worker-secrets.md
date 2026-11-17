---
about: "spikes/cloudflare-sandbox/src/codex-credentials.ts"
saw:
  - "wrangler deploy error code 10054 on 2026-11-17"
---

`CodexCredentials.load()` concatenates the Worker secrets `CODEX_AUTH_JSON_1` and
`CODEX_AUTH_JSON_2` back into one base64 `auth.json`. A Worker text binding is limited to about
5.1 kB, and the base64 of a ChatGPT login's `auth.json` is about 5.5 kB, so a single secret is
refused at upload (`Text binding ... is too large`, code 10054). The secrets only seed the
Durable Object's own storage: the live token pair changes with every refresh, which a secret
cannot hold.
