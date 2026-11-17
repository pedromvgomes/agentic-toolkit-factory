import type { Agent, AgentSandbox } from "./sandbox";

export { CredentialInjector } from "./outbound";
export { AgentSandbox, Deny, Egress } from "./sandbox";

declare global {
	interface Env {
		SANDBOX: DurableObjectNamespace<AgentSandbox>;
		// Bearer token every request to this Worker must present.
		RUNNER_TOKEN: string;
		// Real agent credentials. They exist only as Worker secrets and are
		// never passed into the container.
		CLAUDE_CODE_OAUTH_TOKEN: string;
		OPENAI_API_KEY: string;
	}

	namespace Cloudflare {
		interface GlobalProps {
			mainModule: typeof import("./index");
			durableNamespaces: "AgentSandbox";
		}
	}
}

const sandboxName = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

// Linux rejects a command argument of 128 KiB or more, including its NUL byte.
const maxPromptBytes = 128 * 1024 - 1;

const agents: readonly Agent[] = ["claude", "codex"];

// Routes:
//   POST /sandboxes/<name>/run        {"agent": "claude" | "codex", "prompt": "..."}
//   GET  /sandboxes/<name>/run        state of the latest run
//   GET  /sandboxes/<name>/container  {"running": boolean}
//   POST /sandboxes/<name>/stop       destroys the container
export default {
	async fetch(request: Request, env: Env): Promise<Response> {
		if (!(await authorized(request, env))) {
			return new Response("Unauthorized", { status: 401 });
		}

		const url = new URL(request.url);
		const match = /^\/sandboxes\/([^/]+)\/(run|container|stop)$/.exec(url.pathname);

		if (!match) {
			return new Response("Not found", { status: 404 });
		}

		const [, name, resource] = match;

		if (!sandboxName.test(name)) {
			return new Response(
				"The sandbox name must be 1-63 lowercase letters, digits, or hyphens, with no hyphen at either end",
				{ status: 400 },
			);
		}

		const sandbox = env.SANDBOX.getByName(name);

		try {
			if (resource === "run" && request.method === "POST") {
				const body = parseRunRequest(await request.json().catch(() => null));

				if (body === undefined) {
					return new Response('Send {"agent": "claude" | "codex", "prompt": "..."}', {
						status: 400,
					});
				}

				if (new TextEncoder().encode(body.prompt).byteLength > maxPromptBytes) {
					return new Response("Send a prompt smaller than 128 KiB", { status: 413 });
				}

				if ((await sandbox.startRun(body.agent, body.prompt)) === "busy") {
					return new Response("A run is already in progress", { status: 409 });
				}

				return Response.json({ state: "running", agent: body.agent }, { status: 202 });
			}

			if (resource === "run" && request.method === "GET") {
				return Response.json(await sandbox.readRun());
			}

			if (resource === "container" && request.method === "GET") {
				return Response.json(await sandbox.containerState());
			}

			if (resource === "stop" && request.method === "POST") {
				await sandbox.stop();
				return Response.json({ running: false });
			}

			return new Response("Method not allowed", { status: 405 });
		} catch (error) {
			console.error("Sandbox request failed", error);
			return new Response("Sandbox request failed", { status: 500 });
		}
	},
} satisfies ExportedHandler<Env>;

function parseRunRequest(value: unknown): { agent: Agent; prompt: string } | undefined {
	if (typeof value !== "object" || value === null) {
		return undefined;
	}

	const { agent, prompt } = value as Record<string, unknown>;

	if (!agents.includes(agent as Agent) || typeof prompt !== "string" || prompt.trim() === "") {
		return undefined;
	}

	return { agent: agent as Agent, prompt };
}

// Compares digests so the comparison time does not depend on where the
// presented token first differs from the expected one.
async function authorized(request: Request, env: Env): Promise<boolean> {
	const header = request.headers.get("authorization") ?? "";
	const presented = header.startsWith("Bearer ") ? header.slice("Bearer ".length) : "";

	if (presented === "" || !env.RUNNER_TOKEN) {
		return false;
	}

	const encoder = new TextEncoder();
	const [a, b] = await Promise.all([
		crypto.subtle.digest("SHA-256", encoder.encode(presented)),
		crypto.subtle.digest("SHA-256", encoder.encode(env.RUNNER_TOKEN)),
	]);

	return crypto.subtle.timingSafeEqual(a, b);
}
