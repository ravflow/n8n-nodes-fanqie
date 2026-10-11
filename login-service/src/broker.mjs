import { randomBytes, timingSafeEqual } from 'node:crypto';
import { isIP } from 'node:net';
import { LoginError } from './errors.mjs';
import { digest, randomToken, validateSession } from './vault.mjs';

const matches = (a, b) => timingSafeEqual(Buffer.from(digest(a)), Buffer.from(digest(b)));
const lanHost = (host) =>
	host === 'localhost' ||
	host === '[::1]' ||
	(isIP(host) === 4 &&
		(/^(?:127|10)\./.test(host) ||
			/^192\.168\./.test(host) ||
			/^172\.(?:1[6-9]|2\d|3[01])\./.test(host)));

export function validateConfig(config) {
	const publicUrl = new URL(config.publicUrl);
	const acceptable = (url) =>
		url.protocol === 'https:' ||
		(config.allowInsecureHttp === true && url.protocol === 'http:' && lanHost(url.hostname));
	if (
		!acceptable(publicUrl) ||
		publicUrl.username ||
		publicUrl.password ||
		publicUrl.search ||
		publicUrl.hash ||
		publicUrl.pathname !== '/'
	)
		throw new Error(
			'PUBLIC_URL must be an HTTPS origin; explicitly enabled HTTP is limited to LAN/loopback hosts.',
		);
	if (
		!/^[A-Za-z0-9_-]{1,100}$/.test(config.clientId ?? '') ||
		typeof config.clientSecret !== 'string' ||
		config.clientSecret.length < 32
	)
		throw new Error(
			'Configure CLIENT_ID and an independent random CLIENT_SECRET of at least 32 characters.',
		);
	if (!Array.isArray(config.redirectUris) || !config.redirectUris.length)
		throw new Error('Configure exact n8n REDIRECT_URIS.');
	const redirectUris = config.redirectUris.map((value) => {
		const url = new URL(value);
		if (
			!acceptable(url) ||
			url.username ||
			url.password ||
			url.hash ||
			url.search ||
			!url.pathname.endsWith('/rest/oauth2-credential/callback')
		)
			throw new Error('REDIRECT_URIS must be exact n8n OAuth callback URLs.');
		return url.href;
	});
	const maxSessions = config.maxSessions ?? 2;
	if (!Number.isInteger(maxSessions) || maxSessions < 1 || maxSessions > 8)
		throw new Error('MAX_LOGIN_SESSIONS must be between 1 and 8.');
	return {
		...config,
		publicUrl: publicUrl.origin,
		redirectUris,
		maxSessions,
		flowTtlMs: config.flowTtlMs ?? 600000,
		codeTtlMs: config.codeTtlMs ?? 60000,
	};
}

export class LoginBroker {
	constructor(config, browserFactory, vault, now = Date.now) {
		this.config = validateConfig(config);
		this.browserFactory = browserFactory;
		this.vault = vault;
		this.now = now;
		this.flows = new Map();
		this.grants = new Map();
	}

