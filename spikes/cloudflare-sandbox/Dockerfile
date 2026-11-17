# syntax=docker/dockerfile:1
FROM node:24-trixie-slim

RUN apt-get update \
	&& apt-get install -y --no-install-recommends bash ca-certificates git ripgrep \
	&& rm -rf /var/lib/apt/lists/*

# The sandbox has no route to a package registry at run time, so every tool
# an agent uses is installed here. Versions are pinned because the flags and
# event formats of both CLIs change between releases.
RUN npm install --global @anthropic-ai/claude-code@2.1.326
# Codex ships its native binaries as package dependencies and needs no
# install scripts.
RUN npm install --global --ignore-scripts @openai/codex@0.169.0

# The tag matches the @cloudflare/sandbox version in package.json.
COPY --from=docker.io/cloudflare/sandbox:1.0.3 /usr/local/bin/sandbox-shim /usr/local/bin/sandbox-shim

# The interception CA exists only at run time, so the entrypoint installs it
# into the system trust store before anything else runs. The Durable Object
# registers its HTTPS intercepts before starting the container, which is what
# creates the file; when it is missing the container exits rather than run
# with a trust store that rejects every intercepted request.
COPY --chmod=755 <<'EOF' /usr/local/bin/sandbox-entrypoint
#!/bin/sh
set -eu
cp /etc/cloudflare/certs/cloudflare-containers-ca.crt \
	/usr/local/share/ca-certificates/cloudflare-containers-ca.crt
update-ca-certificates
exec sleep infinity
EOF

WORKDIR /workspace
ENTRYPOINT ["/usr/local/bin/sandbox-entrypoint"]
