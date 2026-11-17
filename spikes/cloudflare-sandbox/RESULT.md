# Cloudflare Sandbox credential-injection spike: result

Claude Code and Codex both run headless in a Cloudflare Sandbox container that holds only
placeholder credentials. The Outbound Worker holds the real ones. One container instance lived
the full 80 minutes of the longest run. Two things are not measured: the cost of a run, and a
Codex token refresh against the live service.

Date run (UTC): 2026-11-17
Package versions: `@anthropic-ai/claude-code` 2.1.326, `@openai/codex` 0.169.0,
`@cloudflare/sandbox` 1.0.3, `wrangler` 4.163.0. Container instance type `standard-1`.

## Verdict per CLI

| CLI | Credential used | Verdict | Failure |
| --- | --- | --- | --- |
| Claude Code | placeholder `CLAUDE_CODE_OAUTH_TOKEN`, a `claude setup-token` subscription token | worked: exit 0, reply `pong` | none |
| Codex | ChatGPT login (`auth.json` of placeholder tokens in `CODEX_HOME`) | worked: exit 0, reply `pong`, 13,892 input and 5 output tokens | none; its WebSocket attempt is answered 426 by the Worker and Codex continues over HTTPS |

Real token absent from the container:

- Environment of every process (`env` and every `/proc/*/environ`), Claude Code container: the
  only credential-shaped value is `CLAUDE_CODE_OAUTH_TOKEN`, 41 characters, prefix
  `sk-ant-oat01-p`, containing the substring `placeholder`.
- Codex container `auth.json`: `access_token` and `id_token` end in `placeholder-signature`,
  `refresh_token` starts `rt_placehold`. The environment holds no credential variables.
- Filesystem, fixed-string search for `sk-ant-oat01-`, `sk-ant-` and `eyJ` over the container:
  the only `sk-ant-` hits are two lines of the run's own `stdout.log`, and both contain
  `placeholder`. The `eyJ` hits are npm package metadata, CA certificate text and one Claude
  policy signature (a JWS), none a credential.
- Response headers of an upstream request made from the container carry no header value longer
  than 60 characters.

The agents ran these checks, so the evidence depends on the model running the commands it was
given. The values were masked in the prompts so that a real token could not enter the transcript.

Direct placeholder check against `api.anthropic.com` from the container (`/v1/models` with the
placeholder, via Node `fetch`): 401. This endpoint is not evidence of the swap either way. The
evidence that the swap happens is that Claude Code, which sends only the placeholder, completes
a request that Anthropic accepts.

## Container user

The image runs as the non-root user `agent` (uid 1001, home `/home/agent`). Claude Code and
Codex each completed a run on the deployed image, and each reported uid 1001 and could write
`/workspace`. Under the `durable_object` scheduling policy this is not a security boundary:
Cloudflare gives every process in the container the same Linux capabilities as root regardless of
user, so a process can switch back to root. The user fixes file ownership and removes a root
`USER` finding; it does not contain a compromised agent. The container's isolation is the
platform's, and the Worker holding the credentials is what limits what a compromised agent gets.

## Instance lifetime observed

| Field | Value |
| --- | --- |
| Run (sandbox name, agent) | `long1`, Claude Code |
| First heartbeat (UTC) | 2026-11-17T08:39:06Z |
| Last heartbeat under the same boot ID (UTC) | 2026-11-17T09:58:54Z |
| Observed instance lifetime | at least 80 minutes; the instance was still up when the run ended |
| How the end was detected | the run finished (`succeeded`, exit 0); no recycle was observed |
| Distinct boot IDs in the heartbeat file | 1 |
| Gaps longer than 90 s | none; 160 lines at 30 s spacing |
| `Run check failed` lines in `wrangler tail` | not captured |

Sampling once a minute from outside: 80 samples reported `running` with `container.running` true.
The container stayed up after the run finished, until the Worker stopped it. The inactivity
timeout is 30 minutes, and a finished run does not end the container, so an idle container keeps
running and is billed until the timeout or an explicit stop.

