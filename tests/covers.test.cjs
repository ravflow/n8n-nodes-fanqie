const test = require('node:test');
const assert = require('node:assert/strict');
const { FanqieAuthor } = require('../dist/nodes/FanqieAuthor/FanqieAuthor.node');
const {
	inspectCover,
	decodeCoverBase64,
	MAX_COVER_BYTES,
} = require('../dist/nodes/FanqieAuthor/image');
const { normalizeBookCreation } = require('../dist/nodes/FanqieAuthor/bookCreation');
const png = Buffer.from(
	'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==',
	'base64',
);
const categories = [
	{ category_id: 100, name: '悬疑', label: '主分类' },
	{ category_id: 101, name: '推理', label: '主题' },
];
const valid = {
	book_name: '雨夜铜钱',
	gender: 1,
	category: ['100', '101'],
	roles: '陆然',
	abstract:
		'雨夜加班归来的青年在巷口遇见一个消失的人，对方交给他一枚刻着自己名字的铜钱。每当危险靠近，铜钱便会发烫，他开始追查这座城市被遗忘的秘密。',
};
const coverResult = {
	pic_uri: 'novel-static/real-upload-result',
	pic_url: 'https://cdn.example.test/cover.png',
};
const bookId = '9999999999999999999';
const volumeId = '8888888888888888888';
function context(parameters, responses, fail = false) {
	const calls = [];
	let offset = 0;
	return {
		calls,
		getNode: () => ({ name: 'Cover test', typeVersion: 1.1, parameters: {} }),
		getInputData: () => [
			{ json: {}, binary: { data: { mimeType: 'image/png', data: 'filesystem-handle' } } },
		],
		getNodeParameter: (key, index, fallback) => parameters[key] ?? fallback,
		getCurrentNodeParameter: (key) => parameters[key],
		continueOnFail: () => fail,
		getCredentials: async (name) =>
			name === 'fanqieAuthorApi'
				? { cookieToken: 'secret-cookie', csrfToken: 'secret-csrf' }
				: {
						loginServiceUrl: 'http://127.0.0.1:8789',
						oauthTokenData: { access_token: 'q'.repeat(43) },
					},
		helpers: {
			getBinaryDataBuffer: async (index, name) => {
				assert.equal(index, 0);
				assert.equal(name, 'data');
				return png;
			},
			httpRequestWithAuthentication: async (name, options) => {
				calls.push({ name, options });
				const data = responses[offset++];
				if (data instanceof Error) throw data;
				if (!data) throw Error('Unexpected request');
				const response = { statusCode: 200, headers: {}, body: JSON.stringify({ code: 0, data }) };
				return name === 'fanqieAuthorApi' ? response : { statusCode: 200, body: response };
			},
		},
	};
}
function bookParameters(extra = {}) {
	return {
		resource: 'book',
		operation: 'createWithCover',
		bookName: valid.book_name,
		gender: 1,
		category: valid.category,
		roles: valid.roles,
		abstract: valid.abstract,
		...extra,
	};
}
test('image validation bounds size/dimensions and rejects URLs or truncated images', () => {
	assert.deepEqual([inspectCover(png).width, inspectCover(png).height], [1, 1]);
	assert.throws(() => inspectCover(png.subarray(0, -4)), /PNG|JPEG/);
	assert.throws(() => inspectCover(Buffer.alloc(MAX_COVER_BYTES + 1)), /5 MiB/);
	assert.throws(() => decodeCoverBase64('https://example.test/cover.png'), /Base64/);
	assert.throws(() => decodeCoverBase64(png.toString('base64') + '!'), /Base64/);
	assert.deepEqual(decodeCoverBase64('data:image/png;base64,' + png.toString('base64')), png);
	const oversized = Buffer.from(png);
	oversized.writeUInt32BE(20000, 16);
	assert.throws(() => inspectCover(oversized), /dimensions/);
	const jpeg = Buffer.from('ffd8ffc0000b080320025801011100ffd9', 'hex');
	assert.deepEqual([inspectCover(jpeg).width, inspectCover(jpeg).height], [600, 800]);
});
test('manual uploads use real multipart bytes and AI metadata at the fixed endpoint', async () => {
	const ctx = context({ resource: 'media', operation: 'uploadCover', authentication: 'session' }, [
		coverResult,
	]);
	const [[result]] = await new FanqieAuthor().execute.call(ctx);
	assert.equal(result.json.thumb_uri, coverResult.pic_uri);
	const { options, name } = ctx.calls[0];
	assert.equal(name, 'fanqieAuthorApi');
	assert.equal(options.url, 'https://fanqienovel.com/api/author/data/upload_pic_v2/v0/');
	assert.ok(Buffer.isBuffer(options.body));
	assert.ok(options.body.includes(png));
	assert.ok(options.body.includes('name="file"; filename="cover.png"'));
	assert.match(options.headers['Content-Type'], /^multipart\/form-data; boundary=/);
	assert.equal(options.qs.ai_label, '1');
	assert.equal(options.qs.blind_watermark, 'ai_cover');
	assert.equal(options.disableFollowRedirect, true);
	assert.equal(ctx.calls.length, 1);
});
test('QR uploads use the companion route without exposing the website session', async () => {
	const ctx = context(
		{
			resource: 'media',
			operation: 'uploadCover',
			coverSource: 'base64',
			imageBase64: png.toString('base64'),
			imageOrigin: 'original',
		},
		[coverResult],
	);
	const [[result]] = await new FanqieAuthor().execute.call(ctx);
	assert.equal(result.json.ai_generated, false);
	assert.equal(ctx.calls[0].options.url, 'http://127.0.0.1:8789/api/cover/upload');
	assert.equal(ctx.calls[0].options.body.imageBase64, png.toString('base64'));
	assert.equal(ctx.calls[0].options.body.aiGenerated, false);
	assert.equal(JSON.stringify(ctx.calls).includes('q'.repeat(43)), false);
});
test('upload timeouts do not retry writes or return a made-up cover URI', async () => {
	const ctx = context(
		{ resource: 'media', operation: 'uploadCover', options: { readRetries: 3 } },
		[Object.assign(Error('secret-token'), { code: 'ETIMEDOUT' })],
	);
	await assert.rejects(new FanqieAuthor().execute.call(ctx), /result is unknown/);
	assert.equal(ctx.calls.length, 1);
	const bad = context({ resource: 'media', operation: 'uploadCover' }, [{}]);
	await assert.rejects(new FanqieAuthor().execute.call(bad), /pic_uri/);
});
test('book input normalizes female audience zero, role JSON and category IDs', () => {
	const result = normalizeBookCreation({ ...valid, gender: 0, roles: '["陆然","林雨"]' });
	assert.equal(result.gender, 0);
	assert.equal(result.roles, '["陆然","林雨"]');
	assert.equal(result.category, '100,101');
	assert.equal(result.is_self_pic, 1);
	for (const bad of [
		{ book_name: 'name with spaces' },
		{ abstract: '太短' },
		{ gender: 2 },
		{ category: [] },
		{ roles: '陆然,陆然' },
	])
		assert.throws(() => normalizeBookCreation({ ...valid, ...bad }));
});
test('invalid inputs and categories fail before any write', async () => {
	const bad = context(bookParameters({ bookName: 'invalid name' }), []);
	await assert.rejects(new FanqieAuthor().execute.call(bad), /Book Name/);
	assert.equal(bad.calls.length, 0);
	const category = context(bookParameters({ category: ['999'] }), [categories]);
	await assert.rejects(new FanqieAuthor().execute.call(category), /category/);
	assert.equal(category.calls.length, 1);
	const themeOnly = context(bookParameters({ category: ['101'] }), [categories]);
	await assert.rejects(new FanqieAuthor().execute.call(themeOnly), /主分类/);
	assert.equal(themeOnly.calls.length, 1);
});
test('create-with-cover orders category check, upload, book and volume with lossless IDs', async () => {
	const ctx = context(bookParameters({ createInitialVolume: true }), [
		categories,
		coverResult,
		{ book_id: bookId },
		{ volume_id: volumeId },
	]);
	const [[result]] = await new FanqieAuthor().execute.call(ctx);
	assert.equal(result.json.book_id, bookId);
	assert.equal(result.json.volume_id, volumeId);
	assert.equal(result.json.volume_name, '第一卷');
	assert.equal(ctx.calls.length, 4);
	const body = new URLSearchParams(ctx.calls[2].options.body.body);
	assert.equal(body.get('thumb_uri'), coverResult.pic_uri);
	assert.equal(body.get('roles'), '["陆然"]');
	assert.equal(new URLSearchParams(ctx.calls[3].options.body.body).get('book_id'), bookId);
});
test('book failure returns uploaded URI for recovery and does not retry create', async () => {
	const ctx = context(
		bookParameters(),
		[categories, coverResult, Object.assign(Error('timeout'), { code: 'ETIMEDOUT' })],
		true,
	);
	const [[result]] = await new FanqieAuthor().execute.call(ctx);
	assert.equal(result.json.thumb_uri, coverResult.pic_uri);
	assert.equal(result.json.stage, 'createBook');
	assert.equal(result.json.recovery, 'checkBookListThenReuseCover');
	assert.equal(ctx.calls.length, 3);
});

