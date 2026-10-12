const test = require('node:test');
const assert = require('node:assert/strict');
const { saveAuthorDraft } = require('../dist/nodes/FanqieAuthor/drafts.js');
const { FanqieAuthor } = require('../dist/nodes/FanqieAuthor/FanqieAuthor.node.js');
const { NodeHelpers } = require('n8n-workflow');
const params = {
	book_id: '1',
	item_id: '9999999999999999999',
	volume_id: '2',
	volume_name: '正文',
	title: '第1章',
	content: '<p>正文</p>',
	publish_status: 0,
};
const settings = { timeout: 30000, readRetries: 0 };
const before = (version = 0) => ({
	publish_status: 0,
	permission_switch: 1,
	latest_version: version,
	title: version ? params.title : '',
	content: version ? params.content : '',
});
const after = {
	publish_status: 0,
	permission_switch: 1,
	latest_version: 1,
	title: params.title,
	content: params.content + '<p></p>',
};
function context(queue, nodeParams = {}) {
	const calls = [];
	return {
		calls,
		getNode: () => ({ name: 'Draft test', typeVersion: 1 }),
		getInputData: () => [{ json: {} }],
		getNodeParameter: (name, index, fallback) =>
			nodeParams[name] ?? (name === 'authentication' ? 'session' : fallback),
		getCredentials: async () => ({ cookieToken: 'private-cookie', csrfToken: 'private-csrf' }),
		continueOnFail: () => false,
		helpers: {
			httpRequestWithAuthentication: async (name, options) => {
				calls.push(options);
				const value = queue.shift();
				if (value instanceof Error) throw value;
				assert.notEqual(value, undefined, 'Unexpected HTTP request');
				return { statusCode: 200, headers: {}, body: JSON.stringify({ code: 0, data: value }) };
			},
		},
	};
}
test('modern blank drafts initialize through cover_article and verify unpublished persisted content', async () => {
	const ctx = context([before(), { latest_version: 1 }, after, after]);
	const result = await saveAuthorDraft(ctx, params, settings, 0, true);
	const write = ctx.calls.find((c) => c.method === 'POST');
	assert.match(write.url, /\/article\/cover_article\/v0\/$/);
	assert.equal(new URLSearchParams(write.body).has('item_version'), false);
	assert.equal(new URLSearchParams(write.body).has('publish_status'), false);
	assert.equal(result.item_id, params.item_id);
	assert.equal(result.draftVerified, true);
	assert.equal(result.save_protocol, 'collaborative');
	assert.equal(ctx.calls.filter((c) => c.method === 'POST').length, 1);
});
test('existing collaborative drafts carry the observed version and reject stale supplied versions', async () => {
	const ctx = context([
		before(1),
		{ latest_version: 2 },
		{ ...after, latest_version: 2 },
		{ ...after, latest_version: 2 },
	]);
	await saveAuthorDraft(ctx, { ...params, item_version: 1 }, settings, 0);
	assert.equal(new URLSearchParams(ctx.calls[1].body).get('item_version'), '1');
	const stale = context([before(2)]);
	await assert.rejects(
		saveAuthorDraft(stale, { ...params, item_version: 1 }, settings, 0),
		/version changed/,
	);
	assert.equal(stale.calls.length, 1);
});
test('published chapters and unknown editor protocols cannot be written by Draft Save', async () => {
	for (const state of [
		{ ...before(), publish_status: 1 },
		{ ...before(), permission_switch: undefined },
	]) {
		const ctx = context([state]);
		await assert.rejects(
			saveAuthorDraft(ctx, params, settings, 0),
			/not an unpublished draft|unknown draft protocol/,
		);
		assert.equal(
			ctx.calls.some((c) => c.method === 'POST'),
			false,
		);
	}
});
test('creation cannot overwrite a reused nonempty draft or unversioned existing document', async () => {
	for (const [state, requireEmpty] of [
		[before(1), true],
		[{ ...before(), content: '<p>他人编辑</p>' }, false],
	]) {
		const ctx = context([state]);
		await assert.rejects(
			saveAuthorDraft(ctx, params, settings, 0, requireEmpty),
			/existing nonempty draft|unversioned overwrite/,
		);
		assert.equal(
			ctx.calls.some((c) => c.method === 'POST'),
			false,
		);
	}
});
test('success responses with wrong state or mismatched content are never reported as saved', async () => {
	for (const bad of [
		{ ...after, publish_status: 1 },
		{ ...after, content: '<p>不同正文</p>' },
	]) {
		const ctx = context([before(), {}, bad, bad]);
		await assert.rejects(
			saveAuthorDraft(ctx, params, settings, 0),
			/unpublished draft|did not match/,
		);
		assert.equal(ctx.calls.filter((c) => c.method === 'POST').length, 1);
	}
});
test('a modern save timeout never falls back to the publishing endpoint or retries the write', async () => {
	const ctx = context([before(), Object.assign(new Error('timeout'), { statusCode: 502 })]);
	await assert.rejects(
		saveAuthorDraft(ctx, params, { ...settings, readRetries: 3 }, 0),
		/result is unknown/,
	);
	assert.equal(ctx.calls.filter((c) => c.method === 'POST').length, 1);
	assert.equal(
		ctx.calls.some((c) => c.url.includes('publish_article')),
		false,
	);
});
test('Create with Existing Draft ID resumes without allocating another editor ID', async () => {
	const ctx = context(
		[
			before(1),
			{ latest_version: 2 },
			{ ...after, latest_version: 2 },
			{ ...after, latest_version: 2 },
		],
		{
			resource: 'draft',
			operation: 'create',
			existingDraftId: params.item_id,
			bookId: params.book_id,
			volumeId: params.volume_id,
			volumeName: params.volume_name,
			title: params.title,
			content: '正文',
			contentFormat: 'text',
			parameters: '{}',
		},
	);
	const [items] = await FanqieAuthor.prototype.execute.call(ctx);
	assert.equal(items[0].json.resumed, true);
	assert.equal(items[0].json.draftVerified, true);
	assert.equal(
		ctx.calls.some((c) => c.url.includes('new_article')),
		false,
	);
	const description = new FanqieAuthor().description;
	assert.equal(
		NodeHelpers.getNodeParameters(
			description.properties,
			{ resource: 'draft', operation: 'create', existingDraftId: params.item_id },
			true,
			false,
			{ typeVersion: 1.1 },
		).existingDraftId,
		params.item_id,
	);
});
