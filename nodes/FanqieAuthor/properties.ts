import type { INodeProperties, INodePropertyOptions } from 'n8n-workflow';
import { endpoints } from './catalog';
import { operations } from './operations';

export const resourceNames: Record<string, string> = {
	account: 'Account',
	advanced: 'Advanced API',
	book: 'Book',
	chapter: 'Chapter',
	draft: 'Draft',
	income: 'Income',
	media: 'Media · 封面',
	statistics: 'Statistics',
	volume: 'Volume',
};

export function humanize(value: string): string {
	return value.replaceAll('_', ' ').replace(/\b\w/g, (character) => character.toUpperCase());
}

const labels: Record<string, string> = {
	book_id: 'Book ID',
	item_id: 'Chapter ID',
	volume_id: 'Volume ID',
	volume_name: 'Volume Name',
	book_name: 'Book Name',
	thumb_uri: 'Cover URI',
	start_date: 'Start Date',
	end_date: 'End Date',
	timer_time: 'Publication Time',
	timer_type: 'Schedule Action Code',
	item_version: 'Draft Version',
	query_word: 'Search Text',
	stats_types: 'Statistics Types',
};

function fieldProperty(field: string, resource: string, operation: string): INodeProperties {
	if (resource === 'book' && operation === 'createWithCover' && field === 'gender')
		return {
			displayName: 'Audience · 目标读者',
			name: 'gender',
			type: 'options',
			default: 1,
			required: true,
			options: [
				{ name: 'Male · 男频', value: 1 },
				{ name: 'Female · 女频', value: 0 },
			],
			displayOptions: { show: { resource: ['book'], operation: ['createWithCover'] } },
		};
	if (resource === 'book' && operation === 'createWithCover' && field === 'category')
		return {
			displayName: 'Category Names or IDs',
			name: 'category',
			type: 'multiOptions',
			default: [],
			required: true,
			typeOptions: { loadOptionsMethod: 'getBookCategories', loadOptionsDependsOn: ['gender'] },
			description:
				'Choose from the list, or specify IDs using an <a href="https://docs.n8n.io/code/expressions/">expression</a>',
			displayOptions: { show: { resource: ['book'], operation: ['createWithCover'] } },
		};
	return {
		displayName: labels[field] ?? humanize(field),
		name: field.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase()),
		type: 'string',
		required: true,
		default: '',
		typeOptions: ['content', 'abstract'].includes(field) ? { rows: 5 } : undefined,
		displayOptions: { show: { resource: [resource], operation: [operation] } },
		description: field.endsWith('_id')
			? 'Keep the complete ID as a string'
			: field === 'timer_time'
				? 'An ISO date including timezone or a Unix timestamp in seconds'
				: field === 'thumb_uri'
					? 'Use thumb_uri from Media > Upload Cover, or choose Book > Create With Cover to upload automatically'
					: field === 'roles'
						? 'One or two protagonist names, separated by commas or as a JSON array. Each name is 1–5 characters.'
						: field === 'start_date' || field === 'end_date'
							? 'The API date string, for example YYYY-MM-DD'
							: `The ${field.replaceAll('_', ' ')} for this operation`,
		placeholder:
			field === 'timer_time'
				? '2026-10-12T08:00:00+08:00'
				: field.endsWith('_id')
					? '1234567890123456789'
					: '',
	};
}

const properties: INodeProperties[] = [
	{
		displayName: 'Authentication · 登录方式',
		name: 'authentication',
		type: 'options',
		noDataExpression: true,
		options: [
			{
				name: '扫码登录（推荐）',
				value: 'qrLogin',
				description: 'Scan the official QR code through your self-hosted login component',
			},
			{
				name: '手动登录态',
				value: 'session',
				description: 'Use existing Cookie and CSRF credentials',
			},
		],
		default: 'session',
		displayOptions: {
			show: { '@version': [1] },
			hide: { operation: ['getCatalog'] },
		},
	},
	{
		displayName: 'Authentication · 登录方式',
		name: 'authentication',
		type: 'options',
		noDataExpression: true,
		options: [
			{
				name: '扫码登录（推荐）',
				value: 'qrLogin',
				description: 'Scan the official QR code through your self-hosted login component',
			},
			{
				name: '手动登录态',
				value: 'session',
				description: 'Use existing Cookie and CSRF credentials',
			},
		],
		default: 'qrLogin',
		displayOptions: {
			show: { '@version': [{ _cnd: { gte: 1.1 } }] },
			hide: { operation: ['getCatalog'] },
		},
	},
	{
		displayName: 'Resource',
		name: 'resource',
		type: 'options',
		noDataExpression: true,
		options: Object.entries(resourceNames).map(([value, name]) => ({ name, value })),
		default: 'book',
	},
];

