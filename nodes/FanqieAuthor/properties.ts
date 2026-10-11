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
					? 'A cover image URI already uploaded to the author workspace'
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
		displayName: 'Resource',
		name: 'resource',
		type: 'options',
		noDataExpression: true,
		options: Object.entries(resourceNames).map(([value, name]) => ({ name, value })),
		default: 'book',
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
		displayOptions: { hide: { resource: ['advanced'], operation: ['getCatalog'] } },
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
		displayOptions: { hide: { resource: ['advanced'], operation: ['getCatalog'] } },
	},
);

export const nodeProperties = properties;
