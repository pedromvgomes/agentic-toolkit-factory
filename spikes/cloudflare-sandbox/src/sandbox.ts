import { Files, SandboxFileError } from "@cloudflare/sandbox";
import { DurableObject, WorkerEntrypoint } from "cloudflare:workers";
import { codexCredentials } from "./codex-credentials";

export type Agent = "claude" | "codex";

export type RunStatus =
	| { state: "none" }
	| { state: "running"; agent: Agent }
	| { state: "lost"; agent: Agent }
	| {
			state: "succeeded" | "failed";
			agent: Agent;
			exitCode: number;
			result: string;
			stdoutTail: string;
			stderrTail: string;
	  };

type RunRecord = { agent: Agent; startedAt: number; outcome?: RunStatus };

// The only hosts a request from the container can reach, and only over HTTPS.
export const allowedHosts: readonly string[] = [
	"github.com",
	"api.github.com",
	"proxy.golang.org",
	"sum.golang.org",
	"api.anthropic.com",
	"chatgpt.com",
	"auth.openai.com",
];

// The allowed hosts whose requests go through CredentialInjector, which
// exchanges the container's placeholder credential for the real one. Every
// other allowed host is reached through Egress with the request unchanged.
// chatgpt.com serves Codex's model and account requests on a ChatGPT login,
// and auth.openai.com is where Codex refreshes that login.
export const credentialHosts = ["api.anthropic.com", "chatgpt.com", "auth.openai.com"] as const;

export type CredentialHost = (typeof credentialHosts)[number];

// The container holds these values in place of real credentials. They are
// not secrets: a request that carries one reaches its host unauthenticated
// unless the handler registered for that host substitutes the real value.
// Codex's placeholders are in codex-credentials.ts.
export const placeholderTokens = {
	claudeCodeOauthToken: "sk-ant-oat01-placeholder-not-a-real-token",
} as const;

const workDirectory = "/workspace/work";
const runDirectory = "/workspace/run";
const stdoutPath = `${runDirectory}/stdout.log`;
const stderrPath = `${runDirectory}/stderr.log`;
const resultPath = `${runDirectory}/result`;
const pidPath = `${runDirectory}/pid`;
const lastMessagePath = `${runDirectory}/last-message.txt`;
// The image user's home. An exec receives only the environment it is given,
// so HOME is passed to every agent run rather than read from the image.
const agentHome = "/home/agent";
const codexHome = `${agentHome}/.codex`;

// The platform caps the inactivity timeout at 6 hours.
const inactivityTimeout = 30 * 60 * 1000;
// Code running inside the container is not Durable Object activity, so the
// alarm is what keeps the container alive while a run is in progress. It
// fires well inside the inactivity timeout.
const runCheckInterval = 60 * 1000;
const tailLength = 4000;
const runKey = "run";

const caPath = "/etc/cloudflare/certs/cloudflare-containers-ca.crt";
// Every HTTPS request from the container is intercepted and re-signed with
// this CA, so the CA alone is a complete trust store for every exec.
const trustEnv: Record<string, string> = {
	NODE_EXTRA_CA_CERTS: caPath,
	SSL_CERT_FILE: caPath,
	GIT_SSL_CAINFO: caPath,
	CURL_CA_BUNDLE: caPath,
	CODEX_CA_CERTIFICATE: caPath,
};

// Runs the command in its own process group with no stdin. Records its
// process ID and boot ID when it starts, and writes its exit code to the
// result file through a rename when it ends, so a reader never sees a
// partial result.
const runScript = `dir=$1; shift
setsid sh -c 'echo "$$ $(cat /proc/sys/kernel/random/boot_id)" >"$0/pid"; exec "$@"' \\
	"$dir" "$@" </dev/null >"$dir/stdout.log" 2>"$dir/stderr.log"
echo "$?" >"$dir/result.tmp" && mv "$dir/result.tmp" "$dir/result"`;

