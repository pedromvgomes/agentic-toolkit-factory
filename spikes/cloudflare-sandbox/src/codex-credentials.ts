import { DurableObject } from "cloudflare:workers";

// The ChatGPT login Codex authenticates with. The real token pair lives only
// in this Durable Object's storage; the container's auth.json holds the
// placeholders below.
//
// Codex (rust-v0.169.0, codex-rs/login) reads $CODEX_HOME/auth.json, sends the
// access token as `Authorization: Bearer <token>` and `tokens.account_id` as
// `chatgpt-account-id` to chatgpt.com, and refreshes by POSTing JSON
// `{client_id, grant_type: "refresh_token", refresh_token}` to
// https://auth.openai.com/oauth/token. It refreshes on its own only when the
// access token's `exp` claim is within five minutes, or after a 401. The
// placeholder access token expires in 2100, so a refresh reaches this Worker
// only as the recovery from a 401, and the refresh endpoint is intercepted.
//
// Refresh tokens are single-use: two refreshes presenting the same one leave
// the login broken. Every read and rotation of the pair runs through one
// queue in this object, and there is one object for the login, so the
// Worker never races itself. Any other holder of the login, such as the
// auth.json it was exported from, is a refresher this queue cannot see, so
// the login is used by this Worker alone and by one Codex run at a time.

export const codexRefreshUrl = "https://auth.openai.com/oauth/token";
// Codex's built-in OAuth client ID, used when the login records no other.
const defaultClientId = "app_EMoamEEZ73f0CkXaXp7hrann";
// Codex refreshes an access token that expires within this window.
const refreshWindowSeconds = 5 * 60;
// 2100-01-01T00:00:00Z.
const placeholderExpiry = 4102444800;
const authClaim = "https://api.openai.com/auth";
const tokensKey = "tokens";

