import type { IDataObject, IExecuteFunctions, INodePropertyOptions } from 'n8n-workflow';
import { authorRequest, extractList, parseObject, unwrapData } from './helpers';
import { COVER_PATH, readCover } from './image';
import type { RequestSettings } from './types';

export function normalizeBookCreation(input: IDataObject): IDataObject {
	const name = String(input.book_name ?? '').trim();
	if (!/^[a-zA-Z0-9\u4e00-\u9fa5，：！？【】]{1,15}$/.test(name))
		throw new Error(
			'Book Name must contain 1–15 Chinese characters, letters, digits, or ，：！？【】, without spaces',
		);
	const abstract = String(input.abstract ?? '').trim();
	if (abstract.length < 50 || abstract.length > 500)
		throw new Error('Synopsis must contain 50–500 characters');
	if (input.gender === '' || input.gender === undefined || ![0, 1].includes(Number(input.gender)))
		throw new Error('Choose Male Audience (1) or Female Audience (0)');
	const category = (
		Array.isArray(input.category) ? input.category : String(input.category ?? '').split(',')
	).map((value) => String(value).trim());
	if (!category.length || category.some((value) => !/^\d+$/.test(value)))
		throw new Error('Choose at least one category or supply comma-separated category IDs');
	let roles: unknown = input.roles;
	if (typeof roles === 'string')
		roles = roles.trim().startsWith('[') ? JSON.parse(roles) : roles.split(/[,，]/);
	if (
		!Array.isArray(roles) ||
		roles.length < 1 ||
		roles.length > 2 ||
		roles.some((value) => typeof value !== 'string')
	)
		throw new Error('Supply one or two protagonist names, separated by commas or as a JSON array');
	const names = (roles as string[]).map((value) => value.trim());
	if (names.some((value) => !value || value.length > 5) || new Set(names).size !== names.length)
		throw new Error('Protagonist names must be different and contain 1–5 characters each');
	const mode = Number(input.sign_pattern ?? 0);
	if (![0, 1].includes(mode))
		throw new Error('Choose Serial Mode (0) or Completed Manuscript Mode (1)');
	return {
		...input,
		book_name: name,
		abstract,
		gender: Number(input.gender),
		category: [...new Set(category)].join(','),
		roles: JSON.stringify(names),
		sign_pattern: mode,
		is_self_pic: 1,
	};
}

export function categoryOptions(data: unknown): INodePropertyOptions[] {
	if (!Array.isArray(data)) throw new Error('The category API returned an unexpected schema');
	return data
		.filter(
			(value) =>
				value &&
				typeof value === 'object' &&
				value.category_id !== undefined &&
				typeof value.name === 'string',
		)
		.map((value) => ({
			name: `${value.label ? `${value.label} · ` : ''}${value.name}`,
			value: String(value.category_id),
			description: String(value.description ?? ''),
		}))
		.sort((a, b) => a.name.localeCompare(b.name));
}

export async function uploadCover(
	context: IExecuteFunctions,
	index: number,
	settings: RequestSettings,
): Promise<IDataObject> {
	const image = await readCover(context, index);
	const data = parseObject(
		unwrapData(
			await authorRequest(
				context,
				{ path: COVER_PATH, method: 'POST' },
				{},
				settings,
				index,
				image,
			),
		),
		'Uploaded cover response',
	);
	if (
		typeof data.pic_uri !== 'string' ||
		!data.pic_uri.trim() ||
		typeof data.pic_url !== 'string' ||
		!data.pic_url.trim()
	)
		throw new Error('The upload response did not include pic_uri and pic_url; no book was created');
	return {
		thumb_uri: data.pic_uri,
		pic_uri: data.pic_uri,
		pic_url: data.pic_url,
		width: image.width,
		height: image.height,
		mime_type: image.mimeType,
		ai_generated: image.aiGenerated,
		is_self_pic: 1,
	};
}

export interface BookCreationProgress extends IDataObject {
	stage: string;
	book_id?: string;
	thumb_uri?: string;
	pic_url?: string;
}

