const test = require('node:test');
const assert = require('node:assert/strict');
const { FanqieAuthor } = require('../dist/nodes/FanqieAuthor/FanqieAuthor.node.js');
const { FanqieAuthorApi } = require('../dist/credentials/FanqieAuthorApi.credentials.js');
const { endpoints } = require('../dist/nodes/FanqieAuthor/catalog.js');
const { operations } = require('../dist/nodes/FanqieAuthor/operations.js');
const {
	parseLosslessJson,
	parseObject,
	assertAuthorPath,
	formEncode,
	toChapterHtml,
	toUnixSeconds,
	buildPublishPayload,
	decodeResponse,
	authorRequest,
	fetchList,
} = require('../dist/nodes/FanqieAuthor/helpers.js');

const node = {
	id: 'test-node',
	name: 'Fanqie Author',
	type: 'n8n-nodes-fanqie.fanqieAuthor',
	typeVersion: 1,
	position: [0, 0],
	parameters: {},
};
const settings = { timeout: 30000, readRetries: 0 };
const ok = (data) => ({ statusCode: 200, headers: {}, body: JSON.stringify({ code: 0, data }) });

function context(parameters = {}, responses = [], continueOnFail = false) {
	const calls = [];
	let offset = 0;
	return {
		calls,
		getInputData: () => [{ json: {} }],
		getNodeParameter: (name, index, fallback) =>
			Object.hasOwn(parameters, name) ? parameters[name] : fallback,
		getCurrentNodeParameter: (name) => parameters[name],
		getNode: () => node,
		getCredentials: async () => ({ cookieToken: 'session-secret', csrfToken: 'csrf-secret' }),
		continueOnFail: () => continueOnFail,
		helpers: {
			httpRequestWithAuthentication: async function (credentialName, options) {
				assert.equal(credentialName, 'fanqieAuthorApi');
				calls.push(options);
				const response = responses[offset++];
				if (response instanceof Error) throw response;
				if (!response) throw new Error('Unexpected mock request');
				return response;
			},
		},
	};
}

test('API JSON preserves long numeric IDs and strings containing digits', () => {
	const result = parseLosslessJson(
		'{"book_id":7143038691944959011,"label":"1e12 and 99999999999999999","count":100,"amount":1.25,"negative":-9999999999999999999}',
	);
	assert.equal(result.book_id, '7143038691944959011');
	assert.equal(result.negative, '-9999999999999999999');
	assert.equal(result.label, '1e12 and 99999999999999999');
	assert.equal(result.count, 100);
	assert.equal(result.amount, 1.25);
});

test('unsafe IDs in object expressions and prototype keys fail validation', () => {
	assert.throws(() => parseObject({ book_id: 7143038691944959011 }, 'Parameters'), /precision/);
	assert.throws(
		() => parseObject('{"__proto__":{"polluted":true}}', 'Parameters'),
		/Unsupported parameter/,
	);
	assert.throws(() => parseObject('[]', 'Parameters'), /JSON object/);
	assert.throws(() => parseObject('invalid', 'Parameters'), /JSON object/);
	assert.equal({}.polluted, undefined);
});

test('request paths cannot redirect credentials to another host or traverse', () => {
	assert.doesNotThrow(() => assertAuthorPath('/api/author/book/book_list/v0'));
	for (const invalid of [
		'https://example.com/api/author/',
		'//example.com/api/author/',
		'/api/author/../reader',
		'/api/author/%2e%2e/reader',
		'/api/author/a?url=x',
		'/api/author/\\example.com',
		'/api/author/a\n',
	])
		assert.throws(() => assertAuthorPath(invalid));
});

test('form encoding handles Unicode, arrays, objects, zero, and empty values', () => {
	const decoded = new URLSearchParams(
		formEncode({
			title: '第 1 章 & <开端>',
			codes: [1, 2],
			extra: { enabled: false },
			empty: null,
			skipped: undefined,
		}),
	);
	assert.equal(decoded.get('title'), '第 1 章 & <开端>');
	assert.equal(decoded.get('codes[0]'), '1');
	assert.equal(decoded.get('extra[enabled]'), 'false');
	assert.equal(decoded.get('empty'), '');
	assert.equal(decoded.has('skipped'), false);
});