const coverOperations = {
	show: { resource: ['media', 'book'], operation: ['uploadCover', 'createWithCover'] },
};
const coverProperties: INodeProperties[] = [
	{
		displayName: 'Cover Source',
		name: 'coverSource',
		type: 'options',
		default: 'binary',
		options: [
			{ name: 'Binary Data', value: 'binary' },
			{ name: 'Base64', value: 'base64' },
		],
		displayOptions: { show: { resource: ['media'], operation: ['uploadCover'] } },
	},
	{
		displayName: 'Cover Source',
		name: 'coverSource',
		type: 'options',
		default: 'binary',
		options: [
			{ name: 'Binary Data', value: 'binary' },
			{ name: 'Base64', value: 'base64' },
			{ name: 'Already Uploaded URI', value: 'uploadedUri' },
		],
		displayOptions: { show: { resource: ['book'], operation: ['createWithCover'] } },
	},
	{
		displayName: 'Input Binary Field',
		name: 'binaryPropertyName',
		type: 'string',
		default: 'data',
		required: true,
		description:
			'The binary field containing the PNG or JPEG image from an image generation or download node',
		displayOptions: { show: { ...coverOperations.show, coverSource: ['binary'] } },
	},
	{
		displayName: 'Image Base64',
		name: 'imageBase64',
		type: 'string',
		default: '',
		required: true,
		typeOptions: { rows: 3 },
		description:
			'PNG or JPEG Base64, optionally with a data URL prefix; maximum decoded size is 5 MiB',
		displayOptions: { show: { ...coverOperations.show, coverSource: ['base64'] } },
	},
	{
		displayName: 'Image Origin',
		name: 'imageOrigin',
		type: 'options',
		default: 'ai',
		required: true,
		options: [
			{ name: 'AI-Generated', value: 'ai' },
			{ name: 'Original / Non-AI', value: 'original' },
		],
		description:
			'AI-generated images are uploaded with the official AI label and watermark parameters',
		displayOptions: { show: { ...coverOperations.show, coverSource: ['binary', 'base64'] } },
	},
	{
		displayName: 'Cover URI',
		name: 'thumbUri',
		type: 'string',
		default: '',
		required: true,
		description:
			'The thumb_uri returned by Upload Cover; this lets a failed book creation reuse the uploaded image',
		displayOptions: {
			show: { resource: ['book'], operation: ['createWithCover'], coverSource: ['uploadedUri'] },
		},
	},
	{
		displayName: 'Writing Mode',
		name: 'signPattern',
		type: 'options',
		default: 0,
		options: [
			{ name: 'Serial · 连载模式', value: 0 },
			{ name: 'Completed Manuscript · 完本模式', value: 1 },
		],
		displayOptions: { show: { resource: ['book'], operation: ['createWithCover'] } },
	},
	{
		displayName: 'Create Initial Volume',
		name: 'createInitialVolume',
		type: 'boolean',
		default: false,
		description:
			'Whether to create the first volume after the book is created and return its ID for draft creation',
		displayOptions: { show: { resource: ['book'], operation: ['createWithCover'] } },
	},
	{
		displayName: 'Initial Volume Name',
		name: 'initialVolumeName',
		type: 'string',
		default: '第一卷',
		required: true,
		displayOptions: {
			show: { resource: ['book'], operation: ['createWithCover'], createInitialVolume: [true] },
		},
	},
];

for (const resource of Object.keys(resourceNames).filter((value) => value !== 'advanced')) {
	const group = operations.filter((operation) => operation.resource === resource);
	const operationProperty: INodeProperties = {
		displayName: 'Operation',
		name: 'operation',
		type: 'options',
		noDataExpression: true,
		displayOptions: { show: { resource: [resource] } },
		options: group
			.map(
				(operation) =>
					({
						name: operation.name,
						value: operation.value,
						description: operation.action,
						action: operation.action,
					}) as INodePropertyOptions,
			)
			.sort((a, b) => a.name.localeCompare(b.name)),
		default: 'get',
	};
	operationProperty.default = group.some((operation) => operation.value === 'getMany')
		? 'getMany'
		: group[0].value;
	properties.push(operationProperty);
	for (const operation of group) {
		for (const field of operation.required ?? [])
			properties.push(fieldProperty(field, resource, operation.value));
		if (operation.content)
			properties.push({
				displayName: 'Content Format',
				name: 'contentFormat',
				type: 'options',
				options: [
					{ name: 'Plain Text', value: 'text' },
					{ name: 'HTML', value: 'html' },
				],
				default: 'text',
				displayOptions: { show: { resource: [resource], operation: [operation.value] } },
			});
		if (operation.recipe === 'publish' || operation.recipe === 'schedule')
			properties.push({
				displayName: 'AI Usage',
				name: 'aiUsage',
				type: 'options',
				required: true,
				options: [
					{ name: 'AI Was Used', value: 1 },
					{ name: 'AI Was Not Used', value: 2 },
				],
				default: 1,
				description: 'Declare the actual AI usage for this chapter',
				displayOptions: { show: { resource: [resource], operation: [operation.value] } },
			});
		if (operation.pagination) {
			properties.push({
				displayName: 'Return All',
				name: 'returnAll',
				type: 'boolean',
				default: false,
				description: 'Whether to return all results or only up to a given limit',
				displayOptions: { show: { resource: [resource], operation: [operation.value] } },
			});
			properties.push({
				displayName: 'Limit',
				name: 'limit',
				type: 'number',
				default: 50,
				typeOptions: { minValue: 1 },
				description: 'Max number of results to return',
				displayOptions: {
					show: { resource: [resource], operation: [operation.value], returnAll: [false] },
				},
			});
		}
	}
}