function base64UrlEncode(text: string): string {
	const bytes = new TextEncoder().encode(text);
	let binary = "";

	for (const byte of bytes) {
		binary += String.fromCharCode(byte);
	}

	return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

function base64Decode(value: string): string {
	const normalized = value.replaceAll("-", "+").replaceAll("_", "/");
	const padded = normalized + "=".repeat((4 - (normalized.length % 4)) % 4);
	const binary = atob(padded);
	return new TextDecoder().decode(Uint8Array.from(binary, (c) => c.charCodeAt(0)));
}

// Codex checks only that a JWT has three non-empty segments and a JSON
// payload; it never verifies the signature.
function placeholderJwt(payload: Record<string, unknown>): string {
	const header = base64UrlEncode(JSON.stringify({ alg: "RS256", typ: "JWT" }));
	return `${header}.${base64UrlEncode(JSON.stringify(payload))}.placeholder-signature`;
}

// The container's tokens. None of them is accepted by any OpenAI host; they
// are exchanged for the real ones by CredentialInjector.
export const codexPlaceholders = {
	accessToken: placeholderJwt({ exp: placeholderExpiry }),
	refreshToken: "rt_placeholder-not-a-real-token",
} as const;

function jwtPayload(jwt: string): Record<string, unknown> | undefined {
	const payload = jwt.split(".")[1];

	if (!payload) {
		return undefined;
	}

	try {
		const parsed: unknown = JSON.parse(base64Decode(payload));
		return typeof parsed === "object" && parsed !== null
			? (parsed as Record<string, unknown>)
			: undefined;
	} catch {
		return undefined;
	}
}

function authClaims(jwt: string): Record<string, unknown> {
	const claims = jwtPayload(jwt)?.[authClaim];
	return typeof claims === "object" && claims !== null ? (claims as Record<string, unknown>) : {};
}

export type CodexTokens = {
	idToken: string;
	accessToken: string;
	refreshToken: string;
	// Sent as `chatgpt-account-id`; Codex reads it from `tokens.account_id`.
	accountId: string | undefined;
	clientId: string;
	refreshUrl: string;
};

type StoredTokens = CodexTokens & {
	// SHA-256 of the CODEX_AUTH_JSON the pair was seeded from. A different
	// secret is a different login, which replaces the stored pair.
	seed: string;
};

export type RefreshResult =
	| { ok: true; tokens: CodexTokens }
	// The token endpoint's rejection, with every real token in the body
	// replaced by its placeholder.
	| { ok: false; status: number; contentType: string | null; body: string };

// The container's ID token. The account ID and plan type are the login's
// own: Codex refuses a ChatGPT login with no plan type, and matches the
// account ID against the workspaces chatgpt.com returns for the login before
// it routes a request. It carries no email, user ID or signature.
export function placeholderIdToken(tokens: CodexTokens): string {
	const real = authClaims(tokens.idToken);

	return placeholderJwt({
		exp: placeholderExpiry,
		[authClaim]: {
			chatgpt_account_id: tokens.accountId,
			chatgpt_plan_type: real.chatgpt_plan_type,
			chatgpt_account_is_fedramp: real.chatgpt_account_is_fedramp === true,
		},
	});
}

// The auth.json written to $CODEX_HOME in the container.
export function placeholderAuthJson(tokens: CodexTokens, now: Date): string {
	return `${JSON.stringify(
		{
			auth_mode: "chatgpt",
			OPENAI_API_KEY: null,
			tokens: {
				id_token: placeholderIdToken(tokens),
				access_token: codexPlaceholders.accessToken,
				refresh_token: codexPlaceholders.refreshToken,
				account_id: tokens.accountId,
			},
			// Codex treats a login without last_refresh as having no token data.
			last_refresh: now.toISOString(),
		},
		null,
		2,
	)}\n`;
}

// Each real token paired with the value that replaces it in anything sent
// back to the container.
export function codexRedactions(tokens: CodexTokens): [secret: string, placeholder: string][] {
	return [
		[tokens.accessToken, codexPlaceholders.accessToken],
		[tokens.refreshToken, codexPlaceholders.refreshToken],
		[tokens.idToken, placeholderIdToken(tokens)],
	];
}

function redactTokens(text: string, tokens: CodexTokens): string {
	let redacted = text;

	for (const [secret, placeholder] of codexRedactions(tokens)) {
		redacted = redacted.replaceAll(secret, placeholder);
	}

	return redacted;
}

// The one credential store, so every request for the login shares its queue.
export function codexCredentials(env: Env): DurableObjectStub<CodexCredentials> {
	return env.CODEX_CREDENTIALS.getByName("chatgpt-login");
}

export class CodexCredentials extends DurableObject<Env> {
	private queue: Promise<unknown> = Promise.resolve();

	// The current pair, refreshed first when the access token is within
	// Codex's refresh window.
	current(): Promise<RefreshResult> {
		return this.serialized(async () => {
			const tokens = await this.load();

			if (!expiresSoon(tokens.accessToken)) {
				return { ok: true, tokens };
			}

			return this.rotate(tokens);
		});
	}

	// The stored pair as it is, without refreshing it.
	snapshot(): Promise<CodexTokens> {
		return this.serialized(() => this.load());
	}

	// Refreshes the pair unless it changed since `staleAccessToken` was read,
	// so every caller holding the same rejected token causes one refresh.
	refreshAfter(staleAccessToken: string): Promise<RefreshResult> {
		return this.serialized(async () => {
			const tokens = await this.load();

			if (tokens.accessToken !== staleAccessToken) {
				return { ok: true, tokens };
			}

			return this.rotate(tokens);
		});
	}

	async placeholderAuthJson(): Promise<string> {
		const result = await this.current();

		if (!result.ok) {
			throw new Error(`The Codex login could not be refreshed (${result.status})`);
		}

		return placeholderAuthJson(result.tokens, new Date());
	}

	private serialized<T>(task: () => Promise<T>): Promise<T> {
		const run = this.queue.then(task, task);
		this.queue = run.catch(() => undefined);
		return run;
	}

	private async load(): Promise<CodexTokens> {
		const secret = this.env.CODEX_AUTH_JSON;

		if (!secret) {
			throw new Error("CODEX_AUTH_JSON is not configured");
		}

		const seed = await sha256(secret);
		const stored = this.ctx.storage.kv.get<StoredTokens>(tokensKey);

		if (stored !== undefined && stored.seed === seed) {
			const { seed: _, ...tokens } = stored;
			return tokens;
		}

		const tokens = parseAuthJson(base64Decode(secret.trim()));
		this.ctx.storage.kv.put(tokensKey, { ...tokens, seed });
		return tokens;
	}

	// The only code that presents a refresh token. It runs inside the queue,
	// and stores the rotated pair before any caller sees it.
	private async rotate(tokens: CodexTokens): Promise<RefreshResult> {
		const response = await fetch(tokens.refreshUrl, {
			method: "POST",
			headers: { "content-type": "application/json", accept: "application/json" },
			body: JSON.stringify({
				client_id: tokens.clientId,
				grant_type: "refresh_token",
				refresh_token: tokens.refreshToken,
			}),
			redirect: "manual",
		});
		const body = await response.text();

		if (!response.ok) {
			console.error(`Codex token refresh failed with ${response.status}`);
			return {
				ok: false,
				status: response.status,
				contentType: response.headers.get("content-type"),
				body: redactTokens(body, tokens),
			};
		}

		const refreshed = parseRefreshResponse(body);

		if (refreshed === undefined) {
			console.error("Codex token refresh returned an unreadable body");
			return {
				ok: false,
				status: 502,
				contentType: "text/plain",
				body: "The token endpoint returned an unreadable response\n",
			};
		}

		// Each field is optional in the response; an absent one keeps its value.
		const rotated: CodexTokens = {
			...tokens,
			idToken: refreshed.id_token ?? tokens.idToken,
			accessToken: refreshed.access_token ?? tokens.accessToken,
			refreshToken: refreshed.refresh_token ?? tokens.refreshToken,
		};
		const stored = this.ctx.storage.kv.get<StoredTokens>(tokensKey);
		this.ctx.storage.kv.put(tokensKey, { ...rotated, seed: stored?.seed ?? "" });
		return { ok: true, tokens: rotated };
	}
}

function expiresSoon(accessToken: string): boolean {
	const exp = jwtPayload(accessToken)?.exp;

	// Without a readable expiry the token is used until it is rejected.
	if (typeof exp !== "number") {
		return false;
	}

	return exp <= Date.now() / 1000 + refreshWindowSeconds;
}

function parseAuthJson(text: string): CodexTokens {
	const parsed: unknown = JSON.parse(text);
	const tokens =
		typeof parsed === "object" && parsed !== null
			? (parsed as Record<string, unknown>).tokens
			: undefined;

	if (typeof tokens !== "object" || tokens === null) {
		throw new Error("CODEX_AUTH_JSON has no tokens object");
	}

	const { id_token, access_token, refresh_token, account_id, oauth_provenance } =
		tokens as Record<string, unknown>;

	if (
		typeof id_token !== "string" ||
		typeof access_token !== "string" ||
		typeof refresh_token !== "string" ||
		refresh_token === ""
	) {
		throw new Error("CODEX_AUTH_JSON lacks id_token, access_token or refresh_token");
	}

	const provenance =
		typeof oauth_provenance === "object" && oauth_provenance !== null
			? (oauth_provenance as Record<string, unknown>)
			: {};
	const issuer = typeof provenance.issuer === "string" ? provenance.issuer : undefined;
	const clientId = typeof provenance.client_id === "string" ? provenance.client_id : undefined;
	const claimedAccount = authClaims(id_token).chatgpt_account_id;

	return {
		idToken: id_token,
		accessToken: access_token,
		refreshToken: refresh_token,
		accountId:
			typeof account_id === "string"
				? account_id
				: typeof claimedAccount === "string"
					? claimedAccount
					: undefined,
		// Codex refreshes at the issuer recorded with the login, and at
		// auth.openai.com when none is recorded.
		clientId: clientId ?? defaultClientId,
		refreshUrl: issuer ? `${issuer.replace(/\/+$/, "")}/oauth/token` : codexRefreshUrl,
	};
}

function parseRefreshResponse(
	text: string,
): { id_token?: string; access_token?: string; refresh_token?: string } | undefined {
	let parsed: unknown;

	try {
		parsed = JSON.parse(text);
	} catch {
		return undefined;
	}

	if (typeof parsed !== "object" || parsed === null) {
		return undefined;
	}

	const fields = parsed as Record<string, unknown>;
	const optionalString = (value: unknown) => (typeof value === "string" ? value : undefined);

	return {
		id_token: optionalString(fields.id_token),
		access_token: optionalString(fields.access_token),
		refresh_token: optionalString(fields.refresh_token),
	};
}

async function sha256(text: string): Promise<string> {
	const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
	return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}
