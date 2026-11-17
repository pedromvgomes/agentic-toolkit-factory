# syntax=docker/dockerfile:1
FROM node:24-trixie-slim@sha256:af02d57b57719b9657a45199a79264a9437940cd55b3c7b3fc99615654f124a0

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

# The tag matches the @cloudflare/sandbox version in package.json. Both base images are
# pinned by digest, so a retagged upstream image does not change what a deploy builds.
COPY --from=docker.io/cloudflare/sandbox:1.0.3@sha256:fc1740c3cba26461f0ab1771287c84018ab2cca43a70ebb823087c85d780aaec /usr/local/bin/sandbox-shim /usr/local/bin/sandbox-shim

# Every HTTPS request from the container is intercepted and re-signed with the
# interception CA, so the system CA bundle is a link to that CA alone. The CA
# file exists only at run time, created when the Durable Object registers its
# HTTPS intercepts, so the link dangles in the image and resolves once the
# container starts. Nothing has to write to the trust store at run time.
RUN ln -sf /etc/cloudflare/certs/cloudflare-containers-ca.crt /etc/ssl/certs/ca-certificates.crt

# The entrypoint, every exec and every sandbox-shim file operation run as this
# user, so the agent's files and the run directory belong to it.
RUN useradd --create-home --home-dir /home/agent --shell /bin/bash --user-group agent \
	&& install -d -o agent -g agent /workspace

# The Durable Object registers its HTTPS intercepts before starting the
# container; when the CA file is missing or unreadable the container exits
# rather than run with a trust store that rejects every intercepted request.
COPY --chmod=755 <<'EOF' /usr/local/bin/sandbox-entrypoint
#!/bin/sh
ca=/etc/cloudflare/certs/cloudflare-containers-ca.crt
if [ ! -r "$ca" ]; then
	echo "sandbox-entrypoint: $ca is missing or unreadable" >&2
	exit 1
fi
exec sleep infinity
EOF

USER agent
WORKDIR /workspace
ENTRYPOINT ["/usr/local/bin/sandbox-entrypoint"]
