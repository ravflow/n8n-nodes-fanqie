import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile, readdir } from 'node:fs/promises';
import { join, resolve, dirname, basename } from 'node:path';
import { randomBytes } from 'node:crypto';
import { request as httpRequest } from 'node:http';
import { LoginBroker, validateConfig } from '../src/broker.mjs';
import { SessionVault, digest } from '../src/vault.mjs';
import { createLoginServer } from '../src/http.mjs';
import { requestAuthor, validateAuthorRequest } from '../src/author.mjs';
import { allowedBrowserUrl } from '../src/browser.mjs';
import { readOfficialCsrf } from '../src/csrf.mjs';

const session = {
	cookie: 'sessionid=fake-session-value',
	csrf: 'fake-csrf-value',
	userAgent: 'Fixture Browser',
};
const config = {
	publicUrl: 'http://127.0.0.1:8789',
	clientId: 'test-client',
	clientSecret: 's'.repeat(48),
	redirectUris: ['http://127.0.0.1:5678/rest/oauth2-credential/callback'],
	allowInsecureHttp: true,
};
const verifier = 'v'.repeat(43);
const query = (state) =>
	new URLSearchParams({
		response_type: 'code',
		client_id: config.clientId,
		redirect_uri: config.redirectUris[0],
		state,
		code_challenge: digest(verifier),
		code_challenge_method: 'S256',
	});
const body = (code) =>
	new URLSearchParams({
		grant_type: 'authorization_code',
		client_id: config.clientId,
		client_secret: config.clientSecret,
		redirect_uri: config.redirectUris[0],
		code,
		code_verifier: verifier,
	});

test('CSRF capture requires a real unexpired SDK token and rejects downgrade and header injection', async () => {
	for (const token of [
		null,
		{ value: 'DOWNGRADE', expiresAt: Date.now() + 10000 },
		{ value: 'a\r\nb', expiresAt: Date.now() + 10000 },
		{ value: 'expired-token', expiresAt: 1 },
	])
		assert.equal(
			await readOfficialCsrf({ evaluate: async () => token }, '/api/author/account/info/v0/'),
			null,
		);
	const valid = { value: 'sdk-issued-token', expiresAt: Date.now() + 10000 };
	assert.deepEqual(
		await readOfficialCsrf({ evaluate: async () => valid }, '/api/author/account/info/v0/'),
		valid,
	);
});

async function fixture(t, overrides = {}) {
	const root = resolve(process.cwd());
	const directory = await mkdtemp(join(root, '.test-login-'));
	let now = Date.now();
	const key = randomBytes(32).toString('base64');
	const vault = new SessionVault(directory, key, 3600000, () => now);
	await vault.init();
	const browsers = [];
	const factory = async () => {
		const browser = {
			closed: false,
			phase: 'waiting',
			status: async () => browser.phase,
			qr: async () => Buffer.from('fixture-image'),
			refresh: async () => {
				browser.phase = 'waiting';
			},
			session: async () => session,
			close: async () => {
				browser.closed = true;
			},
		};
		browsers.push(browser);
		return browser;
	};
	const broker = new LoginBroker({ ...config, ...overrides }, factory, vault, () => now);
	t.after(async () => {
		await broker.close();
		// Only remove the unique directory created for this test, inside this cwd.
		assert.equal(dirname(resolve(directory)), root);
		assert.ok(basename(directory).startsWith('.test-login-'));
		await rm(directory, { recursive: true, force: true });
	});
	return {
		broker,
		vault,
		directory,
		key,
		browsers,
		advance: (ms) => {
			now += ms;
		},
	};
}

async function connected(f, state = 'state-one') {
	const flow = await f.broker.authorize(query(state));
	await f.broker.flows.get(flow.id).startup;
	f.browsers.at(-1).phase = 'ready';
	const { redirect } = await f.broker.complete(flow.id, flow.cookie);
	return { flow, redirect, code: new URL(redirect).searchParams.get('code') };
}