test('plain text chapter conversion escapes markup without losing paragraphs', () => {
	assert.equal(
		toChapterHtml('体温 > 38 & (><)\r\n下一段', 'text'),
		'<p>体温 &gt; 38 &amp; (&gt;&lt;)</p><p>下一段</p>',
	);
	assert.equal(toChapterHtml('<p>原稿</p>', 'html'), '<p>原稿</p>');
	assert.throws(() => toChapterHtml(' \n', 'text'), /empty/);
});

test('scheduled timestamps require timezone and convert seconds or milliseconds', () => {
	const seconds = Math.floor(Date.parse('2030-01-01T08:00:00+08:00') / 1000);
	assert.equal(toUnixSeconds('2030-01-01T08:00:00+08:00'), seconds);
	assert.equal(toUnixSeconds(seconds * 1000), seconds);
	assert.equal(toUnixSeconds(String(seconds)), seconds);
	assert.throws(() => toUnixSeconds('2030-01-01 08:00:00'), /timezone/);
});

test('draft and publish payloads cannot override their operation state', () => {
	const input = {
		book_id: '1',
		item_id: '2',
		title: ' 标题 <例> ',
		content: '正文',
		publish_status: 1,
		timer_status: 1,
		timer_time: '2030-01-01T08:00:00+08:00',
	};
	const draft = buildPublishPayload(input, 'saveDraft', 'text');
	assert.equal(draft.publish_status, 0);
	assert.equal(draft.timer_status, 0);
	const publish = buildPublishPayload(input, 'publish', 'text', 1);
	assert.equal(publish.publish_status, 1);
	assert.equal(publish.timer_status, 0);
	assert.equal(publish.title, '标题 ＜例＞');
	assert.equal(publish.use_ai, 1);
	const scheduled = buildPublishPayload(input, 'schedule', 'text', 2);
	assert.equal(scheduled.timer_status, 1);
	assert.equal(scheduled.use_ai, 2);
	assert.throws(() => buildPublishPayload(input, 'publish', 'text'), /AI/);
	assert.throws(
		() => buildPublishPayload({ ...input, timer_time: 1 }, 'schedule', 'text', 1),
		/future/,
	);
});

test('empty, challenged, encrypted and failed responses are never reported as success', () => {
	assert.throws(() => decodeResponse('', {}), /empty response/);
	assert.throws(
		() => decodeResponse('', { 'Bdturing-Verify': 'challenge' }),
		/browser verification/,
	);
	assert.throws(
		() => decodeResponse('{"code":0,"data":"ciphertext"}', { 'X-Muye-Encrypt-Downgrade': '0' }),
		/encrypted/,
	);
	assert.throws(() => decodeResponse('<html>Login</html>', {}), /response format/);
	assert.throws(() => decodeResponse('{"data":[]}', {}), /status code/);
	assert.throws(
		() =>
			decodeResponse('{"code":-1,"message":"expired session-secret csrf-secret"}', {}, [
				'session-secret',
				'csrf-secret',
			]),
		(error) => !error.message.includes('session-secret') && !error.message.includes('csrf-secret'),
	);
});

test('POST uses fixed origin, authenticated helper, form payload and no redirects', async () => {
	const ctx = context({}, [ok({ item_id: '2' })]);
	await authorRequest(
		ctx,
		{ path: '/api/author/article/new_article/v0/', method: 'POST' },
		{ book_id: '1' },
		settings,
	);
	const request = ctx.calls[0];
	assert.equal(request.url, 'https://fanqienovel.com/api/author/article/new_article/v0/');
	assert.equal(request.disableFollowRedirect, true);
	assert.equal(request.json, false);
	assert.equal(new URLSearchParams(request.body).get('app_name'), 'muye_novel');
	assert.equal(new URLSearchParams(request.body).get('book_id'), '1');
});

test('uncertain writes are never retried and credentials do not appear in errors', async () => {
	const failure = Object.assign(new Error('request failed cookie=session-secret csrf-secret'), {
		code: 'ETIMEDOUT',
	});
	const ctx = context({}, [failure, ok({})]);
	await assert.rejects(
		authorRequest(
			ctx,
			{ path: '/api/author/publish_article/v0/', method: 'POST' },
			{},
			{ ...settings, readRetries: 3 },
		),
		(error) =>
			!error.message.includes('session-secret') && /result is unknown/i.test(error.message),
	);
	assert.equal(ctx.calls.length, 1);
});

