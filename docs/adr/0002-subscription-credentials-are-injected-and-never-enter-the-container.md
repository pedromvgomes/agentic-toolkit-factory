# Subscription credentials are injected by the Outbound Worker and never enter the container

## Context

A Workflow Execution runs Claude Code or Codex unattended in a Cloudflare Sandbox container,
with no person present to sign in. The container also runs a model with egress to GitHub over a
Backlog item body, so anything placed inside it is reachable by whatever that model is talked
into doing.

The Cloudflare Sandbox spike (`spikes/cloudflare-sandbox/RESULT.md`, run on 2026-11-17 with
`@anthropic-ai/claude-code` 2.1.326 and `@openai/codex` 0.169.0) settles whether the CLIs can run
without their real credentials:

- Claude Code ran headless with only a placeholder `CLAUDE_CODE_OAUTH_TOKEN` (a
  `claude setup-token` subscription token) and completed requests Anthropic accepted.
- Codex ran headless on a ChatGPT login whose `auth.json` held only placeholder tokens.
- The real credential appeared nowhere in the container: not in any process environment, not in
  `auth.json`, not on the filesystem, not in response headers.
- Neither CLI needed a fallback. A truncated or altered Claude token fails with
  `401 OAuth access token is invalid`, from the real token as from the placeholder, so a token is
  checked with a local `claude -p` before it is uploaded.
- A Codex token refresh against the live ChatGPT service, and two sandboxes using one login at
  once, are not established.

### Anthropic's terms

Whether a subscription credential may drive Claude Code in a hosted, unattended run cannot be
confirmed from Anthropic's published text. The relevant passages, retrieved on 2026-11-17:

- Consumer Terms (effective Oct 8, 2025),
  <https://www.anthropic.com/legal/consumer-terms>: users may not access the Services "through
  automated or non-human means, whether through a bot, script, or otherwise", "Except when you
  are accessing our Services via an Anthropic API Key or where we otherwise explicitly permit
  it".
- Claude Code legal and compliance, <https://code.claude.com/docs/en/legal-and-compliance>:
  - "Advertised usage limits for Pro, Max, and Ultra plans assume ordinary, individual usage of
    Claude Code and the Agent SDK."
  - "running Claude Code in your products or services (e.g. in hosted sandboxes or other agent
    infrastructure) requires agreeing to our Commercial Terms of Service".
  - "developers may not collect, store, or intermediate Claude.ai credentials or session tokens".
- Claude Code authentication, <https://code.claude.com/docs/en/authentication>:
  `CLAUDE_CODE_OAUTH_TOKEN` is a long-lived token from `claude setup-token`; "Use this for CI
  pipelines and scripts where browser login isn't available."
- Claude Code GitHub Actions, <https://code.claude.com/docs/en/github-actions>: the workflow
  secret may be `CLAUDE_CODE_OAUTH_TOKEN`, "an OAuth token that authenticates with your Claude
  subscription".
- Commercial Terms (effective Jun 17, 2025), <https://www.anthropic.com/legal/commercial-terms>:
  they govern "Customer's use of Anthropic API keys and any other Anthropic offerings that
  references these Terms".

The documented CI use of a subscription token is an explicit permission for scripted access; the
hosted-sandbox and credential-intermediation passages address products and services offered to
others. The Factory is neither clearly inside nor clearly outside either reading.

### OpenAI's terms

OpenAI's terms for a ChatGPT subscription login driving Codex unattended are unchecked.
<https://openai.com/policies/terms-of-use/> was not retrieved on 2026-11-17 (HTTP 403).

## Decision

- Real credentials live in the Worker, as Worker secrets or in Durable Object storage. The
  container holds only placeholders, and the Outbound Worker swaps in the real credential per
  host on the way out.
- Claude Code runs on the owner's own `claude setup-token` subscription token. The terms risk
  above is accepted on four conditions, all of which hold: the token is the owner's own, the
  Workflows act on the owner's own repositories, there is one user, and the Factory is never
  offered to anyone else. A change to any of the four reopens this decision.
- Codex runs on the owner's ChatGPT subscription login, with its terms unchecked. A ChatGPT
  login's refresh token is single-use, so the Outbound Worker holds it in Durable Object storage
  and writes back the rotated token on every refresh. The login is seeded through an
  authenticated admin route on the Worker, because a Worker secret is limited to about 5 kB and
  cannot be rewritten by the Worker when the token rotates.

## Rejected alternatives

**Put the real credential in the container.** Every CLI would work without an interceptor, but a
model steered by an untrusted body could read the credential and send it anywhere its egress
reaches. The spike shows the placeholder path works for both CLIs, so there is no reason to pay
that.

**Run Claude Code on an Anthropic API key.** The Consumer Terms exempt API-key access from the
automation bar, and the Commercial Terms govern it, so the terms question disappears. It is not
the default because it bills per token on top of a subscription already paid for. It is the
fallback, and switching to it is a credential swap in the Worker: the key is injected per host
exactly as the subscription token is and never enters the container. Its blast radius is the
Console account's spend. A leaked or misused key makes model requests billed to that account
until it is revoked, and reaches nothing in GitHub; an agent inside the container can spend it
through the Worker while it runs, but cannot carry it out.

**Hold the ChatGPT login as a Worker secret.** A secret is limited to about 5 kB and is fixed for
the deployment, so it can neither be seeded reliably with a full login nor follow a single-use
refresh token as it rotates. The first refresh would leave the secret holding a spent token.

## Consequences

- The Factory's correctness depends on the Outbound Worker intercepting every request to
  Anthropic's API, `chatgpt.com` and `auth.openai.com`. A host added to the egress allow-list
  without an interceptor rule receives the placeholder.
- A token is verified locally before it is uploaded: a bad token and a placeholder fail the same
  way from inside the container.
- Two Executions refreshing one ChatGPT login at once can each spend the same single-use refresh
  token. The concurrency allowed for Codex has to keep refreshes serial until the spike's open
  question is answered.
- An Anthropic notice, a terms change, or any second user moves Claude Code to the API-key
  fallback.