test('single-use grant binds state, callback, client and PKCE; token response contains no website credentials', async (t) => {
	const f = await fixture(t);
	const { code, redirect } = await connected(f);
	assert.equal(new URL(redirect).searchParams.get('state'), 'state-one');
	const wrong = body(code);
	wrong.set('code_verifier', 'z'.repeat(43));
	await assert.rejects(f.broker.token(wrong), /无效/);
	const token = await f.broker.token(body(code));
	assert.equal(token.token_type, 'Bearer');
	assert.equal(Object.hasOwn(token, 'fanqie_cookie'), false);
	assert.equal(JSON.stringify(token).includes(session.csrf), false);
	assert.deepEqual(await f.vault.get(token.access_token), session);
	await assert.rejects(f.broker.token(body(code)), /无效/);
	assert.equal(f.browsers[0].closed, true);
});

test('wrong client secret or callback cannot redeem a grant', async (t) => {
	const f = await fixture(t);
	const { code } = await connected(f);
	const wrongClient = body(code);
	wrongClient.set('client_secret', 'bad');
	await assert.rejects(f.broker.token(wrongClient), /不匹配/);
	const wrongRedirect = body(code);
	wrongRedirect.set('redirect_uri', 'http://evil.test/callback');
	await assert.rejects(f.broker.token(wrongRedirect), /无效/);
	assert.ok((await f.broker.token(body(code))).access_token);
});

test('flow cookie isolation prevents another page from reading, completing or canceling it', async (t) => {
	const f = await fixture(t);
	const one = await f.broker.authorize(query('one'));
	const two = await f.broker.authorize(query('two'));
	await assert.rejects(f.broker.status(one.id, two.cookie), /失效/);
	await assert.rejects(f.broker.complete(one.id, two.cookie), /失效/);
	await assert.rejects(f.broker.cancel(one.id, two.cookie), /失效/);
	assert.ok(f.broker.getFlow(one.id, one.cookie));
});

test('concurrent completion and redemption issue exactly one connection', async (t) => {
	const f = await fixture(t);
	const flow = await f.broker.authorize(query('one'));
	await f.broker.flows.get(flow.id).startup;
	const [one, two] = await Promise.all([
		f.broker.complete(flow.id, flow.cookie),
		f.broker.complete(flow.id, flow.cookie),
	]);
	assert.equal(one.redirect, two.redirect);
	const code = new URL(one.redirect).searchParams.get('code');
	const results = await Promise.allSettled([
		f.broker.token(body(code)),
		f.broker.token(body(code)),
	]);
	assert.equal(results.filter((result) => result.status === 'fulfilled').length, 1);
	assert.equal((await readdir(f.directory)).filter((name) => name.endsWith('.json')).length, 1);
});

test('expired flows and grants are closed and cannot be redeemed', async (t) => {
	const f = await fixture(t);
	const { code, flow } = await connected(f);
	f.advance(60001);
	await f.broker.sweep();
	await assert.rejects(f.broker.token(body(code)), /无效/);
	assert.throws(() => f.broker.getFlow(flow.id, flow.cookie), /失效/);
});

test('canceling a flow closes its browser and destroys its pending grant', async (t) => {
	const f = await fixture(t);
	const { flow, code } = await connected(f);
	await f.broker.cancel(flow.id, flow.cookie);
	await assert.rejects(f.broker.token(body(code)), /无效/);
	assert.equal(f.browsers[0].closed, true);
});

test('session vault survives restart, encrypts credentials and rejects a changed key', async (t) => {
	const f = await fixture(t);
	const { token } = await f.vault.issue(session);
	const file = (await readdir(f.directory)).find((name) => name.endsWith('.json'));
	const content = await readFile(join(f.directory, file), 'utf8');
	assert.equal(content.includes(session.cookie), false);
	assert.equal(content.includes(session.csrf), false);
	assert.equal(content.includes(token), false);
	const restarted = new SessionVault(f.directory, f.key, 3600000);
	await restarted.init();
	assert.deepEqual(await restarted.get(token), session);
	const wrong = new SessionVault(f.directory, randomBytes(32).toString('base64'), 3600000);
	await assert.rejects(wrong.init());
});