	async authorize(query) {
		if (query.get('response_type') !== 'code' || query.get('client_id') !== this.config.clientId)
			throw new LoginError(400, 'invalid_request', '请从 n8n 凭据页面发起连接。');
		const redirect = query.get('redirect_uri');
		if (!this.config.redirectUris.includes(redirect))
			throw new LoginError(400, 'invalid_redirect', 'n8n 回调地址未登记，请联系管理员。');
		const state = query.get('state');
		const challenge = query.get('code_challenge');
		if (
			!state ||
			state.length > 8192 ||
			!/^[A-Za-z0-9_-]{43}$/.test(challenge ?? '') ||
			query.get('code_challenge_method') !== 'S256'
		)
			throw new LoginError(400, 'invalid_request', '连接请求必须包含 state 和 S256 PKCE。');
		await this.sweep();
		if (this.flows.size >= this.config.maxSessions)
			throw new LoginError(429, 'busy', '当前扫码人数较多，请稍后重试。');
		const id = randomBytes(16).toString('hex');
		const cookie = randomToken();
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
				if (this.flows.get(id) !== flow || flow.expiresAt <= this.now()) {
					await browser.close();
					return;
				}
				flow.browser = browser;
				flow.phase = 'waiting';
			})
			.catch(() => {
				if (this.flows.get(id) === flow) flow.phase = 'failed';
			});
		return { id, cookie };
	}

	getFlow(id, cookie) {
		const flow = this.flows.get(id);
		if (!flow || flow.expiresAt <= this.now() || !matches(digest(cookie ?? ''), flow.cookieHash))
			throw new LoginError(401, 'expired_flow', '此连接页面已失效，请从 n8n 重新连接。');
		return flow;
	}

	async status(id, cookie) {
		const flow = this.getFlow(id, cookie);
		if (flow.browser && !['authorized', 'redeemed'].includes(flow.phase))
			flow.phase = await flow.browser.status();
		return { phase: flow.phase, expiresAt: flow.expiresAt };
	}

	async qr(id, cookie) {
		const flow = this.getFlow(id, cookie);
		if (!flow.browser || ['authorized', 'redeemed'].includes(flow.phase))
			throw new LoginError(409, 'not_ready', '二维码正在准备，请稍候。');
		return flow.browser.qr();
	}

	async refresh(id, cookie) {
		const flow = this.getFlow(id, cookie);
		if (!flow.browser || flow.phase === 'ready' || ['authorized', 'redeemed'].includes(flow.phase))
			throw new LoginError(409, 'not_ready', '当前无法刷新，请从 n8n 重新连接。');
		await flow.browser.refresh();
		flow.phase = 'waiting';
	}

	async complete(id, cookie) {
		const flow = this.getFlow(id, cookie);
		if (flow.phase === 'authorized') return { redirect: flow.callback };
		if (flow.phase === 'redeemed') throw new LoginError(409, 'redeemed', '此连接已经绑定。');
		if (!flow.browser) throw new LoginError(409, 'not_ready', '请等待官方二维码加载。');
		if (flow.completion) return flow.completion;
		flow.completion = (async () => {
			const session = validateSession(await flow.browser.session());
			if (this.flows.get(id) !== flow || flow.expiresAt <= this.now())
				throw new LoginError(401, 'expired_flow', '连接页面已失效。');
			const code = randomToken();
			const expiresAt = this.now() + this.config.codeTtlMs;
			this.grants.set(digest(code), {
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
			await flow.browser.close().catch(() => {});
			flow.browser = null;
			return { redirect: flow.callback };
		})();
		try {
			return await flow.completion;
		} finally {
			flow.completion = null;
		}
	}

	async token(body) {
		if (
			body.get('client_id') !== this.config.clientId ||
			!matches(body.get('client_secret') ?? '', this.config.clientSecret)
		)
			throw new LoginError(401, 'invalid_client', '登录组件 Client ID 或 Client Secret 不匹配。');
		if (body.get('grant_type') !== 'authorization_code')
			throw new LoginError(400, 'unsupported_grant_type', '网站登录态过期后，请重新扫码连接。');
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
			throw new LoginError(400, 'invalid_grant', '一次性连接码无效或已过期，请重新连接。');
		// Consume before awaiting disk IO, preventing concurrent redemption.
		this.grants.delete(key);
		const { token, expiresAt } = await this.vault.issue(grant.session);
		grant.session = null;
		const flow = this.flows.get(grant.flowId);
		if (flow) {
			flow.phase = 'redeemed';
			flow.callback = null;
			flow.state = null;
		}
		return {
			access_token: token,
			token_type: 'Bearer',
			expires_in: Math.floor((expiresAt - this.now()) / 1000),
		};
	}

	async cancel(id, cookie) {
		const flow = this.getFlow(id, cookie);
		for (const [key, grant] of this.grants) if (grant.flowId === id) this.grants.delete(key);
		this.flows.delete(id);
		await flow.browser?.close().catch(() => {});
		flow.callback = null;
		flow.state = null;
	}

	async sweep() {
		const now = this.now();
		for (const [key, grant] of this.grants) if (grant.expiresAt <= now) this.grants.delete(key);
		for (const [id, flow] of this.flows)
			if (flow.expiresAt <= now) {
				this.flows.delete(id);
				await flow.browser?.close().catch(() => {});
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
