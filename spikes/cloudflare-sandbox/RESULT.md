# Cloudflare Sandbox credential-injection spike: result

**STATUS: UNFILLED TEMPLATE.** Nothing below has been observed. Replace every `TODO` with what
the runbook in `README.md` produced, and write "not run" where a step was not run.

Date run (UTC): TODO
Deployed by / account: TODO
Package versions (`@anthropic-ai/claude-code`, `@openai/codex`, `@cloudflare/sandbox`): TODO

## Verdict per CLI

| CLI | Credential used | Verdict (worked / did not work) | Failure (exact error, exit code, `stderrTail`) |
| --- | --- | --- | --- |
| Claude Code | placeholder `CLAUDE_CODE_OAUTH_TOKEN` | TODO | TODO |
| Codex | TODO: `CODEX_API_KEY` (API key) or ChatGPT login (`auth.json`) | TODO | TODO |

Real token absent from the container (environment of every process, filesystem grep, response
headers): TODO per CLI, with the commands used and their output.

Direct placeholder check against `api.anthropic.com` (status code): TODO

## Instance lifetime observed

| Field | Value |
| --- | --- |
| Run (sandbox name, agent) | TODO |
| First heartbeat (UTC) | TODO |
| Last heartbeat under the same boot ID (UTC) | TODO |
| Observed instance lifetime | TODO |
| How the end was detected (`lost`, `running: false`, boot ID change, run finished) | TODO |
| Distinct boot IDs in the heartbeat file | TODO |
| Gaps longer than 90 s | TODO |
| `Run check failed` lines in `wrangler tail` | TODO |

Notes: TODO

## Forced stop

| Observation | Value |
| --- | --- |
| `GET .../container` before the stop | TODO |
| `POST .../stop` response | TODO |
| `container.running` after the stop (`GET .../container`) | TODO |
| What the Durable Object sees: `GET .../run` after the stop | TODO |
| Same, when the run had already finished before the stop | TODO |
| Alarm or error activity in `wrangler tail` after the stop | TODO |
| Stop not requested by the Worker (dashboard delete): `running` and run state | TODO |
| A later `POST .../run` on the same name starts a fresh container | TODO |

## Cost per run

| Run | Start / end (UTC) | Lifetime | Container usage (vCPU-s, GiB-s, disk, egress) | Durable Object and Worker usage | Model usage | Total | Read on |
| --- | --- | --- | --- | --- | --- | --- | --- |
| TODO | TODO | TODO | TODO | TODO | TODO | TODO | TODO |

## Fallback and blast radius for any failed CLI

Fill one block per CLI that did not work with a placeholder. Write "not needed" when it did.

### Claude Code

- What it checks locally (prefix, length, login state, profile call): TODO
- Placeholder shapes tried and the result of each: TODO
- Fallback that places a token in the container: TODO
- What the fallback exposes (processes that can read it, hosts it can be sent to): TODO
- Blast radius if the token leaks, and revocation done: TODO

### Codex

- What it checks locally (API key shape, `auth.json`, login state): TODO
- Hosts a ChatGPT login contacts, and whether each is on `allowedHosts`: TODO
- Fallback that places a credential in the container: TODO
- What the fallback exposes: TODO
- Blast radius if the credential leaks, and revocation done: TODO

## Open questions

| Question | Answer | Evidence |
| --- | --- | --- |
| Does Claude Code run headless with only a placeholder token in the container? | TODO | TODO |
| Does Codex run headless with only a placeholder credential, and which credential type (API key or ChatGPT login)? | TODO | TODO |
| Does the real credential appear anywhere in the container (environment, filesystem, response headers)? | TODO | TODO |
| How long does one container instance live while the 60 s alarm runs? | TODO | TODO |
| What does the Durable Object see when the container is stopped, and what does `container.running` report? | TODO | TODO |
| What does one run cost, and what dominates it? | TODO | TODO |
| Does a ChatGPT login for Codex need hosts outside `allowedHosts`? | TODO | TODO |