No maximum instance lifetime is documented; this result shows 80 minutes is reachable under the
60 s alarm, not an upper bound.

## Forced stop

| Observation | Value |
| --- | --- |
| `GET .../container` before the stop | `{"running":true}` |
| `POST .../stop` response | `{"running":false}` |
| `container.running` after the stop (`GET .../container`) | `{"running":false}`, and still false 130 s later |
| What the Durable Object sees: `GET .../run` after the stop | `{"state":"lost","agent":"claude"}`: no outcome was stored for the killed run |
| Same, when the run had already finished before the stop | the stored outcome is kept: `succeeded` stays `succeeded` |
| Alarm or error activity in `wrangler tail` after the stop | not captured |
| Stop not requested by the Worker (dashboard delete): `running` and run state | not tested |
| A later `POST .../run` on the same name starts a fresh container | yes: the run started, `running` was true, and it succeeded with `pong` |

## Cost per run

Not measured in this run. Container, Durable Object and Worker usage are read from the Cloudflare
dashboard after the fact, and model usage from the subscription's usage page.

| Run | Start / end (UTC) | Lifetime | Container usage | Durable Object and Worker usage | Model usage | Total | Read on |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `long1` (Claude Code, 80 minutes) | 08:39:00Z / about 10:01Z | 82 min of container time | not read | not read | not read | not measured | not read |
| `claude2`, `codex1`, `inspect`, `inspect2`, `stop1` (short runs) | 08:20Z to 08:55Z | each up until stopped, 5 to 30 minutes after its run finished | not read | not read | not read | not measured | not read |

What dominates cost is container wall-clock time at `standard-1`, including time a container
stays up after its run has finished.

## Fallback and blast radius for any failed CLI

Neither CLI failed with a placeholder.

### Claude Code

Not needed. A truncated or altered token fails with `401 OAuth access token is invalid`, from the
real token as well as the placeholder, so a token has to be checked with a local `claude -p`
before it is uploaded.

### Codex

Not needed for the request path. The refresh path is not exercised.

- Hosts a ChatGPT login contacts: `chatgpt.com` for requests and `auth.openai.com` for the
  token refresh. Both are on `allowedHosts`. No other host was blocked in these runs; the
  `wrangler tail` output that would show a block was not captured.
- A placeholder `auth.json` with far-future token expiry makes Codex send the placeholder and
  not refresh. On a 401, Codex refreshes; a local probe against a fake backend showed Codex
  accepting a placeholder refresh response and finishing its turn.

## Open questions

| Question | Answer | Evidence |
| --- | --- | --- |
| Does Claude Code run headless with only a placeholder token in the container? | yes | `claude2`, `inspect`, `long1`, `stop1` succeeded with the placeholder |
| Does Codex run headless with only a placeholder credential, and which credential type? | yes, with a ChatGPT login | `codex1` succeeded; `auth.json` holds placeholders |
| Does the real credential appear anywhere in the container? | no | environment, `auth.json`, filesystem and response header checks above |
| How long does one container instance live while the 60 s alarm runs? | at least 80 minutes with no recycle | one boot ID, no gap over 90 s across 160 heartbeats |
| What does the Durable Object see when the container is stopped, and what does `container.running` report? | `running` is false; a run with no stored outcome reads `lost`; a stored outcome is kept | forced stop table |
| What does one run cost, and what dominates it? | not measured; container time is the expected driver | cost table |
| Does a ChatGPT login for Codex need hosts outside `allowedHosts`? | `chatgpt.com` and `auth.openai.com`, which are on the list | Codex section above |

## Not established

- A Codex token refresh against the live ChatGPT service. Neither Codex run needed one.
- Behaviour when two sandboxes run Codex on one login at the same time.
- A stop not requested by the Worker, such as a dashboard delete.
- An upper bound on instance lifetime beyond 80 minutes.
- Cost per run.
