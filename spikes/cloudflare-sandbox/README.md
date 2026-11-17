# Cloudflare Sandbox credential-injection spike

This is a throwaway spike. Its code lives under `spikes/`, outside `source/`, outside every
lydite component, and is not built or tested by CI. It answers one question: can Claude Code and
Codex run headless in a Cloudflare container that holds only placeholder credentials, with the
real credentials substituted by the Worker on the way out?

The Worker (`src/index.ts`) exposes four routes. A Durable Object (`src/sandbox.ts`) owns one
container per sandbox name, intercepts the container's outbound HTTPS, and routes
`api.anthropic.com` and `api.openai.com` through `CredentialInjector` (`src/outbound.ts`), which
swaps the placeholder bearer token for the real Worker secret. Every other request is limited to
the allow-list in `allowedHosts` (`github.com`, `api.github.com`, `proxy.golang.org`,
`sum.golang.org`, `api.anthropic.com`, `api.openai.com`), HTTPS only.

Record everything in `RESULT.md`. Do not invent or round results; leave a field as "not run" when
a step was not run.

## Routes

All routes need `Authorization: Bearer $RUNNER_TOKEN`. `<name>` is 1-63 lowercase letters, digits
or hyphens.

| Route | Effect |
| --- | --- |
| `POST /sandboxes/<name>/run` with `{"agent": "claude" \| "codex", "prompt": "..."}` | Starts the container if needed and starts one headless run. 202 on start, 409 while a run is in progress. |
| `GET /sandboxes/<name>/run` | State of the latest run: `none`, `running`, `lost`, `succeeded` or `failed`, with `exitCode`, `result`, `stdoutTail` and `stderrTail` once finished. |
| `GET /sandboxes/<name>/container` | `{"running": boolean}`, read from `container.running` in the Durable Object. |
| `POST /sandboxes/<name>/stop` | Deletes the alarm and destroys the container. |

`lost` means the run's process is gone and no exit code was recorded: the instance was recycled
(its boot ID changed), the process was killed, or the container was stopped.

## Prerequisites

- A Cloudflare account with Containers (Sandbox) access, and `wrangler` able to log in to it.
- Docker running locally; `wrangler deploy` builds the image from `Dockerfile`.
- Node (a current LTS) and `npm`.
- A Claude subscription token: run `claude setup-token` and keep the printed `sk-ant-oat01-...`
  value.
- An OpenAI credential for Codex: an API key (`OPENAI_API_KEY` in the Worker) for the default path.
  A ChatGPT login is an open question, see "Codex authentication".
- Throwaway credentials only. The container can reach `github.com` and `api.github.com`, so any
  GitHub token or repository you hand an agent must be disposable. Use a scratch repository and a
  fine-grained token scoped to it, and revoke it afterwards. Use throwaway or spend-capped model
  credentials as well.

## Secrets

The Worker needs three secrets, named as in `secrets.required` in `wrangler.jsonc`:
`RUNNER_TOKEN`, `CLAUDE_CODE_OAUTH_TOKEN` and `OPENAI_API_KEY`. `wrangler deploy` fails when any is
missing. Supply them with `--secrets-file`; never commit the file.

```bash
cd spikes/cloudflare-sandbox
npm install

# .env.* is ignored by the repository's .gitignore; confirm before writing a secret to it.
git check-ignore -v .env.spike

cat > .env.spike <<EOF
RUNNER_TOKEN=$(openssl rand -hex 32)
CLAUDE_CODE_OAUTH_TOKEN=<value printed by claude setup-token>
OPENAI_API_KEY=<throwaway OpenAI API key>
EOF
chmod 600 .env.spike
```

The container never receives these. It receives placeholders (`placeholderTokens` in
`src/sandbox.ts`) in `CLAUDE_CODE_OAUTH_TOKEN` and `CODEX_API_KEY`.

## 1. Deploy

```bash
cd spikes/cloudflare-sandbox
npm run check
npx wrangler deploy --secrets-file .env.spike
```

Note the `https://cloudflare-sandbox-spike.<subdomain>.workers.dev` URL it prints, then:

