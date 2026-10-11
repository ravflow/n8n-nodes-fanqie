import { randomBytes, createHash, timingSafeEqual } from 'node:crypto';

export class LoginError extends Error {
	constructor(status, code, message) {
		super(message);
		this.status = status;
		this.code = code;
	}
}

const digest = (value) => createHash('sha256').update(value).digest('base64url');
const random = () => randomBytes(32).toString('base64url');
const matches = (a, b) =>
	timingSafeEqual(Buffer.from(digest(String(a))), Buffer.from(digest(String(b))));

export function validateConfig(config) {
	const url = new URL(config.publicUrl);
	const httpAllowed = config.allowInsecureHttp === true;
	if (
		!['https:', ...(httpAllowed ? ['http:'] : [])].includes(url.protocol) ||
		url.username ||
		url.password ||
		url.search ||
		url.hash ||
		url.pathname !== '/'
	)
		throw new Error(
			'PUBLIC_URL must be an HTTPS origin. LAN HTTP requires ALLOW_INSECURE_HTTP=true.',
		);
	if (!config.clientId || !config.clientSecret || config.clientSecret.length < 32)
		throw new Error('Configure CLIENT_ID and a random CLIENT_SECRET of at least 32 characters.');
	const redirects = config.redirectUris.map((value) => {
		const redirect = new URL(value);
		if (
			!['https:', ...(httpAllowed ? ['http:'] : [])].includes(redirect.protocol) ||
			redirect.username ||
			redirect.password ||
			redirect.hash ||
			redirect.search ||
			!redirect.pathname.endsWith('/rest/oauth2-credential/callback')
		)
			throw new Error('REDIRECT_URIS must contain exact n8n OAuth callback URLs.');
		return redirect.href;
	});
	if (!redirects.length) throw new Error('Configure at least one REDIRECT_URIS callback.');
	return {
		...config,
		publicUrl: url.origin,
		redirectUris: redirects,
		flowTtlMs: config.flowTtlMs ?? 10 * 60_000,
		codeTtlMs: config.codeTtlMs ?? 60_000,
		maxSessions: config.maxSessions ?? 2,
	};
}

export class LoginBroker {
	constructor(config, browserFactory, now = Date.now) {
		this.config = validateConfig(config);
		this.browserFactory = browserFactory;
		this.now = now;
		this.flows = new Map();
		this.grants = new Map();
	}

	async authorize(query) {
		if (query.get('response_type') !== 'code' || query.get('client_id') !== this.config.clientId)
			throw new LoginError(400, 'invalid_request', 'Invalid authorization request.');
		const redirect = query.get('redirect_uri');
		if (!this.config.redirectUris.includes(redirect))
			throw new LoginError(400, 'invalid_redirect', 'The callback is not registered.');
		const state = query.get('state');
		const challenge = query.get('code_challenge');
		if (
			!state ||
			state.length > 8192 ||
			!/^[A-Za-z0-9_-]{43}$/.test(challenge ?? '') ||
			query.get('code_challenge_method') !== 'S256'
		)
			throw new LoginError(400, 'invalid_request', 'State and S256 PKCE are required.');
		await this.sweep();
		if (this.flows.size >= this.config.maxSessions)
			throw new LoginError(429, 'busy', 'The login service is busy. Retry shortly.');
		const id = randomBytes(16).toString('hex');
		const cookie = random();
		const flow = {
			id,
			cookieHash: digest(cookie),
			redirect,
			state,
			challenge,
			expiresAt: this.now() + this.config.flowTtlMs,
			phase: 'starting',
			browser: null,
		};
		this.flows.set(id, flow);
		flow.startup = this.browserFactory()
			.then(async (browser) => {
				if (this.flows.get(id) !== flow) {
					await browser.close();
					return;
				}
				flow.browser = browser;
				flow.phase = 'login';
			})
			.catch(() => {
				if (this.flows.get(id) === flow) flow.phase = 'failed';
			});
		return { id, cookie };
	}

	getFlow(id, cookie) {
		const flow = this.flows.get(id);
		if (!flow || flow.expiresAt <= this.now() || !matches(digest(cookie ?? ''), flow.cookieHash))
			throw new LoginError(401, 'expired', 'This login window has expired. Reconnect from n8n.');
		return flow;
	}

	async status(id, cookie) {
		const flow = this.getFlow(id, cookie);
		if (flow.phase === 'login' && flow.browser.isReady()) flow.phase = 'ready';
		return { phase: flow.phase, expiresAt: flow.expiresAt };
	}