// Succeeds while the recorded process runs and started in this instance.
const runAliveScript = `read -r pid boot <"$1" &&
	[ "$boot" = "$(cat /proc/sys/kernel/random/boot_id)" ] &&
	kill -0 "$pid"`;

// Forwards HTTPS requests to an allowed host unchanged. The intercept
// matches the TLS server name, but the request URL comes from the Host
// header, which the container controls, so the host is checked again here.
export class Egress extends WorkerEntrypoint<Env> {
	fetch(request: Request): Promise<Response> | Response {
		const url = new URL(request.url);

		if (url.protocol !== "https:" || !allowedHosts.includes(url.hostname)) {
			return deny(url);
		}

		return fetch(request, { redirect: "manual" });
	}
}

// Rejects every request. Registered for plain HTTP and for every HTTPS host
// that has no intercept of its own.
export class Deny extends WorkerEntrypoint<Env> {
	fetch(request: Request): Response {
		return deny(new URL(request.url));
	}
}

export function deny(url: URL): Response {
	console.log(`Blocked ${url.protocol}//${url.hostname}`);
	return new Response(`${url.hostname} is not reachable from this sandbox\n`, {
		status: 403,
	});
}

export class AgentSandbox extends DurableObject<Env> {
	private readonly container: Container;
	private readonly files: Files;
	private setup: Promise<void> | undefined;

	constructor(ctx: DurableObjectState, env: Env) {
		super(ctx, env);

		const container = ctx.container;

		if (!container) {
			throw new Error("No container is configured");
		}

		this.container = container;
		this.files = new Files(container);

		// The inactivity timeout does not survive a Durable Object restart.
		if (container.running) {
			void ctx.blockConcurrencyWhile(() =>
				container.setInactivityTimeout(inactivityTimeout),
			);
		}
	}

	startRun(agent: Agent, prompt: string): Promise<"started" | "busy"> {
		return this.ctx.blockConcurrencyWhile(async () => {
			await this.ensureStarted();

			if ((await this.runStatus()).state === "running") {
				return "busy";
			}

			// The record goes before the run directory: a launch that throws after
			// the directory is gone must read as `none` or `lost`, never as a
			// `running` run with no pid file and no alarm left to check it.
			this.ctx.storage.kv.delete(runKey);
			await this.files.remove(runDirectory, { recursive: true, force: true });
			await this.files.mkdir(runDirectory, { recursive: true });
			await this.files.mkdir(workDirectory, { recursive: true });
			// Codex refuses to run outside a Git repository.
			await this.exec(["/bin/sh", "-c", "[ -d .git ] || git init -q"], workDirectory, {});

			if (agent === "codex") {
				// Written for every run, so a run never starts from an auth.json
				// an earlier run or agent changed.
				await this.files.mkdir(codexHome, { recursive: true });
				await this.files.writeFile(
					`${codexHome}/auth.json`,
					await codexCredentials(this.env).placeholderAuthJson(),
				);
			}

			await this.container.exec(
				["/bin/sh", "-c", runScript, "run", runDirectory, ...agentCommand(agent, prompt)],
				{
					cwd: workDirectory,
					env: { ...trustEnv, ...agentEnv(agent) },
					stdout: "ignore",
					stderr: "ignore",
				},
			);

			const record: RunRecord = { agent, startedAt: Date.now() };
			this.ctx.storage.kv.put(runKey, record);
			await this.ctx.storage.setAlarm(Date.now() + runCheckInterval);
			return "started";
		});
	}

	async readRun(): Promise<RunStatus> {
		if (!this.container.running) {
			const record = this.record();

			if (record === undefined) {
				return { state: "none" };
			}

			return record.outcome ?? { state: "lost", agent: record.agent };
		}

		return this.runStatus();
	}

	containerState(): { running: boolean } {
		return { running: this.container.running };
	}