test('an empty successful volume response is resolved from the volume list without another write', async () => {
	const ctx = context(bookParameters({ createInitialVolume: true }), [
		categories,
		coverResult,
		{ book_id: bookId },
		{},
		{ volume_list: [{ volume_name: '第一卷', volume_id: volumeId }] },
	]);
	const [[result]] = await new FanqieAuthor().execute.call(ctx);
	assert.equal(result.json.volume_id, volumeId);
	assert.equal(ctx.calls.length, 5);
	assert.equal(ctx.calls[4].options.body.method, 'GET');
});
test('volume failure returns created book ID to avoid a duplicate book', async () => {
	const ctx = context(
		bookParameters({ createInitialVolume: true }),
		[categories, coverResult, { book_id: bookId }, Error('volume timeout')],
		true,
	);
	const [[result]] = await new FanqieAuthor().execute.call(ctx);
	assert.equal(result.json.book_id, bookId);
	assert.equal(result.json.recovery, 'continueExistingBook');
	assert.equal(ctx.calls.length, 4);
});
test('uploaded URI skips upload and rejects image URLs', async () => {
	const ctx = context(
		bookParameters({ coverSource: 'uploadedUri', thumbUri: coverResult.pic_uri }),
		[categories, { book_id: bookId }],
	);
	const [[result]] = await new FanqieAuthor().execute.call(ctx);
	assert.equal(result.json.book_id, bookId);
	assert.equal(ctx.calls.length, 2);
	const bad = context(
		bookParameters({ coverSource: 'uploadedUri', thumbUri: 'https://example.test/x.png' }),
		[categories],
	);
	await assert.rejects(new FanqieAuthor().execute.call(bad), /not an image URL/);
	assert.equal(bad.calls.length, 1);
});