test('read requests retry only transient errors', async () => {
	const failure = Object.assign(new Error('unavailable'), { statusCode: 503 });
	const ctx = context({}, [failure, ok({ book_id: '1' })]);
	const result = await authorRequest(
		ctx,
		{ path: '/api/author/book/book_detail/v0/', method: 'GET' },
		{},
		{ ...settings, readRetries: 1 },
	);
	assert.equal(result.code, 0);
	assert.equal(ctx.calls.length, 2);
});

test('GET endpoints with write semantics are not retried', async () => {
	const failure = Object.assign(new Error('unavailable'), { statusCode: 503 });
	const ctx = context({}, [failure, ok({})]);
	await assert.rejects(
		authorRequest(
			ctx,
			{ path: '/api/author/short_article/delete/v0/', method: 'GET' },
			{},
			{ ...settings, readRetries: 2 },
		),
	);
	assert.equal(ctx.calls.length, 1);
});

test('native n8n HTTP error codes are recognized for read retries', async () => {
	const failure = Object.assign(new Error('unavailable'), { httpCode: '503' });
	const ctx = context({}, [failure, ok({ book_id: '1' })]);
	await authorRequest(
		ctx,
		{ path: '/api/author/book/book_detail/v0/', method: 'GET' },
		{},
		{ ...settings, readRetries: 1 },
	);
	assert.equal(ctx.calls.length, 2);
});

test('business errors and login redirects do not trigger read retries', async () => {
	const ctx = context({}, [
		{ statusCode: 200, headers: {}, body: '{"code":-1,"message":"Login expired"}' },
		ok({}),
	]);
	await assert.rejects(
		authorRequest(
			ctx,
			{ path: '/api/author/account/info/v0/', method: 'GET' },
			{},
			{ ...settings, readRetries: 2 },
		),
	);
	assert.equal(ctx.calls.length, 1);
	const redirected = context({}, [{ statusCode: 302, headers: { Location: '/login' }, body: '' }]);
	await assert.rejects(
		authorRequest(
			redirected,
			{ path: '/api/author/account/info/v0/', method: 'GET' },
			{},
			settings,
		),
	);
});

test('list pagination advances from page zero and respects limits', async () => {
	const list = Array.from({ length: 100 }, (_, index) => ({ book_id: String(index) }));
	const ctx = context({}, [
		ok({ book_list: list, has_more: true }),
		ok({ book_list: [{ book_id: '100' }], has_more: false }),
	]);
	const operation = operations.find((item) => item.resource === 'book' && item.value === 'getMany');
	const result = await fetchList(ctx, operation, {}, settings, 0, false, 101, 10);
	assert.equal(result.length, 101);
	assert.equal(ctx.calls[0].qs.page_index, 0);
	assert.equal(ctx.calls[1].qs.page_index, 1);
	assert.equal(ctx.calls[1].qs.page_count, 1);
});

test('pagination detects repeated pages and unknown schemas', async () => {
	const page = ok({ book_list: [{ book_id: '1' }], has_more: true });
	const operation = operations.find((item) => item.resource === 'book' && item.value === 'getMany');
	await assert.rejects(
		fetchList(context({}, [page, page]), operation, {}, settings, 0, true, 50, 10),
		/repeated a page/,
	);
	await assert.rejects(
		fetchList(context({}, [ok({ other_list: [] })]), operation, {}, settings, 0, true, 50, 10),
		/schema/,
	);
	await assert.rejects(
		fetchList(context({}, [page]), operation, {}, settings, 0, true, 50, 1),
		/exceeded/,
	);
});

test('offline catalog contains method, field and provenance metadata without making requests', async () => {
	const ctx = context({ resource: 'advanced', operation: 'getCatalog', apiGroup: 'income' });
	const [result] = await FanqieAuthor.prototype.execute.call(ctx);
	assert.equal(ctx.calls.length, 0);
	assert.ok(result.length > 5);
	assert.ok(
		result.every((item) => item.json.group === 'income' && item.json.liveVerified === false),
	);
	assert.equal(new Set(endpoints.map((item) => item.id)).size, endpoints.length);
	for (const item of endpoints) assert.doesNotThrow(() => assertAuthorPath(item.path));
});

test('each curated operation maps to a discovered method and endpoint', () => {
	for (const operation of operations)
		assert.ok(
			endpoints.some(
				(item) =>
					item.method === operation.method &&
					item.path.replace(/\/$/, '') === operation.path.replace(/\/$/, ''),
			),
			`${operation.resource}.${operation.value} has no matching endpoint evidence`,
		);
});