```bash
export WORKER=https://cloudflare-sandbox-spike.<subdomain>.workers.dev
export RUNNER_TOKEN=<the RUNNER_TOKEN value from .env.spike>
auth=(-H "Authorization: Bearer $RUNNER_TOKEN")
```

The first deploy builds and pushes the image and can take several minutes; the first request to a
new image can also be slow while the container provisions. Keep a second terminal on
`npx wrangler tail` for the whole spike: blocked hosts appear there as
`Blocked https://<host>`.

Smoke test, which starts no container:

```bash
curl -s -o /dev/null -w '%{http_code}\n' "$WORKER/sandboxes/smoke/container"      # 401: no token
curl -s "${auth[@]}" "$WORKER/sandboxes/smoke/container"                          # {"running":false}
```

## 2. Claude Code headless with a placeholder token

```bash
curl -s "${auth[@]}" -X POST "$WORKER/sandboxes/claude1/run" \
  -H 'content-type: application/json' \
  -d '{"agent":"claude","prompt":"Reply with the single word: pong"}'
# {"state":"running","agent":"claude"}

until s=$(curl -s "${auth[@]}" "$WORKER/sandboxes/claude1/run"); \
  [ "$(printf '%s' "$s" | jq -r .state)" != running ]; do sleep 5; done
printf '%s\n' "$s" | jq .
```

Worked: `state` is `succeeded` and `result` is a model reply. The Worker treats a Claude Code run
as failed when the final `result` event has `is_error` true, even when the exit code is 0.

Not worked: read `stderrTail` and `stdoutTail`, and `wrangler tail`, and record the exact error.
See "If a CLI will not run with a placeholder".

## 3. Codex headless

```bash
curl -s "${auth[@]}" -X POST "$WORKER/sandboxes/codex1/run" \
  -H 'content-type: application/json' \
  -d '{"agent":"codex","prompt":"Reply with the single word: pong"}'

until s=$(curl -s "${auth[@]}" "$WORKER/sandboxes/codex1/run"); \
  [ "$(printf '%s' "$s" | jq -r .state)" != running ]; do sleep 5; done
printf '%s\n' "$s" | jq .
```

Codex runs with `CODEX_API_KEY` set to a placeholder, so it calls `api.openai.com` with an API-key
credential. Judge success and failure as for Claude Code, and record it in `RESULT.md`.

### Codex authentication

Which credential Codex uses is open. Two candidates:

- **API key** (`CODEX_API_KEY`, billed to the OpenAI API). Tested by this step and the default of
  the code. Only `api.openai.com` is involved.
- **ChatGPT login** (`~/.codex/auth.json` with access and refresh tokens, billed to the ChatGPT
  plan). Codex then likely calls `chatgpt.com` and refreshes tokens at `auth.openai.com`; neither
  is in `allowedHosts`, and `CredentialInjector` swaps only a bearer value, not an `auth.json`
  file with a refresh flow.

To test the ChatGPT path:

1. On your own machine run `codex login`, then look at which hosts a `codex exec` run reaches
   (for example with a local proxy or `lsof -i` while it runs). Record the hosts.
2. Compare with `allowedHosts`. In `wrangler tail`, a host that is not allowed shows as
   `Blocked https://<host>`.
3. Placing `auth.json` in the container puts a refreshable credential there, which is the
   fallback below: record it as such, with the hosts you had to allow.

Record in `RESULT.md` which of the two was used for each result, so the verdict names its
credential type.

## 4. Confirm the real token never reaches the container

There is no exec route, so inspect the container through an agent run: the agent runs shell
commands in the container, and its `result` carries the output. Use the sandbox name `inspect`.
Keep the prompt free of the real token, because the prompt is sent to the model API.

Environment of the container's processes, with values shown:

```bash
curl -s "${auth[@]}" -X POST "$WORKER/sandboxes/inspect/run" -H 'content-type: application/json' \
  -d '{"agent":"claude","prompt":"Run these shell commands and print their output verbatim, with no commentary: `env | sort`; then `for f in /proc/[0-9]*/environ; do tr \"\\0\" \"\\n\" < $f; done | sort -u`."}'
