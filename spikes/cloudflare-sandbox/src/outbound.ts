import { WorkerEntrypoint } from "cloudflare:workers";
import {
	type CodexTokens,
	type RefreshResult,
	codexCredentials,
	codexPlaceholders,
	codexRedactions,
	placeholderIdToken,
} from "./codex-credentials";
import { type CredentialHost, credentialHosts, deny, placeholderTokens } from "./sandbox";

type Redaction = [secret: string, placeholder: string];

const bearer = "Bearer ";
// Codex sends `tokens.account_id` from auth.json in this header.
const accountIdHeader = "chatgpt-account-id";

// Forwards HTTPS requests to a credentialed host, exchanging the container's
// placeholder credential for the real one. The intercept matches the TLS
// server name, but the request URL comes from the Host header, which the
// container controls, so the protocol and host are checked again here and the
// credential is chosen from the checked host.
//
// A real credential leaves this handler only in a request to its own host.
// Every occurrence of it in the response headers and body is replaced with
// its placeholder before the response reaches the container, and nothing here
// logs a header value.
export class CredentialInjector extends WorkerEntrypoint<Env> {
	async fetch(request: Request): Promise<Response> {
		const url = new URL(request.url);

		if (url.protocol !== "https:" || !isCredentialHost(url.hostname)) {
			return deny(url);
		}

		switch (url.hostname) {
			case "api.anthropic.com":
				return this.claude(request);
			case "chatgpt.com":
				return this.chatgpt(request);
			case "auth.openai.com":
				return this.codexRefresh(request, url);
		}
	}

	// Claude Code authenticates a CLAUDE_CODE_OAUTH_TOKEN as `Authorization:
	// Bearer <token>` and adds the OAuth capability to `anthropic-beta`
	// itself, so only the token changes.
	private async claude(request: Request): Promise<Response> {
		// A request without the placeholder carries no credential this handler
		// owns, so it is forwarded as sent.
		if (request.headers.get("authorization") !== bearer + placeholderTokens.claudeCodeOauthToken) {
			return fetch(request, { redirect: "manual" });
		}

		const secret = this.env.CLAUDE_CODE_OAUTH_TOKEN;

		if (!secret) {
			console.error("No credential is configured for api.anthropic.com");
			return new Response("No credential is configured for api.anthropic.com\n", {
				status: 502,
			});
		}

		const headers = new Headers(request.headers);
		headers.set("authorization", bearer + secret);

		const response = await fetch(new Request(request, { headers, redirect: "manual" }));

		return redact(response, [[secret, placeholderTokens.claudeCodeOauthToken]]);
	}

	// Codex's model, account and usage requests. The access token comes from
	// CodexCredentials, which refreshes it first when it is about to expire;
	// a 401 refreshes it once more and the request is retried with the new
	// token, the body having been buffered for that.
	private async chatgpt(request: Request): Promise<Response> {
		// A WebSocket's frames cannot be redacted. Codex falls back to HTTPS for
		// the rest of the session when the handshake is answered with 426.
		if (request.headers.get("upgrade")?.toLowerCase() === "websocket") {
			return new Response("Use HTTPS\n", { status: 426 });
		}

		if (request.headers.get("authorization") !== bearer + codexPlaceholders.accessToken) {
			return fetch(request, { redirect: "manual" });
		}

		const store = codexCredentials(this.env);
		const current = await store.current();

		// Answered as a rejected token, so Codex runs its own recovery: its
		// refresh request reaches codexRefresh, which returns the token
		// endpoint's redacted error.
		if (!current.ok) {
			return new Response("The ChatGPT login could not be refreshed\n", { status: 401 });
		}

		const body = request.body === null ? null : await request.arrayBuffer();
		const used = [current.tokens];
		let response = await fetch(withCodexToken(request, body, current.tokens));

		if (response.status === 401) {
			const refreshed = await store.refreshAfter(current.tokens.accessToken);

			if (refreshed.ok && refreshed.tokens.accessToken !== current.tokens.accessToken) {
				await response.body?.cancel();
				used.push(refreshed.tokens);
				response = await fetch(withCodexToken(request, body, refreshed.tokens));
			}
		}

		return redact(response, used.flatMap(codexRedactions));
	}

	// Codex's refresh request. A refresh presenting the placeholder refresh
	// token is answered here, never forwarded: CodexCredentials refreshes the
	// real pair in its queue and stores it, and the container receives the
	// placeholders again. Any other request is forwarded as sent.
	private async codexRefresh(request: Request, url: URL): Promise<Response> {
		const body = request.body === null ? null : await request.arrayBuffer();

		if (
			request.method !== "POST" ||
			url.pathname !== "/oauth/token" ||
			!isPlaceholderRefresh(body)
		) {
			return fetch(
				new Request(request.url, {
					method: request.method,
					headers: request.headers,
					body,
					redirect: "manual",
				}),
			);
		}

		const store = codexCredentials(this.env);
		// Concurrent refresh requests read the same pair, so only the first
		// one refreshes it.
		const seen = await store.snapshot();
		const result: RefreshResult = await store.refreshAfter(seen.accessToken);

		if (!result.ok) {
			return new Response(result.body, {
				status: result.status,
				headers: result.contentType ? { "content-type": result.contentType } : {},
			});
		}

		return Response.json({
			id_token: placeholderIdToken(result.tokens),
			access_token: codexPlaceholders.accessToken,
			refresh_token: codexPlaceholders.refreshToken,
		});
	}
}

