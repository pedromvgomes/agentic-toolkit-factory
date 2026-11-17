import { WorkerEntrypoint } from "cloudflare:workers";
import { type CredentialHost, credentialHosts, deny, placeholderTokens } from "./sandbox";

type Credential = {
	// The request header that carries the credential, as `Bearer <token>`.
	header: string;
	placeholder: string;
	secret: (env: Env) => string | undefined;
};

// Claude Code authenticates a CLAUDE_CODE_OAUTH_TOKEN as `Authorization:
// Bearer <token>` and adds the OAuth capability to `anthropic-beta` itself, so
// only the token changes. Codex sends CODEX_API_KEY as `Authorization: Bearer
// <key>`.
const credentials: Record<CredentialHost, Credential> = {
	"api.anthropic.com": {
		header: "authorization",
		placeholder: placeholderTokens.claudeCodeOauthToken,
		secret: (env) => env.CLAUDE_CODE_OAUTH_TOKEN,
	},
	"api.openai.com": {
		header: "authorization",
		placeholder: placeholderTokens.codexApiKey,
		secret: (env) => env.OPENAI_API_KEY,
	},
};

const bearer = "Bearer ";

// Forwards HTTPS requests to a credentialed host, exchanging the container's
// placeholder credential for the real Worker secret. The intercept matches the
// TLS server name, but the request URL comes from the Host header, which the
// container controls, so the protocol and host are checked again here and the
// credential is chosen from the checked host.
//
// The real secret leaves this handler only in the request to its own host.
// Every occurrence of it in the response headers and body is replaced with the
// placeholder before the response reaches the container, and nothing here
// logs a header value.
export class CredentialInjector extends WorkerEntrypoint<Env> {
	async fetch(request: Request): Promise<Response> {
		const url = new URL(request.url);

		if (url.protocol !== "https:" || !isCredentialHost(url.hostname)) {
			return deny(url);
		}

		const credential = credentials[url.hostname];
		const presented = request.headers.get(credential.header);

		// A request without the placeholder carries no credential this handler
		// owns, so it is forwarded as sent.
		if (presented !== bearer + credential.placeholder) {
			return fetch(request, { redirect: "manual" });
		}

		const secret = credential.secret(this.env);

		if (!secret) {
			console.error(`No credential is configured for ${url.hostname}`);
			return new Response(`No credential is configured for ${url.hostname}\n`, {
				status: 502,
			});
		}

		const headers = new Headers(request.headers);
		headers.set(credential.header, bearer + secret);

		const response = await fetch(new Request(request, { headers, redirect: "manual" }));

		return redact(response, secret, credential.placeholder);
	}
}

function isCredentialHost(hostname: string): hostname is CredentialHost {
	return (credentialHosts as readonly string[]).includes(hostname);
}

function redact(response: Response, secret: string, placeholder: string): Response {
	const headers = new Headers();

	for (const [name, value] of response.headers) {
		headers.append(name, value.replaceAll(secret, placeholder));
	}

	if (response.body === null) {
		return new Response(null, {
			status: response.status,
			statusText: response.statusText,
			headers,
		});
	}

	// Replacing the secret changes the body length.
	headers.delete("content-length");

	const encoder = new TextEncoder();
	const body = response.body.pipeThrough(
		replaceBytes(encoder.encode(secret), encoder.encode(placeholder)),
	);

	return new Response(body, {
		status: response.status,
		statusText: response.statusText,
		headers,
	});
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