```

The only credential-shaped values must be the placeholders
`sk-ant-oat01-placeholder-not-a-real-token` and `sk-placeholder-not-a-real-token`.

Filesystem, matching token shapes while excluding the placeholders:

```bash
curl -s "${auth[@]}" -X POST "$WORKER/sandboxes/inspect/run" -H 'content-type: application/json' \
  -d '{"agent":"claude","prompt":"Run `grep -rIE \"sk-ant-[A-Za-z0-9_-]{20,}|sk-[A-Za-z0-9_-]{20,}\" / --exclude-dir=proc --exclude-dir=sys --exclude-dir=dev 2>/dev/null | grep -v placeholder | cut -c1-200` and print the output verbatim. Print the single word NONE if it prints nothing."}'
```

Poll `GET /sandboxes/inspect/run` as in step 2. Expected result: `NONE`. The `cut` limits how
much of any match is returned; a match is a finding to record, not output to paste anywhere.
Also grep for a distinctive fragment of each real secret by replacing the pattern with an 8
character fragment taken from the middle of the secret; do not use the start or the whole value.

Also confirm the swap happens: the step 2 and step 3 runs succeeding with placeholders is
the evidence, because the placeholder is rejected by the upstream API when it is sent as is.
For a direct check, a run whose prompt asks the agent to
`curl -s -o /dev/null -w '%{http_code}' https://api.anthropic.com/v1/models -H 'authorization: Bearer sk-ant-oat01-placeholder-not-a-real-token' -H 'anthropic-version: 2023-06-01' -H 'anthropic-beta: oauth-2025-04-20'`
should return 200 only because the Worker substituted the real token. Record the code.

Finally confirm the response redaction: ask the agent to print the response headers of that request
(`curl -sD -`) and check that nothing matches the real token.

## 5. Instance lifetime over 60-90 minutes

The Durable Object alarm fires every 60 seconds (`runCheckInterval`) while a run is in progress,
and the inactivity timeout is 30 minutes. The question is how long one container instance
actually lives under that alarm, and what happens when it is recycled.

Start one long run. The prompt makes the agent write a heartbeat of timestamp and boot ID, so the
instance's life is recorded inside the container:

```bash
curl -s "${auth[@]}" -X POST "$WORKER/sandboxes/long1/run" -H 'content-type: application/json' \
  -d '{"agent":"claude","prompt":"Keep a heartbeat for 80 minutes. Repeat this shell command, each time as a single foreground command that runs for about 8 minutes: `for i in $(seq 1 16); do echo \"$(date -u +%FT%TZ) $(cat /proc/sys/kernel/random/boot_id)\" >> /workspace/work/heartbeat.log; sleep 30; done`. Stop when the first line of /workspace/work/heartbeat.log is 80 minutes old. Then print the first and last line of the file, the number of distinct boot IDs in it, and any gap between consecutive lines longer than 90 seconds."}'
```

Sample from your own machine every 60 seconds, with a timestamp, into a local file:

```bash
while true; do
  printf '%s run=%s container=%s\n' "$(date -u +%FT%TZ)" \
    "$(curl -s "${auth[@]}" "$WORKER/sandboxes/long1/run" | jq -c '{state,exitCode}')" \
    "$(curl -s "${auth[@]}" "$WORKER/sandboxes/long1/container" | jq -c .running)"
  sleep 60
done | tee lifetime-samples.log
```

Reading the samples:

- The instance was recycled when `run` becomes `lost` with the run not finished, when `container`
  becomes `false` without a stop request, or when the agent's final report shows more than one
  boot ID in the heartbeat file. A restarted container has a new boot ID and an empty
  `/workspace`, so the heartbeat file of the new instance does not exist; if the run is `lost`,
  note the time of the last `running` sample as the lifetime bound.
- Lifetime is the time from the first heartbeat line to the last line under the same boot ID, or
  to the last `running` sample before `lost`. Record the start time, end time and how the end was
  detected.
- Keep `wrangler tail` open; `Run check failed` lines mean an alarm check errored, and the alarm
  reschedules itself after each one.
- Stop sampling when the run is `succeeded`, `failed` or `lost`.

If the instance lives the whole 80 minutes, record that as the lifetime with the run length. If you
cannot afford 90 minutes, record the shorter observed window and say so.

## 6. Forced stop

Start a run that outlasts the stop:

```bash
curl -s "${auth[@]}" -X POST "$WORKER/sandboxes/stop1/run" -H 'content-type: application/json' \
  -d '{"agent":"claude","prompt":"Run `sleep 300` as a shell command, then reply done."}'