	async stop(): Promise<void> {
		await this.ctx.storage.deleteAlarm();

		if (this.container.running) {
			await this.container.destroy("Stopped by request");
		}

		this.setup = undefined;
	}

	// Polls the result file. There is no callback when a process inside the
	// container exits, so the alarm reschedules itself until the result file
	// exists, and reschedules after any error so one failed check does not
	// let the container time out under a live run.
	async alarm(): Promise<void> {
		try {
			if (!this.container.running) {
				return;
			}

			const status = await this.runStatus();

			if (status.state === "running") {
				await this.ctx.storage.setAlarm(Date.now() + runCheckInterval);
				return;
			}

			const record = this.record();

			if (record !== undefined) {
				this.ctx.storage.kv.put(runKey, { ...record, outcome: status });
			}
		} catch (error) {
			console.error("Run check failed", error);
			await this.ctx.storage.setAlarm(Date.now() + runCheckInterval);
		}
	}

	private record(): RunRecord | undefined {
		return this.ctx.storage.kv.get<RunRecord>(runKey);
	}

	private async ensureStarted(): Promise<void> {
		// Sets up each new container, and a running container after this
		// Durable Object restarts, so no command runs before the intercepts.
		if (this.setup === undefined || !this.container.running) {
			this.setup = this.setUp().catch((error) => {
				this.setup = undefined;
				throw error;
			});
		}

		await this.setup;
	}

	private async setUp(): Promise<void> {
		try {
			// Intercepts end with the container, so they are registered for every
			// start. They are registered before start() because registering an
			// HTTPS intercept creates the CA file that the image's system CA
			// bundle links to, and the image entrypoint exits without it.
			await this.registerIntercepts();

			if (!this.container.running) {
				this.ctx.storage.kv.delete(runKey);
				this.container.start({
					image: this.container.images.agent,
					instance: "standard-1",
					enableInternet: false,
				});
			}

			await this.container.setInactivityTimeout(inactivityTimeout);
		} catch (error) {
			if (this.container.running) {
				await this.container.destroy();
			}

			throw error;
		}
	}

	// Outbound interception. Each allowed host has its own HTTPS intercept,
	// registered before the catch-all because an intercept registered after
	// "*" receives no requests. The handler registered for a host is the only
	// code that sees that host's requests, so it is where a host's
	// placeholder credential is exchanged for the real one.
	private async registerIntercepts(): Promise<void> {
		for (const host of allowedHosts) {
			const handler = (credentialHosts as readonly string[]).includes(host)
				? this.ctx.exports.CredentialInjector
				: this.ctx.exports.Egress;

			await this.container.interceptOutboundHttps(host, handler);
		}

		await this.container.interceptAllOutboundHttp(this.ctx.exports.Deny);
		await this.container.interceptOutboundHttps("*", this.ctx.exports.Deny);
	}

	private async runStatus(): Promise<RunStatus> {
		const record = this.record();

		if (record === undefined) {
			return { state: "none" };
		}

		const result = await this.readOptionalText(resultPath);

		if (result !== undefined) {
			return this.outcome(record.agent, Number.parseInt(result, 10));
		}

		if ((await this.readOptionalText(pidPath)) === undefined) {
			// The run writes its process ID right after it starts.
			return { state: "running", agent: record.agent };
		}

		const probe = await this.exec(["/bin/sh", "-c", runAliveScript, "probe", pidPath], "/", {});

		if (probe.exitCode === 0) {
			return { state: "running", agent: record.agent };
		}

		// The run can finish between the first read and the probe.
		const lateResult = await this.readOptionalText(resultPath);

		if (lateResult !== undefined) {
			return this.outcome(record.agent, Number.parseInt(lateResult, 10));
		}

		return { state: "lost", agent: record.agent };
	}