export async function createBookWithCover(
	context: IExecuteFunctions,
	index: number,
	input: IDataObject,
	settings: RequestSettings,
	progress: BookCreationProgress,
): Promise<IDataObject> {
	const params = normalizeBookCreation(input);
	const createVolume = Boolean(context.getNodeParameter('createInitialVolume', index, false));
	const volumeName = String(context.getNodeParameter('initialVolumeName', index, '第一卷')).trim();
	if (createVolume && !volumeName) throw new Error('Initial Volume Name must not be empty');
	progress.stage = 'validateCategories';
	const categories = unwrapData(
		await authorRequest(
			context,
			{ path: '/api/author/book/category_list/v0/', method: 'GET' },
			{ gender: params.gender },
			settings,
			index,
		),
	);
	const known = categoryOptions(categories);
	const chosen = String(params.category).split(',');
	if (chosen.some((id) => !known.some((option) => option.value === id)))
		throw new Error(
			'A category does not belong to this audience. Refresh the category list before creating the book',
		);
	if (Array.isArray(categories)) {
		for (const [label, maximum] of [
			['主分类', 1],
			['主题', 2],
			['角色', 2],
			['情节', 2],
		] as const) {
			const count = categories.filter(
				(value) => value.label === label && chosen.includes(String(value.category_id)),
			).length;
			if (count > maximum || (label === '主分类' && count !== 1))
				throw new Error(
					`Choose ${label === '主分类' ? 'exactly one' : `at most ${maximum}`} category in ${label}`,
				);
		}
	}
	progress.stage = 'uploadCover';
	let cover: IDataObject;
	if (context.getNodeParameter('coverSource', index, 'binary') === 'uploadedUri') {
		const uri = String(context.getNodeParameter('thumbUri', index, '')).trim();
		if (!uri || uri.length > 2048 || /[\s?#]/.test(uri) || uri.includes('://'))
			throw new Error('Cover URI must be the pic_uri returned by Upload Cover, not an image URL');
		cover = { thumb_uri: uri };
	} else cover = await uploadCover(context, index, settings);
	progress.thumb_uri = String(cover.thumb_uri);
	if (cover.pic_url) progress.pic_url = String(cover.pic_url);
	progress.stage = 'createBook';
	const created = parseObject(
		unwrapData(
			await authorRequest(
				context,
				{ path: '/api/author/book/create/v0/', method: 'POST' },
				{ ...params, thumb_uri: cover.thumb_uri },
				settings,
				index,
			),
		),
		'Created book response',
	);
	if (!created.book_id)
		throw new Error(
			'The create-book result did not contain a book ID. Check the book list before retrying',
		);
	const bookId = String(created.book_id);
	progress.book_id = bookId;
	const result: IDataObject = {
		...created,
		...cover,
		book_id: bookId,
		book_name: params.book_name,
		created: true,
	};
	if (createVolume) {
		progress.stage = 'createVolume';
		const volume = parseObject(
			unwrapData(
				await authorRequest(
					context,
					{ path: '/api/author/volume/add_volume/v0', method: 'POST' },
					{ book_id: bookId, volume_name: volumeName },
					settings,
					index,
				),
			),
			'Created volume response',
		);
		if (!volume.volume_id) {
			progress.stage = 'verifyVolume';
			const listed = unwrapData(
				await authorRequest(
					context,
					{ path: '/api/author/volume/volume_list/v1', method: 'GET' },
					{ book_id: bookId },
					settings,
					index,
				),
			);
			const matching = extractList(listed, ['volume_list', 'volume_data', 'list'])
				.map((value) => parseObject(value, 'Volume list item'))
				.filter((value) => value.volume_name === volumeName && value.volume_id);
			if (matching.length !== 1)
				throw new Error(
					'The new volume could not be identified unambiguously. Check the volume list before retrying',
				);
			volume.volume_id = matching[0].volume_id;
		}
		result.volume_id = String(volume.volume_id);
		result.volume_name = volumeName;
	}
	progress.stage = 'complete';
	return result;
}