sleep 20
curl -s "${auth[@]}" "$WORKER/sandboxes/stop1/container"     # {"running":true}
curl -s "${auth[@]}" -X POST "$WORKER/sandboxes/stop1/stop"  # {"running":false}
curl -s "${auth[@]}" "$WORKER/sandboxes/stop1/container"
curl -s "${auth[@]}" "$WORKER/sandboxes/stop1/run" | jq .
```

Record each response. What the Durable Object sees, in terms of the code: after `stop`,
`container.running` is `false` and `GET .../container` reports it. The stored run record has no
outcome, so `GET .../run` returns `{"state":"lost","agent":"claude"}`. A run whose outcome the
alarm had already stored before the stop returns that outcome instead; repeat the stop after a
run has finished (`succeeded`) to see this. Also record in `wrangler tail` whether any alarm or
error is logged after the stop, and whether a later `POST .../run` on the same name starts a
fresh container.

To force a stop the Worker did not request, stop or delete the container in the Cloudflare
dashboard (or `npx wrangler containers list` and the matching delete command) while a run is
in progress, then read the same two routes and record whether `running` is `false` and the run is
`lost`.

## 7. Cost per run

Cost is read after the fact, from the Cloudflare dashboard (Compute, Containers, and the Worker's
and Durable Object's metrics) and from the billing page, which lags usage. For each run in
`RESULT.md` record:

- the run: sandbox name, agent, prompt, start and end time (UTC), and instance lifetime;
- container usage over that window: instance type (`standard-1`), vCPU-seconds, memory GiB-seconds
  and disk GB-seconds as the dashboard reports them, and egress;
- Durable Object duration and request counts, and Worker requests;
- model usage: tokens or the subscription / API-key usage page for the window;
- the total in currency, with which numbers it came from and the date you read it.

Run the 80-minute run alone on its own account day, or with no other container running, so the
usage in its window belongs to it. Short runs are too small for the dashboard's resolution; record
"below dashboard resolution" instead of a figure.

## If a CLI will not run with a placeholder

A CLI that rejects the placeholder before sending a request checks the credential locally. Do not
guess; record:

1. The exact failure: `exitCode`, `stderrTail`, `stdoutTail`, and the `wrangler tail` lines.
2. Whether any request reached the Worker (a `Blocked ...` line, or none at all). No request at all
   means the check is local.
3. What the CLI checks locally: the token's prefix or length, an `auth.json` file, a login state,
   or a profile or account call made before the model call. Test by changing only the placeholder's
   shape (a longer value, a different prefix) in `placeholderTokens` and redeploying, and record
   which shape the CLI accepts.

If no placeholder shape works, the fallback is to put the real credential in the container: in
`agentEnv` in `src/sandbox.ts`, pass the real secret (`this.env`) instead of the placeholder for
that agent, redeploy, and rerun. This is a spike-only change; record it as the fallback and keep
the throwaway tokens. State in `RESULT.md` what the fallback exposes:

- the secret is in the environment of the agent process and every child of it, readable from
  `/proc/<pid>/environ` and by any command the agent or a prompt-injected instruction runs;
- the agent can send it to any allowed host, notably `github.com` and `api.github.com`, for
  example by pushing it to a repository or posting it as an issue comment, and `CredentialInjector`
  does not limit where it is valid;
- for a subscription token, the blast radius is that whole Claude subscription until the token is
  revoked; for an API key, the spend on that key; for a ChatGPT `auth.json`, the account and its
  refresh token.

Record the blast radius for each failed CLI, and the revocation steps you took.

## Clean up

```bash
npx wrangler delete
rm .env.spike
```

Revoke the Claude token (`claude setup-token` creates a new one; revoke the old one in your
account settings), the OpenAI key, and every GitHub token handed to an agent.
