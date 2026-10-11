import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { LoginBroker } from '../src/broker.mjs';
import { createLoginServer } from '../src/http.mjs';
import { allowedBrowserUrl, validateInput } from '../src/browser.mjs';

const verifier = 'a'.repeat(64);
const challenge = createHash('sha256').update(verifier).digest('base64url');
const redirect = 'http://127.0.0.1:5678/rest/oauth2-credential/callback';
const config = {
	publicUrl: 'http://127.0.0.1:8789',
	clientId: 'n8n',
	clientSecret: 's'.repeat(64),
	redirectUris: [redirect],
	allowInsecureHttp: true,
};
const authorizeQuery = () =>
	new URLSearchParams({
		response_type: 'code',
		client_id: 'n8n',
		redirect_uri: redirect,
		state: 'n8n-state',
		code_challenge: challenge,
		code_challenge_method: 'S256',
	});
const tokenBody = (code) =>
	new URLSearchParams({
		grant_type: 'authorization_code',
		client_id: 'n8n',
		client_secret: config.clientSecret,
		code,
		redirect_uri: redirect,
		code_verifier: verifier,
	});

function fixture(options = {}) {
	const browsers = [];
	const broker = new LoginBroker(
		{ ...config, ...options },
		async () => {
			const browser = {
				closed: false,
				isReady: () => true,
				screenshot: async () => Buffer.from('jpeg-fixture'),
				input: async (event) => validateInput(event),
				session: async () => ({
					cookie: `sessionid=test-session-${browsers.length}`,
					csrf: 'csrf-fixture',
					userAgent: 'Test-Agent',
				}),
				close: async () => {
					browser.closed = true;
				},
			};
			browsers.push(browser);
			return browser;
		},
		options.now ?? Date.now,
	);
	return { broker, browsers };
}

async function flow(broker) {
	const value = await broker.authorize(authorizeQuery());
	await broker.getFlow(value.id, value.cookie).startup;
	return value;
}

test('only registered callback, client, state and S256 PKCE may create a browser', async () => {
	const { broker, browsers } = fixture();
	for (const [name, value] of [
		['redirect_uri', 'https://attacker.example/callback'],
		['client_id', 'another-client'],
		['state', ''],
		['code_challenge_method', 'plain'],
		['code_challenge', 'short'],
	]) {
		const query = authorizeQuery();
		query.set(name, value);
		await assert.rejects(broker.authorize(query));
	}
	assert.equal(browsers.length, 0);
});

test('browser login requires a separate HttpOnly-cookie capability per flow', async () => {
	const { broker } = fixture();
	const first = await flow(broker);
	const second = await flow(broker);
	assert.throws(() => broker.getFlow(first.id, undefined), /expired/);
	assert.throws(() => broker.getFlow(first.id, second.cookie), /expired/);
	assert.equal((await broker.status(first.id, first.cookie)).phase, 'ready');
	await broker.close();
});

test('login code is one use, PKCE-bound, client-bound and callback-bound', async () => {
	const { broker, browsers } = fixture();
	const value = await flow(broker);
	const completed = await broker.complete(value.id, value.cookie);
	const callback = new URL(completed.redirect);
	assert.equal(callback.searchParams.get('state'), 'n8n-state');
	assert.equal(callback.searchParams.has('cookie'), false);
	assert.equal(browsers[0].closed, true);
	const code = callback.searchParams.get('code');
	for (const [key, invalid] of [
		['client_secret', 'wrong'],
		['code_verifier', 'b'.repeat(64)],
		['redirect_uri', redirect + '/wrong'],
	]) {
		const body = tokenBody(code);
		body.set(key, invalid);
		assert.throws(() => broker.token(body));
	}
	const token = broker.token(tokenBody(code));
	assert.match(token.fanqie_cookie, /^sessionid=test-session-/);
	assert.equal(token.fanqie_csrf, 'csrf-fixture');
	assert.equal(token.fanqie_user_agent, 'Test-Agent');
	assert.equal(token.refresh_token, undefined);
	assert.throws(() => broker.token(tokenBody(code)), /invalid or expired/);
	assert.equal(broker.grants.size, 0);
	await broker.close();
});

test('concurrent completion does not mint more than one authorization code', async () => {
	const { broker } = fixture();
	const value = await flow(broker);
	const results = await Promise.all([
		broker.complete(value.id, value.cookie),
		broker.complete(value.id, value.cookie),
	]);
	assert.equal(results[0].redirect, results[1].redirect);
	assert.equal(broker.grants.size, 1);
	await broker.close();
});

test('expired flows close the isolated browser and discard any captured state', async () => {
	let now = 1000;
	const { broker, browsers } = fixture({ now: () => now, flowTtlMs: 500, codeTtlMs: 100 });
	const value = await flow(broker);
	now += 501;
	assert.throws(() => broker.getFlow(value.id, value.cookie), /expired/);
	await broker.sweep();
	assert.equal(broker.flows.size, 0);
	assert.equal(browsers[0].closed, true);
});

test('expired authorization codes cannot be redeemed', async () => {
	let now = 1000;
	const { broker } = fixture({ now: () => now, codeTtlMs: 100 });
	const value = await flow(broker);
	const completed = await broker.complete(value.id, value.cookie);
	now += 101;
	assert.throws(
		() => broker.token(tokenBody(new URL(completed.redirect).searchParams.get('code'))),
		/expired/,
	);
	await broker.sweep();
	assert.equal(broker.grants.size, 0);
});

