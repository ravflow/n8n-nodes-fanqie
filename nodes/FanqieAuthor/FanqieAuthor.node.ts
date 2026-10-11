import { NodeConnectionTypes, NodeOperationError } from 'n8n-workflow';
import type {
	IDataObject,
	IExecuteFunctions,
	ILoadOptionsFunctions,
	INodeExecutionData,
	INodePropertyOptions,
	INodeType,
	INodeTypeDescription,
} from 'n8n-workflow';
import { endpoints } from './catalog';
import {
	authorRequest,
	buildPublishPayload,
	extractList,
	fetchList,
	parseObject,
	toUnixSeconds,
	unwrapData,
	validateRequired,
} from './helpers';
import { findOperation } from './operations';
import { nodeProperties } from './properties';
import type { Endpoint, RequestSettings } from './types';

function toOutput(value: unknown, itemIndex: number): INodeExecutionData[] {
	const list = Array.isArray(value) ? value : [value];
	return list.map((item) => ({
		json:
			item && typeof item === 'object' && !Array.isArray(item)
				? (item as IDataObject)
				: { value: item ?? null },
		pairedItem: { item: itemIndex },
	}));
}

export class FanqieAuthor implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'Fanqie Author',
		name: 'fanqieAuthor',
		icon: { light: 'file:fanqie.svg', dark: 'file:fanqie.dark.svg' },
		group: ['transform'],
		version: 1,
		usableAsTool: true,
		subtitle: '={{$parameter["operation"] + ": " + $parameter["resource"]}}',
		description: 'Manage Fanqie Novel author books, chapters, statistics, and income',
		defaults: { name: 'Fanqie Author' },
		inputs: [NodeConnectionTypes.Main],
		outputs: [NodeConnectionTypes.Main],
		credentials: [
			{
				name: 'fanqieAuthorApi',
				required: true,
				displayOptions: { hide: { resource: ['advanced'], operation: ['getCatalog'] } },
			},
		],
		properties: nodeProperties,
	};

	methods = {
		loadOptions: {
			async getEndpoints(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {
				const group = String(this.getCurrentNodeParameter('apiGroup') ?? '');
				return endpoints
					.filter((endpoint) => !group || endpoint.group === group)
					.map((endpoint) => ({
						name: `${endpoint.name} · ${endpoint.method} ${endpoint.path}`,
						value: endpoint.id,
						description: 'Discovered, not live verified. Fields: ,.',
					}))
					.sort((a, b) => a.name.localeCompare(b.name));
			},
		},
	};

	async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
		const items = this.getInputData();
		const output: INodeExecutionData[] = [];
		for (let itemIndex = 0; itemIndex < items.length; itemIndex++) {
			let createdItemId: string | undefined;
			try {
				const resource = String(this.getNodeParameter('resource', itemIndex));
				const operationName = String(this.getNodeParameter('operation', itemIndex));
				if (resource === 'advanced' && operationName === 'getCatalog') {
					const group = String(this.getNodeParameter('apiGroup', itemIndex, ''));
					output.push(
						...toOutput(
							endpoints.filter((endpoint) => !group || endpoint.group === group),
							itemIndex,
						),
					);
					continue;
				}
				const options = this.getNodeParameter('options', itemIndex, {}) as IDataObject;
				const settings: RequestSettings = {
					timeout: Number(options.timeout ?? 30000),
					readRetries: Number(options.readRetries ?? 2),
				};
				if (
					!Number.isFinite(settings.timeout) ||
					settings.timeout < 1000 ||
					settings.timeout > 120000 ||
					!Number.isInteger(settings.readRetries) ||
					settings.readRetries < 0 ||
					settings.readRetries > 3
				)
					throw new NodeOperationError(this.getNode(), 'Invalid timeout or read retry count', {
						itemIndex,
					});
				let params = parseObject(
					this.getNodeParameter('parameters', itemIndex, '{}'),
					'Parameters',
				);
				if (resource === 'advanced') {
					let endpoint: Pick<Endpoint, 'path' | 'method'>;
					if (operationName === 'request') {
						const id = String(this.getNodeParameter('endpointId', itemIndex));
						const found = endpoints.find((candidate) => candidate.id === id);
						if (!found)
							throw new NodeOperationError(
								this.getNode(),
								'Choose a valid endpoint from the catalog',
								{ itemIndex },
							);
						endpoint = found;
					} else if (operationName === 'customRequest') {
						endpoint = {
							path: String(this.getNodeParameter('apiPath', itemIndex)),
							method: this.getNodeParameter('httpMethod', itemIndex) as Endpoint['method'],
						};
						if (!['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].includes(endpoint.method))
							throw new NodeOperationError(this.getNode(), 'Unsupported HTTP method', {
								itemIndex,
							});
					} else
						throw new NodeOperationError(this.getNode(), 'Unsupported advanced operation', {
							itemIndex,
						});
					const response = await authorRequest(this, endpoint, params, settings, itemIndex);
					const mode = String(this.getNodeParameter('responseMode', itemIndex, 'data'));
					output.push(...toOutput(mode === 'full' ? response : unwrapData(response), itemIndex));
					continue;
				}
				const operation = findOperation(resource, operationName);
				params = { ...operation.defaults, ...params };
				for (const field of operation.required ?? []) {
					const property = field.replace(/_([a-z])/g, (_, character: string) =>
						character.toUpperCase(),
					);
					params[field] = this.getNodeParameter(property, itemIndex) as string;
				}
				validateRequired(params, operation.required);
				if (operation.recipe) {
					const format = String(this.getNodeParameter('contentFormat', itemIndex, 'text'));
					const usage = ['publish', 'schedule'].includes(operation.recipe)
						? this.getNodeParameter('aiUsage', itemIndex)
						: undefined;
					params = buildPublishPayload(params, operation.recipe, format, usage);
				} else if (params.timer_time !== undefined)
					params.timer_time = toUnixSeconds(params.timer_time);
				if (operation.recipe === 'createDraft') {
					const result = unwrapData(
						await authorRequest(
							this,
							operation,
							{ book_id: params.book_id, need_reuse: 0 },
							settings,
							itemIndex,
						),
					);
					const draft = parseObject(result, 'Created draft response');
					if (!draft.item_id)
						throw new NodeOperationError(
							this.getNode(),
							'The create-draft response did not include a chapter ID',
							{ itemIndex },
						);
					createdItemId = String(draft.item_id);
					params.item_id = createdItemId;
					const saved = unwrapData(
						await authorRequest(
							this,
							{ path: '/api/author/publish_article/v0/', method: 'POST' },
							params,
							settings,
							itemIndex,
						),
					);
					output.push(
						...toOutput(
							{
								item_id: createdItemId,
								book_id: params.book_id,
								submitted: true,
								publicationVerified: false,
								action: 'draftSaved',
								data: saved as IDataObject,
							},
							itemIndex,
						),
					);
					continue;
				}
				if (operation.pagination) {
					const returnAll = Boolean(this.getNodeParameter('returnAll', itemIndex, false));
					const limit = Number(this.getNodeParameter('limit', itemIndex, 50));
					const maxPages = Number(options.maxPages ?? 100);
					if (
						!Number.isInteger(limit) ||
						limit < 1 ||
						!Number.isInteger(maxPages) ||
						maxPages < 1 ||
						maxPages > 1000
					)
						throw new NodeOperationError(
							this.getNode(),
							'Limit and Max Pages must be positive integers',
							{ itemIndex },
						);
					output.push(
						...toOutput(
							await fetchList(
								this,
								operation,
								params,
								settings,
								itemIndex,
								returnAll,
								limit,
								maxPages,
							),
							itemIndex,
						),
					);
					continue;
				}
				const response = await authorRequest(this, operation, params, settings, itemIndex);
				const data = unwrapData(response);
				if (operation.listKeys)
					output.push(...toOutput(extractList(data, operation.listKeys), itemIndex));
				else if (operation.recipe)
					output.push(
						...toOutput(
							{
								item_id: params.item_id,
								book_id: params.book_id,
								submitted: true,
								publicationVerified: false,
								action:
									operation.recipe === 'saveDraft'
										? 'draftSaved'
										: operation.recipe === 'schedule'
											? 'scheduledSubmission'
											: 'publicationSubmission',
								data: data as IDataObject,
							},
							itemIndex,
						),
					);
				else output.push(...toOutput(data, itemIndex));
			} catch (error) {
				const message = `${(error as Error).message}${createdItemId ? ` Draft ${createdItemId} was created. Resume with Draft > Save using this ID instead of creating another draft.` : ''}`;
				if (this.continueOnFail()) {
					output.push({
						json: {
							error: message,
							...(createdItemId ? { item_id: createdItemId, recovery: 'saveExistingDraft' } : {}),
						},
						pairedItem: { item: itemIndex },
					});
					continue;
				}
				throw new NodeOperationError(this.getNode(), message, { itemIndex });
			}
		}
		return [output];
	}
}
