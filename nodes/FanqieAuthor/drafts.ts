import type { IDataObject, IExecuteFunctions } from 'n8n-workflow';
import { authorRequest, parseObject, unwrapData } from './helpers';
import type { RequestSettings } from './types';

const EDIT_PATH = '/api/author/edit_article/v0/';
const COVER_PATH = '/api/author/article/cover_article/v0/';
const LATEST_PATH = '/api/author/article/get_latest_article/v0/';

function canonicalHtml(value: string): string {
	return value.replace(/(?:<p><\/p>)+$/, '');
}

export async function saveAuthorDraft(
	context: IExecuteFunctions,
	params: IDataObject,
	settings: RequestSettings,
	itemIndex: number,
	requireEmpty = false,
): Promise<IDataObject> {
	const identity = { book_id: params.book_id, item_id: params.item_id };
	const read = async (path: string, ids = identity): Promise<IDataObject> =>
		parseObject(
			unwrapData(await authorRequest(context, { path, method: 'GET' }, ids, settings, itemIndex)),
			'Draft state',
		);
	const before = await read(EDIT_PATH);
	if (before.publish_status === undefined || Number(before.publish_status) !== 0)
		throw new Error(
			'This item is not an unpublished draft. Draft Save will not modify a published chapter.',
		);
	if (requireEmpty && (before.title || canonicalHtml(String(before.content ?? ''))))
		throw new Error(
			'The editor returned an existing nonempty draft. Inspect it and supply its Existing Draft ID explicitly to resume; its content was not overwritten.',
		);
	const permission = Number(before.permission_switch);
	if (before.permission_switch === undefined || ![0, 1].includes(permission))
		throw new Error(
			'The author editor returned an unknown draft protocol; no content was written.',
		);
	const version = Number(before.latest_version);
	if (permission === 1 && (!Number.isSafeInteger(version) || version < 0))
		throw new Error(
			'The author editor did not return a valid draft version; no content was written.',
		);
	if (params.item_version !== undefined && Number(params.item_version) !== version)
		throw new Error(
			'The draft version changed. Read the latest draft before saving; no content was written.',
		);
	const title = String(params.title ?? '');
	const html = String(params.content ?? '');
	const content = html.endsWith('<p></p>') ? html : `${html}<p></p>`;
	let payload: IDataObject;
	if (permission === 1) {
		if (version === 0 && (before.title || canonicalHtml(String(before.content ?? ''))))
			throw new Error(
				'An existing draft has no usable version. No unversioned overwrite was attempted.',
			);
		payload = {
			...identity,
			title,
			content,
			volume_id: params.volume_id,
			volume_name: params.volume_name,
			// The official editor omits item_version while initializing a blank version-zero document.
			...(version > 0 ? { item_version: version } : {}),
		};
	} else
		payload = { ...params, title, content, publish_status: 0, timer_status: 0, timer_time: '' };
	const saved = parseObject(
		unwrapData(
			await authorRequest(
				context,
				{ path: permission === 1 ? COVER_PATH : '/api/author/publish_article/v0/', method: 'POST' },
				payload,
				settings,
				itemIndex,
			),
		),
		'Draft save response',
	);
	const finalIdentity = { ...identity, item_id: saved.item_id ?? identity.item_id };
	const after = await read(EDIT_PATH, finalIdentity);
	if (after.publish_status === undefined || Number(after.publish_status) !== 0)
		throw new Error(
			'The save response did not leave an unpublished draft. Inspect the author workspace before retrying.',
		);
	const document = permission === 1 ? await read(LATEST_PATH, finalIdentity) : after;
	if (
		document.title !== title ||
		canonicalHtml(String(document.content ?? '')) !== canonicalHtml(content)
	)
		throw new Error(
			'The save returned success but the stored draft did not match its title and content. No additional write was attempted.',
		);
	return {
		item_id: String(finalIdentity.item_id),
		book_id: params.book_id,
		submitted: true,
		publicationVerified: false,
		draftVerified: true,
		action: 'draftSaved',
		save_protocol: permission === 1 ? 'collaborative' : 'legacy',
		latest_version: document.latest_version,
		data: saved,
	};
}