test('cancelling a completed flow revokes its unredeemed code', async () => {
	const { broker } = fixture();
	const value = await flow(broker);
	const completed = await broker.complete(value.id, value.cookie);
	const code = new URL(completed.redirect).searchParams.get('code');
	await broker.cancel(value.id, value.cookie);
	assert.throws(() => broker.token(tokenBody(code)), /invalid or expired/);
});

test('browser capacity is bounded and cancellation releases capacity', async () => {
	const { broker } = fixture({ maxSessions: 1 });
	const value = await flow(broker);
	await assert.rejects(broker.authorize(authorizeQuery()), /busy/);
	await broker.cancel(value.id, value.cookie);
	const next = await flow(broker);
	assert.notEqual(next.id, value.id);
	await broker.close();
});

test('browser session headers must be complete and cannot contain line breaks', async () => {
	const { broker, browsers } = fixture();
	const value = await flow(broker);
	browsers[0].session = async () => ({
		cookie: 'sessionid=abc\r\nInjected: x',
		csrf: 'csrf',
		userAgent: 'agent',
	});
	await assert.rejects(broker.complete(value.id, value.cookie), /Complete/);
	assert.equal(broker.grants.size, 0);
	await broker.close();
});

test('HTTP login controls enforce same-origin POST, cookie binding and no secret URLs', async (t) => {
	const { broker } = fixture();
	const server = createLoginServer(broker);
	await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
	const base = `http://127.0.0.1:${server.address().port}`;
	broker.config.publicUrl = base;
	t.after(async () => {
		await broker.close();
		await new Promise((resolve) => server.close(resolve));
	});
	const response = await fetch(`${base}/oauth/authorize?${authorizeQuery()}`, {
		redirect: 'manual',
	});
	assert.equal(response.status, 302);
	const path = response.headers.get('location');
	assert.match(path, /^\/connect\/[a-f0-9]{32}$/);
	assert.match(response.headers.get('set-cookie'), /HttpOnly; SameSite=Lax/);
	const cookie = response.headers.get('set-cookie').split(';')[0];
	const id = path.split('/').pop();
	await broker.flows.get(id).startup;
	assert.equal((await fetch(`${base}${path}/status`)).status, 401);
	const denied = await fetch(`${base}${path}/input`, {
		method: 'POST',
		headers: {
			Cookie: cookie,
			Origin: 'https://attacker.example',
			'Content-Type': 'application/json',
			'X-Fanqie-Connect': '1',
		},
		body: '{"type":"text","value":"secret-input"}',
	});
	assert.equal(denied.status, 403);
	const statusResponse = await fetch(`${base}${path}/status`, { headers: { Cookie: cookie } });
	const publicStatus = await statusResponse.text();
	assert.equal(statusResponse.headers.get('cache-control'), 'no-store');
	assert.equal(publicStatus.includes('csrf-fixture'), false);
	assert.equal(publicStatus.includes('test-session'), false);
	const completed = await fetch(`${base}${path}/complete`, {
		method: 'POST',
		headers: {
			Cookie: cookie,
			Origin: base,
			'Content-Type': 'application/json',
			'X-Fanqie-Connect': '1',
		},
		body: '{}',
	});
	assert.equal(completed.status, 200);
	const code = new URL((await completed.json()).redirect).searchParams.get('code');
	const tokenResponse = await fetch(`${base}/oauth/token`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
		body: tokenBody(code),
	});
	assert.equal(tokenResponse.status, 200);
	assert.equal((await tokenResponse.json()).fanqie_csrf, 'csrf-fixture');
});

test('HTTPS is required unless the operator explicitly enables LAN HTTP', () => {
	assert.throws(() => fixture({ allowInsecureHttp: false }), /HTTPS/);
	assert.throws(() => fixture({ redirectUris: ['http://127.0.0.1:5678/arbitrary'] }), /exact n8n/);
	assert.throws(() => fixture({ publicUrl: 'http://user:password@127.0.0.1' }), /HTTPS/);
});

test('remote browser cannot navigate to arbitrary websites, local files or private services', () => {
	assert.equal(allowedBrowserUrl('https://fanqienovel.com/main/writer/'), true);
	assert.equal(allowedBrowserUrl('https://passport.bytedance.com/'), true);
	for (const value of [
		'http://fanqienovel.com/',
		'https://fanqienovel.com.attacker.example/',
		'https://notfanqienovel.com/',
		'http://127.0.0.1/',
		'file:///etc/passwd',
		'https://192.168.0.100/',
		'https://user:pass@fanqienovel.com/',
	])
		assert.equal(allowedBrowserUrl(value), false);
});

test('only bounded pointer, text and keyboard events reach the login browser', () => {
	assert.doesNotThrow(() => validateInput({ type: 'down', x: 100, y: 200 }));
	assert.doesNotThrow(() => validateInput({ type: 'text', value: '中文验证码' }));
	for (const value of [
		{ type: 'navigate', url: 'http://localhost' },
		{ type: 'down', x: -1, y: 0 },
		{ type: 'text', value: 'a'.repeat(2001) },
		{ type: 'key', key: 'Control+L' },
		{ type: 'wheel', x: 0, y: 9000 },
	])
		assert.throws(() => validateInput(value));
});