	async screen(id, cookie) {
		const flow = this.getFlow(id, cookie);
		if (!flow.browser || !['login', 'ready'].includes(flow.phase))
			throw new LoginError(409, 'not_ready', 'The login browser is starting.');
		return flow.browser.screenshot();
	}

	async input(id, cookie, event) {
		const flow = this.getFlow(id, cookie);
		if (!flow.browser || !['login', 'ready'].includes(flow.phase))
			throw new LoginError(409, 'not_ready', 'The login browser is not available.');
		await flow.browser.input(event);
	}

	async complete(id, cookie) {
		const flow = this.getFlow(id, cookie);
		if (flow.phase === 'authorized') return { redirect: flow.callback };
		if (flow.phase === 'redeemed')
			throw new LoginError(409, 'redeemed', 'This login has already been connected.');
		if (!flow.browser || !['login', 'ready'].includes(flow.phase))
			throw new LoginError(409, 'not_ready', 'Wait for the login browser to start.');
		// Serialize completion so concurrent clicks cannot produce multiple grants.
		if (flow.completion) return flow.completion;
		flow.completion = (async () => {
			const session = await flow.browser.session();
			if (this.flows.get(id) !== flow || flow.expiresAt <= this.now())
				throw new LoginError(401, 'expired', 'This login window has expired.');
			const fields = ['cookie', 'csrf', 'userAgent'];
			if (
				!session ||
				fields.some(
					(key) =>
						typeof session[key] !== 'string' || !session[key] || /[\r\n\0]/.test(session[key]),
				)
			)
				throw new LoginError(
					409,
					'login_required',
					'Complete the author login and website verification first.',
				);
			const code = random();
			const codeHash = digest(code);
			const expiresAt = this.now() + this.config.codeTtlMs;
			this.grants.set(codeHash, {
				flowId: id,
				session,
				redirect: flow.redirect,
				challenge: flow.challenge,
				expiresAt,
			});
			const callback = new URL(flow.redirect);
			callback.searchParams.set('code', code);
			callback.searchParams.set('state', flow.state);
			flow.callback = callback.href;
			flow.phase = 'authorized';
			flow.expiresAt = expiresAt;
			await flow.browser.close();
			flow.browser = null;
			return { redirect: flow.callback };
		})();
		try {
			return await flow.completion;
		} finally {
			flow.completion = null;
		}
	}

	token(body) {
		if (
			body.get('client_id') !== this.config.clientId ||
			!matches(body.get('client_secret') ?? '', this.config.clientSecret)
		)
			throw new LoginError(401, 'invalid_client', 'Invalid login-service client credentials.');
		if (body.get('grant_type') !== 'authorization_code')
			throw new LoginError(
				400,
				'unsupported_grant_type',
				'Reconnect from n8n when a website session expires.',
			);
		const key = digest(body.get('code') ?? '');
		const grant = this.grants.get(key);
		const verifier = body.get('code_verifier') ?? '';
		if (
			!grant ||
			grant.expiresAt <= this.now() ||
			body.get('redirect_uri') !== grant.redirect ||
			!/^[A-Za-z0-9._~-]{43,128}$/.test(verifier) ||
			!matches(digest(verifier), grant.challenge)
		)
			throw new LoginError(400, 'invalid_grant', 'The one-time login code is invalid or expired.');
		// Delete before returning so a grant can be redeemed only once.
		this.grants.delete(key);
		const flow = this.flows.get(grant.flowId);
		if (flow) {
			flow.phase = 'redeemed';
			flow.callback = null;
			flow.state = null;
		}
		const response = {
			access_token: random(),
			token_type: 'Bearer',
			fanqie_cookie: grant.session.cookie,
			fanqie_csrf: grant.session.csrf,
			fanqie_user_agent: grant.session.userAgent,
		};
		grant.session = null;
		return response;
	}

	async cancel(id, cookie) {
		const flow = this.getFlow(id, cookie);
		for (const [key, grant] of this.grants) if (grant.flowId === id) this.grants.delete(key);
		this.flows.delete(id);
		if (flow.browser) await flow.browser.close();
		flow.callback = null;
		flow.state = null;
	}

	async sweep() {
		const now = this.now();
		for (const [key, grant] of this.grants) if (grant.expiresAt <= now) this.grants.delete(key);
		for (const [id, flow] of this.flows)
			if (flow.expiresAt <= now) {
				this.flows.delete(id);
				if (flow.browser) await flow.browser.close().catch(() => {});
				flow.callback = null;
				flow.state = null;
			}
	}

	async close() {
		const flows = [...this.flows.values()];
		this.flows.clear();
		this.grants.clear();
		await Promise.allSettled(flows.map((flow) => flow.browser?.close()));
	}
}