function isCredentialHost(hostname: string): hostname is CredentialHost {
	return (credentialHosts as readonly string[]).includes(hostname);
}

// Codex sends its refresh as JSON.
function isPlaceholderRefresh(body: ArrayBuffer | null): boolean {
	if (body === null) {
		return false;
	}

	try {
		const grant: unknown = JSON.parse(new TextDecoder().decode(body));
		return (
			typeof grant === "object" &&
			grant !== null &&
			(grant as Record<string, unknown>).grant_type === "refresh_token" &&
			(grant as Record<string, unknown>).refresh_token === codexPlaceholders.refreshToken
		);
	} catch {
		return false;
	}
}

function withCodexToken(request: Request, body: ArrayBuffer | null, tokens: CodexTokens): Request {
	const headers = new Headers(request.headers);
	headers.set("authorization", bearer + tokens.accessToken);

	if (tokens.accountId !== undefined) {
		headers.set(accountIdHeader, tokens.accountId);
	}

	return new Request(request.url, {
		method: request.method,
		headers,
		body,
		redirect: "manual",
	});
}

function redact(response: Response, redactions: readonly Redaction[]): Response {
	const active = redactions.filter(([secret]) => secret !== "");
	const headers = new Headers();

	for (const [name, value] of response.headers) {
		headers.append(name, replaceAll(value, active));
	}

	if (response.body === null) {
		return new Response(null, {
			status: response.status,
			statusText: response.statusText,
			headers,
		});
	}

	// Replacing a secret changes the body length.
	headers.delete("content-length");

	const encoder = new TextEncoder();
	let body = response.body;

	for (const [secret, placeholder] of active) {
		body = body.pipeThrough(replaceBytes(encoder.encode(secret), encoder.encode(placeholder)));
	}

	return new Response(body, {
		status: response.status,
		statusText: response.statusText,
		headers,
	});
}

function replaceAll(value: string, redactions: readonly Redaction[]): string {
	let replaced = value;

	for (const [secret, placeholder] of redactions) {
		replaced = replaced.replaceAll(secret, placeholder);
	}

	return replaced;
}

// Replaces every occurrence of `needle` in a byte stream, including one split
// across chunks. Only a chunk's trailing bytes that could begin an occurrence
// are held back, so a streamed response that never contains the needle is
// delivered without waiting for the next chunk.
function replaceBytes(
	needle: Uint8Array,
	replacement: Uint8Array,
): TransformStream<Uint8Array, Uint8Array> {
	let pending = new Uint8Array(0);

	return new TransformStream({
		transform(chunk, controller) {
			const buffer = concat(pending, chunk);
			let start = 0;
			let match = indexOf(buffer, needle, start);

			while (match !== -1) {
				if (match > start) {
					controller.enqueue(buffer.slice(start, match));
				}

				controller.enqueue(replacement.slice());
				start = match + needle.length;
				match = indexOf(buffer, needle, start);
			}

			const held = partialMatchLength(buffer, start, needle);
			const end = buffer.length - held;

			if (end > start) {
				controller.enqueue(buffer.slice(start, end));
			}

			pending = buffer.slice(end);
		},
		flush(controller) {
			if (pending.length > 0) {
				controller.enqueue(pending);
			}
		},
	});
}

function concat(a: Uint8Array, b: Uint8Array): Uint8Array {
	if (a.length === 0) {
		return b;
	}

	const joined = new Uint8Array(a.length + b.length);
	joined.set(a, 0);
	joined.set(b, a.length);
	return joined;
}

function indexOf(haystack: Uint8Array, needle: Uint8Array, from: number): number {
	for (let i = from; i + needle.length <= haystack.length; i++) {
		if (matchesAt(haystack, i, needle, needle.length)) {
			return i;
		}
	}

	return -1;
}

// The length of the longest suffix of `buffer[from:]` that is a proper
// prefix of `needle`.
function partialMatchLength(buffer: Uint8Array, from: number, needle: Uint8Array): number {
	for (let length = Math.min(needle.length - 1, buffer.length - from); length > 0; length--) {
		if (matchesAt(buffer, buffer.length - length, needle, length)) {
			return length;
		}
	}

	return 0;
}

function matchesAt(haystack: Uint8Array, at: number, needle: Uint8Array, length: number): boolean {
	for (let j = 0; j < length; j++) {
		if (haystack[at + j] !== needle[j]) {
			return false;
		}
	}

	return true;
}