test('dynamic endpoint options filter by group without credentials', async () => {
	const ctx = context({ apiGroup: 'book' });
	const result = await new FanqieAuthor().methods.loadOptions.getEndpoints.call(ctx);
	assert.ok(result.length > 5);
	assert.ok(result.every((item) => item.value.includes('/book/')));
});

test('create draft runs create then save and preserves the returned long ID', async () => {
	const params = {
		resource: 'draft',
		operation: 'create',
		bookId: '1',
		volumeId: '3',
		volumeName: '正文',
		title: '第 1 章 开始',
		content: '测试正文',
		contentFormat: 'text',
		parameters: '{}',
	};
	const ctx = context(params, [
		{ statusCode: 200, headers: {}, body: '{"code":0,"data":{"item_id":9999999999999999999}}' },
		ok({}),
	]);
	const [result] = await FanqieAuthor.prototype.execute.call(ctx);
	assert.equal(ctx.calls.length, 2);
	assert.equal(new URLSearchParams(ctx.calls[1].body).get('item_id'), '9999999999999999999');
	assert.equal(new URLSearchParams(ctx.calls[1].body).get('publish_status'), '0');
	assert.equal(result[0].json.item_id, '9999999999999999999');
	assert.equal(result[0].json.publicationVerified, false);
});

test('failure after creating a draft returns its ID for recovery without creating again', async () => {
	const params = {
		resource: 'draft',
		operation: 'create',
		bookId: '1',
		volumeId: '3',
		volumeName: '正文',
		title: '第 1 章',
		content: '正文',
	};
	const ctx = context(
		params,
		[ok({ item_id: '2' }), Object.assign(new Error('timeout'), { code: 'ETIMEDOUT' })],
		true,
	);
	const [result] = await FanqieAuthor.prototype.execute.call(ctx);
	assert.equal(ctx.calls.length, 2);
	assert.equal(result[0].json.item_id, '2');
	assert.equal(result[0].json.recovery, 'saveExistingDraft');
});

test('publishing reports submission instead of asserting audit or publication success', async () => {
	const ctx = context(
		{
			resource: 'chapter',
			operation: 'publish',
			bookId: '1',
			itemId: '2',
			volumeId: '3',
			volumeName: '正文',
			title: '第 1 章',
			content: '正文',
			aiUsage: 1,
		},
		[ok({ tips: 'Submitted' })],
	);
	const [result] = await FanqieAuthor.prototype.execute.call(ctx);
	assert.equal(result[0].json.submitted, true);
	assert.equal(result[0].json.publicationVerified, false);
	assert.equal(new URLSearchParams(ctx.calls[0].body).get('use_ai'), '1');
});

test('node list output is split into items with input pairing', async () => {
	const ctx = context({ resource: 'book', operation: 'getMany', returnAll: false, limit: 50 }, [
		ok({ book_list: [{ book_id: '1' }, { book_id: '2' }], has_more: false }),
	]);
	const [result] = await FanqieAuthor.prototype.execute.call(ctx);
	assert.equal(result.length, 2);
	assert.deepEqual(result[1].pairedItem, { item: 0 });
});

test('invalid required parameters fail before an HTTP call', async () => {
	const ctx = context({
		resource: 'chapter',
		operation: 'publish',
		bookId: '',
		itemId: '2',
		volumeId: '3',
		volumeName: '正文',
		title: '第 1 章',
		content: '正文',
		aiUsage: 1,
	});
	await assert.rejects(FanqieAuthor.prototype.execute.call(ctx), /book_id/);
	assert.equal(ctx.calls.length, 0);
});

test('credential secrets are masked and authentication targets the official host', () => {
	const credential = new FanqieAuthorApi();
	assert.equal(
		credential.properties.find((item) => item.name === 'cookieToken').typeOptions.password,
		true,
	);
	assert.equal(
		credential.properties.find((item) => item.name === 'csrfToken').typeOptions.password,
		true,
	);
	assert.equal(credential.test.request.baseURL, 'https://fanqienovel.com');
	assert.equal(credential.test.request.disableFollowRedirect, true);
	assert.equal(
		credential.properties.find((item) => item.name === 'allowedDomains').default,
		'fanqienovel.com',
	);
});