test('revocation and retention expiry invalidate only the targeted connection', async (t) => {
	const f = await fixture(t);
	const one = await f.vault.issue(session);
	const two = await f.vault.issue({ ...session, csrf: 'different-csrf' });
	await f.vault.revoke(one.token);
	await assert.rejects(f.vault.get(one.token), /撤销/);
	assert.equal((await f.vault.get(two.token)).csrf, 'different-csrf');
	f.advance(3600001);
	await assert.rejects(f.vault.get(two.token), /过期/);
});

test('unsafe upstream paths and public HTTP service origins are rejected', () => {
	for (const path of [
		'https://evil.test/api/author/x',
		'//evil.test/api/author/x',
		'/api/author/../x',
		'/api/author/%2e%2e/x',
		'/api/author/x?url=evil',
		'/api/author/a\\b',
	])
		assert.throws(() => validateAuthorRequest({ path, method: 'GET', query: '', timeout: 15000 }));
	for (const publicUrl of [
		'http://example.com',
		'http://127.evil.test',
		'http://10.example.com',
		'http://192.168.evil.test',
	])
		assert.throws(() => validateConfig({ ...config, publicUrl }));
	assert.equal(allowedBrowserUrl('https://fanqienovel.com/main/writer/login'), true);
	assert.equal(allowedBrowserUrl('https://fanqienovel.com.evil.test/'), false);
	assert.equal(allowedBrowserUrl('http://127.0.0.1/'), false);
});

test('proxy fixes upstream host, disables redirects, redacts session values and preserves long IDs', async () => {
	let calls = 0;
	const result = await requestAuthor(
		session,
		{ path: '/api/author/book/book_list/v0/', method: 'GET', query: 'aid=2503', timeout: 15000 },
		async (url, options) => {
			calls++;
			assert.equal(url.origin, 'https://fanqienovel.com');
			assert.equal(options.redirect, 'manual');
			assert.equal(options.headers.Cookie, session.cookie);
			return new Response(
				'{"code":0,"data":{"book_id":9999999999999999999},"message":"fake-csrf-value"}',
				{ headers: { 'Content-Type': 'application/json', 'Set-Cookie': 'secret=value' } },
			);
		},
	);
	assert.equal(calls, 1);
	assert.ok(result.body.includes('9999999999999999999'));
	assert.equal(result.body.includes(session.csrf), false);
	assert.equal(Object.hasOwn(result.headers, 'set-cookie'), false);
});

test('HTTP flow rejects cross-origin completion and unauthenticated proxy access', async (t) => {
	const f = await fixture(t);
	const server = createLoginServer(f.broker);
	await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
	t.after(() => new Promise((resolve) => server.close(resolve)));
	const origin = `http://127.0.0.1:${server.address().port}`;
	f.broker.config.publicUrl = origin;
	const auth = await fetch(`${origin}/oauth/authorize?${query('http-one')}`, {
		redirect: 'manual',
	});
	assert.equal(auth.status, 302);
	assert.ok(auth.headers.get('set-cookie').includes('HttpOnly'));
	const cookie = auth.headers.get('set-cookie').split(';')[0];
	const location = auth.headers.get('location');
	const denied = await fetch(`${origin}${location}/complete`, {
		method: 'POST',
		headers: {
			Cookie: cookie,
			Origin: 'http://evil.test',
			'X-Fanqie-Connect': '1',
			'Content-Type': 'application/json',
		},
		body: '{}',
	});
	assert.equal(denied.status, 403);
	const unauthorized = await fetch(`${origin}/api/author-request`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: '{}',
	});
	assert.equal(unauthorized.status, 401);
	const hostStatus = await new Promise((resolve, reject) => {
		const request = httpRequest(`${origin}/`, { headers: { Host: 'evil.test' } }, (response) => {
			response.resume();
			resolve(response.statusCode);
		});
		request.on('error', reject);
		request.end();
	});
	assert.equal(hostStatus, 400);
});