properties.push(...coverProperties);

properties.push(
	{
		displayName: 'Operation',
		name: 'operation',
		type: 'options',
		noDataExpression: true,
		displayOptions: { show: { resource: ['advanced'] } },
		options: [
			{ name: 'Custom Request', value: 'customRequest', action: 'Call another author API path' },
			{ name: 'Get Catalog', value: 'getCatalog', action: 'Get discovered endpoint metadata' },
			{ name: 'Request', value: 'request', action: 'Call a discovered endpoint' },
		],
		default: 'request',
	},
	{
		displayName: 'API Group',
		name: 'apiGroup',
		type: 'options',
		options: [
			{ name: 'All Groups', value: '' },
			...[...new Set(endpoints.map((item) => item.group))]
				.map((value) => ({ name: humanize(value), value }))
				.sort((a, b) => a.name.localeCompare(b.name)),
		],
		default: '',
		displayOptions: { show: { resource: ['advanced'], operation: ['request', 'getCatalog'] } },
	},
	{
		displayName: 'Endpoint Name or ID',
		name: 'endpointId',
		type: 'options',
		typeOptions: { loadOptionsMethod: 'getEndpoints', loadOptionsDependsOn: ['apiGroup'] },
		default: '',
		required: true,
		description:
			'Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>',
		displayOptions: { show: { resource: ['advanced'], operation: ['request'] } },
	},
	{
		displayName: 'Method',
		name: 'httpMethod',
		type: 'options',
		options: [
			{ name: 'DELETE', value: 'DELETE' },
			{ name: 'GET', value: 'GET' },
			{ name: 'PATCH', value: 'PATCH' },
			{ name: 'POST', value: 'POST' },
			{ name: 'PUT', value: 'PUT' },
		],
		default: 'GET',
		displayOptions: { show: { resource: ['advanced'], operation: ['customRequest'] } },
	},
	{
		displayName: 'API Path',
		name: 'apiPath',
		type: 'string',
		default: '',
		placeholder: '/api/author/account/info/v0/',
		required: true,
		description: 'The author API path on fanqienovel.com',
		displayOptions: { show: { resource: ['advanced'], operation: ['customRequest'] } },
	},
	{
		displayName: 'Parameters (JSON)',
		name: 'parameters',
		type: 'json',
		default: '{}',
		description:
			'Additional API parameters. On advanced requests this is the complete query or form payload. IDs should be strings.',
		displayOptions: { hide: { operation: ['getCatalog'] } },
	},
	{
		displayName: 'Response Mode',
		name: 'responseMode',
		type: 'options',
		options: [
			{ name: 'Data', value: 'data' },
			{ name: 'Full API Response', value: 'full' },
		],
		default: 'data',
		description: 'Choose data only or the full business response, without request headers',
		displayOptions: { show: { resource: ['advanced'], operation: ['request', 'customRequest'] } },
	},
	{
		displayName: 'Options',
		name: 'options',
		type: 'collection',
		placeholder: 'Add Option',
		default: {},
		options: [
			{
				displayName: 'Max Pages',
				name: 'maxPages',
				type: 'number',
				default: 100,
				typeOptions: { minValue: 1, maxValue: 1000 },
				description: 'Maximum pages to fetch before reporting incomplete pagination',
			},
			{
				displayName: 'Read Retries',
				name: 'readRetries',
				type: 'number',
				default: 2,
				typeOptions: { minValue: 0, maxValue: 3 },
				description:
					'Retries for transient HTTP failures on read operations. Writes are never retried by this node.',
			},
			{
				displayName: 'Timeout (Ms)',
				name: 'timeout',
				type: 'number',
				default: 30000,
				typeOptions: { minValue: 1000, maxValue: 120000 },
				description: 'Request timeout in milliseconds',
			},
		],
		displayOptions: { hide: { operation: ['getCatalog'] } },
	},
);

export const nodeProperties = properties;