	private async outcome(agent: Agent, exitCode: number): Promise<RunStatus> {
		const stdout = (await this.readOptionalText(stdoutPath)) ?? "";
		const stderr = (await this.readOptionalText(stderrPath)) ?? "";
		let succeeded = exitCode === 0;
		let result = "";

		if (agent === "claude") {
			// Claude Code exits 0 even when a model request fails; the final
			// "result" event carries the real outcome.
			const event = lastResultEvent(stdout);
			succeeded = succeeded && event !== undefined && !event.is_error;
			result = event?.result ?? event?.subtype ?? "";
		} else {
			result = (await this.readOptionalText(lastMessagePath)) ?? "";
		}

		return {
			state: succeeded ? "succeeded" : "failed",
			agent,
			exitCode,
			result,
			stdoutTail: stdout.slice(-tailLength),
			stderrTail: stderr.slice(-tailLength),
		};
	}

	private async readOptionalText(path: string): Promise<string | undefined> {
		try {
			return await (await this.files.readFile(path)).text();
		} catch (error) {
			if (SandboxFileError.is(error) && error.code === "ENOENT") {
				return undefined;
			}

			throw error;
		}
	}

	private async exec(
		command: string[],
		cwd: string,
		env: Record<string, string>,
	): Promise<{ exitCode: number; stdout: string; stderr: string }> {
		const process = await this.container.exec(command, { cwd, env });
		const output = await process.output();
		const decoder = new TextDecoder();

		return {
			exitCode: output.exitCode,
			stdout: decoder.decode(output.stdout),
			stderr: decoder.decode(output.stderr),
		};
	}
}

function agentCommand(agent: Agent, prompt: string): string[] {
	if (agent === "claude") {
		// --bare is never passed: bare mode ignores CLAUDE_CODE_OAUTH_TOKEN.
		return [
			"claude",
			"--print",
			"--output-format",
			"stream-json",
			"--verbose",
			"--dangerously-skip-permissions",
			"--no-session-persistence",
			"--",
			prompt,
		];
	}

	return [
		"codex",
		"exec",
		"--json",
		"--ephemeral",
		"--dangerously-bypass-approvals-and-sandbox",
		"--output-last-message",
		lastMessagePath,
		"--config",
		"analytics.enabled=false",
		"--config",
		"check_for_update_on_startup=false",
		// The plugin marketplace sync clones a repository on every run.
		"--config",
		"features.plugins=false",
		// Reads the login from $CODEX_HOME/auth.json, never from a keyring.
		"--config",
		'cli_auth_credentials_store="file"',
		"--",
		prompt,
	];
}

// The container environment carries placeholders only; real credentials
// exist only in the Worker, as secrets and in CodexCredentials' storage.
function agentEnv(agent: Agent): Record<string, string> {
	const common = { HOME: agentHome };

	if (agent === "claude") {
		return {
			...common,
			CLAUDE_CODE_OAUTH_TOKEN: placeholderTokens.claudeCodeOauthToken,
			// Turns off update checks, telemetry and error reporting, so the
			// model API is the only host Claude Code calls.
			CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: "1",
		};
	}

	// The ChatGPT login is the placeholder auth.json in CODEX_HOME.
	return { ...common, CODEX_HOME: codexHome };
}

type ResultEvent = {
	type: "result";
	subtype?: string;
	is_error: boolean;
	result?: string;
};

function lastResultEvent(stdout: string): ResultEvent | undefined {
	let last: ResultEvent | undefined;

	for (const line of stdout.split("\n")) {
		const parsed = parseJson(line);

		if (isResultEvent(parsed)) {
			last = parsed;
		}
	}

	return last;
}

function isResultEvent(value: unknown): value is ResultEvent {
	if (typeof value !== "object" || value === null) {
		return false;
	}

	const event = value as Record<string, unknown>;
	return (
		event.type === "result" &&
		typeof event.is_error === "boolean" &&
		(event.result === undefined || typeof event.result === "string") &&
		(event.subtype === undefined || typeof event.subtype === "string")
	);
}

function parseJson(line: string): unknown {
	try {
		return JSON.parse(line);
	} catch {
		return undefined;
	}
}
