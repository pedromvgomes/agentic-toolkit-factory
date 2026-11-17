---
about: "spikes/cloudflare-sandbox/src/sandbox.ts"
saw:
  - "wrangler deploy of the spike, run on 2026-11-17 with seven named sandboxes"
---

A container started by `AgentSandbox` is not stopped when its run reports an outcome. The 60 s
alarm and the inactivity timeout (30 minutes in `sandbox.ts`) keep an instance up and nothing in
the Durable Object ends it, so every finished run leaves a running container, billed, until the
inactivity timeout or an explicit `POST /sandboxes/<name>/stop`. Six finished sandboxes were all
still `container.running` true when checked. A stage runner built on this has to stop the
container itself as soon as the stage reports succeeded, failed, blocked or lost.
