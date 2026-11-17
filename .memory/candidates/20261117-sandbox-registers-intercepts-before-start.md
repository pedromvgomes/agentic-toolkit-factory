---
about: "spikes/cloudflare-sandbox/src/sandbox.ts"
saw:
  - "Cloudflare Containers outbound-traffic docs and the spike's Dockerfile entrypoint"
---

`registerIntercepts()` in `sandbox.ts` runs before `start()` on every container start, and again
when the Durable Object restarts with a container already running. Registering an HTTPS
intercept is what creates `/etc/cloudflare/certs/cloudflare-containers-ca.crt`, and the image
entrypoint (`Dockerfile`) copies that file into the system trust store and exits when it is
missing. Registering after `start()`, as Cloudflare's tutorial does, leaves the entrypoint
without the CA. Specific hostnames are registered before the `"*"` rule.
