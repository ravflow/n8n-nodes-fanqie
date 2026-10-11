const test = require('node:test');
const assert = require('node:assert/strict');
const { FanqieAuthor } = require('../dist/nodes/FanqieAuthor/FanqieAuthor.node.js');
const {
	FanqieAuthorQrLoginOAuth2Api,
} = require('../dist/credentials/FanqieAuthorQrLoginOAuth2Api.credentials.js');
const { authorRequest } = require('../dist/nodes/FanqieAuthor/helpers.js');
const { qrConnection, loginServiceOrigin } = require('../dist/nodes/FanqieAuthor/qrConnection.js');
const { displayParameter, NodeHelpers } = require('n8n-workflow');

const token = 'q'.repeat(43);
const credentials = {
	loginServiceUrl: 'http://192.168.0.100:8789',
	clientSecret: 'private-client-secret',
	oauthTokenData: { access_token: token },
};
const settings = { timeout: 30000, readRetries: 0 };

test('resolved defaults preserve old manual nodes and make new nodes use QR login', () => {
	const properties = new FanqieAuthor().description.properties;
	for (const [typeVersion, expected] of [
		[1, 'session'],
		[1.1, 'qrLogin'],
	]) {
		const params = NodeHelpers.getNodeParameters(
			properties,
			{ resource: 'account', operation: 'get' },
			true,
			false,
			{ typeVersion },
		);
		assert.equal(params.authentication, expected);
	}
});
function context(
	version = 1.1,
	authentication = 'qrLogin',
	response = { code: 0, data: { book_id: '9999999999999999999' } },
) {
	const calls = [];
	return {
		calls,
		getNode: () => ({ typeVersion: version, name: 'QR test', parameters: {} }),
		getInputData: () => [{ json: {} }],
		getNodeParameter: (name, index, fallback) => authentication ?? fallback,
		getCredentials: async (name) =>
			name === 'fanqieAuthorApi'
				? { cookieToken: 'legacy-cookie', csrfToken: 'legacy-csrf' }
				: credentials,
		helpers: {
			httpRequestWithAuthentication: async function (name, options) {
				calls.push({ name, options });
				if (name === 'fanqieAuthorApi')
					return { statusCode: 200, headers: {}, body: JSON.stringify(response) };
				return {
					statusCode: 200,
					body: { statusCode: 200, headers: {}, body: JSON.stringify(response) },
				};
			},
		},
	};
}

test('QR requests pass only author request data to the component, preserving IDs', async () => {
	const ctx = context();
	const result = await authorRequest(
		ctx,
		{ path: '/api/author/book/book_list/v0/', method: 'GET' },
		{ page_index: 0 },
		settings,
	);
	assert.equal(result.data.book_id, '9999999999999999999');
	assert.equal(ctx.calls[0].name, 'fanqieAuthorQrLoginOAuth2Api');
	assert.equal(ctx.calls[0].options.url, 'http://192.168.0.100:8789/api/author-request');
	assert.equal(new URLSearchParams(ctx.calls[0].options.body.query).get('page_index'), '0');
	assert.equal(ctx.calls[0].options.disableFollowRedirect, true);
	assert.equal(JSON.stringify(ctx.calls[0].options).includes(token), false);
	assert.equal(JSON.stringify(ctx.calls[0].options).includes(credentials.clientSecret), false);
});

test('QR writes retain form encoding and explicit method, and are not retried', async () => {
	const ctx = context();
	ctx.helpers.httpRequestWithAuthentication = async (name, options) => {
		ctx.calls.push(options);
		throw Object.assign(new Error(`secret ${token}`), { statusCode: 502 });
	};
	await assert.rejects(
		authorRequest(
			ctx,
			{ path: '/api/author/publish_article/v0/', method: 'POST' },
			{ title: '中文 & 标题', item_id: '9' },
			{ ...settings, readRetries: 3 },
		),
		(error) => !error.message.includes(token) && /result is unknown/.test(error.message),
	);
	assert.equal(ctx.calls.length, 1);
	assert.equal(ctx.calls[0].body.method, 'POST');
	assert.equal(new URLSearchParams(ctx.calls[0].body.body).get('title'), '中文 & 标题');
});

test('version 1 without an auth selection retains original manual credentials', async () => {
	const ctx = context(1, null);
	await authorRequest(ctx, { path: '/api/author/account/info/v0/', method: 'GET' }, {}, settings);
	assert.equal(ctx.calls[0].name, 'fanqieAuthorApi');
	assert.equal(ctx.calls[0].options.url, 'https://fanqienovel.com/api/author/account/info/v0/');
});

test('version 1.1 still allows manual credentials', async () => {
	const ctx = context(1.1, 'session');
	await authorRequest(ctx, { path: '/api/author/account/info/v0/', method: 'GET' }, {}, settings);
	assert.equal(ctx.calls[0].name, 'fanqieAuthorApi');
});

test('service origins reject lookalike LAN domains, URL credentials, paths, queries and fragments', () => {
	for (const value of [
		'http://192.168.evil.test',
		'http://127.evil.test',
		'http://10.example.com',
		'http://example.com',
		'https://user:secret@example.com',
		'https://example.com/proxy',
		'https://example.com/?x=y',
		'https://example.com/#x',
	])
		assert.throws(() => loginServiceOrigin(value));
	assert.equal(loginServiceOrigin('http://127.0.0.1:8789/'), 'http://127.0.0.1:8789');
	assert.equal(loginServiceOrigin('https://login.example.com'), 'https://login.example.com');
	assert.throws(() => qrConnection({ ...credentials, oauthTokenData: { access_token: 'x\r\ny' } }));
});

test('QR credential uses PKCE and both versions expose only the matching credential', () => {
	const credential = new FanqieAuthorQrLoginOAuth2Api();
	assert.deepEqual(credential.extends, ['oAuth2Api']);
	assert.equal(credential.properties.find((item) => item.name === 'usePkce').default, true);
	const definition = new FanqieAuthor().description;
	const visible = (version, authentication) =>
		definition.credentials
			.filter((item) =>
				displayParameter({ resource: 'account', operation: 'get', authentication }, item, {
					typeVersion: version,
				}),
			)
			.map((item) => item.name);
	assert.deepEqual(visible(1, 'session'), ['fanqieAuthorApi']);
	assert.deepEqual(visible(1, 'qrLogin'), ['fanqieAuthorQrLoginOAuth2Api']);
	assert.deepEqual(visible(1.1, 'session'), ['fanqieAuthorApi']);
	assert.deepEqual(visible(1.1, 'qrLogin'), ['fanqieAuthorQrLoginOAuth2Api']);
});

test('credential test requires actual connected status and never echoes tokens', async () => {
	const method = new FanqieAuthor().methods.credentialTest.testQrConnection;
	const good = await method.call(
		{
			helpers: {
				request: async (options) => {
					assert.equal(options.headers.Authorization, `Bearer ${token}`);
					return { statusCode: 200, body: { connected: true } };
				},
			},
		},
		{ data: credentials },
	);
	assert.equal(good.status, 'OK');
	const bad = await method.call(
		{
			helpers: {
				request: async () => {
					throw new Error(token);
				},
			},
		},
		{ data: credentials },
	);
	assert.equal(bad.status, 'Error');
	assert.equal(bad.message.includes(token), false);
});
