import { NodeApiError, NodeOperationError, sleep } from 'n8n-workflow';
import type {
	IDataObject,
	IExecuteFunctions,
	ILoadOptionsFunctions,
	IHttpRequestOptions,
} from 'n8n-workflow';
import type { Endpoint, Operation, RequestSettings } from './types';
import { qrConnection } from './qrConnection';

type Context = IExecuteFunctions | ILoadOptionsFunctions;
export const API_ORIGIN = 'https://fanqienovel.com';
const forbiddenKeys = new Set(['__proto__', 'prototype', 'constructor']);

export function parseLosslessJson(text: string): unknown {
	const transformed = text.replace(
		/("(?:\\.|[^"\\])*")|(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)/g,
		(token, stringToken: string | undefined) => {
			if (stringToken || !/^-?\d+$/.test(token)) return token;
			return Number.isSafeInteger(Number(token)) ? token : JSON.stringify(token);
		},
	);
	return JSON.parse(transformed) as unknown;
}

export function parseObject(value: unknown, label: string): IDataObject {
	let object: unknown;
	try {
		object = typeof value === 'string' ? parseLosslessJson(value || '{}') : value;
	} catch {
		object = undefined;
	}
	if (!object || typeof object !== 'object' || Array.isArray(object))
		throw new Error(`${label} must be a JSON object`);
	validateObject(object);
	return object as IDataObject;
}

function validateObject(value: unknown): void {
	if (typeof value === 'number' && Number.isInteger(value) && !Number.isSafeInteger(value))
		throw new Error('An integer exceeds JavaScript precision. Pass long IDs as strings.');
	if (Array.isArray(value)) {
		for (const item of value) validateObject(item);
		return;
	}
	if (value && typeof value === 'object') {
		for (const [key, item] of Object.entries(value)) {
			if (forbiddenKeys.has(key)) throw new Error(`Unsupported parameter key: ${key}`);
			validateObject(item);
		}
	}
}

export function assertAuthorPath(path: string): void {
	if (
		!/^\/(?:api\/(?:author|node|user)\/|reading\/msgapi\/)[A-Za-z0-9_/-]+$/.test(path) ||
		path.includes('//')
	) {
		throw new Error(
			'Use an author API path on fanqienovel.com. Put query parameters in Parameters, not in the path.',
		);
	}
}

export function formEncode(data: IDataObject): string {
	const pairs: string[] = [];
	function append(key: string, value: unknown): void {
		if (value === undefined) return;
		if (value === null) {
			pairs.push(`${encodeURIComponent(key)}=`);
			return;
		}
		if (Array.isArray(value)) {
			value.forEach((item, index) => append(`${key}[${index}]`, item));
			return;
		}
		if (typeof value === 'object') {
			for (const [child, item] of Object.entries(value)) append(`${key}[${child}]`, item);
			return;
		}
		pairs.push(`${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`);
	}
	for (const [key, value] of Object.entries(data)) append(key, value);
	return pairs.join('&');
}

export function toChapterHtml(content: string, format: string): string {
	if (!content.trim()) throw new Error('Chapter content must not be empty');
	if (format === 'html') return content;
	return content
		.replace(/\r\n?/g, '\n')
		.split('\n')
		.map(
			(line) =>
				`<p>${line.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;')}</p>`,
		)
		.join('');
}

export function toUnixSeconds(value: unknown): number {
	if (typeof value === 'number' || (typeof value === 'string' && /^\d+$/.test(value))) {
		const number = Number(value);
		if (!Number.isSafeInteger(number) || number < 0)
			throw new Error(
				'Publication time must be a positive Unix timestamp or an ISO date with timezone',
			);
		return number > 100000000000 ? Math.floor(number / 1000) : number;
	}
	if (typeof value !== 'string' || !/(?:Z|[+-]\d{2}:\d{2})$/i.test(value))
		throw new Error(
			'Include a timezone in publication time, for example 2026-10-12T08:00:00+08:00',
		);
	const parsed = Date.parse(value);
	if (!Number.isFinite(parsed)) throw new Error('Publication time is not a valid date');
	return Math.floor(parsed / 1000);
}

export function buildPublishPayload(
	params: IDataObject,
	recipe: Operation['recipe'],
	format: string,
	aiUsage?: unknown,
): IDataObject {
	const payload: IDataObject = { ...params };
	const isDraft = recipe === 'saveDraft' || recipe === 'createDraft';
	payload.content = toChapterHtml(String(params.content ?? ''), format);
	payload.title = String(params.title ?? '')
		.replace(/\s+/g, ' ')
		.replace(/</g, '＜')
		.replace(/>/g, '＞')
		.trim();
	payload.publish_status = isDraft ? 0 : 1;
	payload.timer_status = recipe === 'schedule' ? 1 : 0;
	payload.timer_time = recipe === 'schedule' ? toUnixSeconds(params.timer_time) : '';
	payload.need_pay = payload.need_pay ?? 0;
	payload.device_platform = 'pc';
	if (!isDraft) {
		if (![1, 2].includes(Number(aiUsage)))
			throw new Error('Choose whether AI was used to create this chapter');
		payload.use_ai = Number(aiUsage);
		payload.speak_type = payload.speak_type ?? 0;
		payload.timer_chapter_preview = payload.timer_chapter_preview ?? '[]';
	}
	if (recipe === 'schedule' && Number(payload.timer_time) <= Math.floor(Date.now() / 1000))
		throw new Error('Scheduled publication time must be in the future');
	return payload;
}

export function validateRequired(params: IDataObject, fields: string[] = []): void {
	for (const field of fields) {
		const value = params[field];
		if (value === undefined || value === null || (typeof value === 'string' && !value.trim()))
			throw new Error(`Missing required parameter: ${field}`);
		if (field.endsWith('_id') && typeof value === 'number' && !Number.isSafeInteger(value))
			throw new Error(`Pass ${field} as a string to preserve all digits`);
	}
	if (
		params.start_date !== undefined &&
		params.end_date !== undefined &&
		String(params.start_date) > String(params.end_date)
	)
		throw new Error('Start date must be before or equal to end date');
}

function safeMessage(value: unknown, secrets: string[]): string {
	let message = String(value ?? 'The author API rejected this request');
	for (const secret of secrets) if (secret) message = message.split(secret).join('[redacted]');
	return message
		.replace(/(?:cookie|csrf|sessionid|token)\s*[:=]\s*[^\s,;]+/gi, '[redacted]')
		.slice(0, 350);
}

export function decodeResponse(
	body: unknown,
	headers: Record<string, unknown>,
	secrets: string[] = [],
): IDataObject {
	const lowerHeaders = Object.fromEntries(
		Object.entries(headers).map(([key, value]) => [key.toLowerCase(), value]),
	);
	if (lowerHeaders['bdturing-verify'])
		throw new Error(
			'The author workspace requires browser verification. Complete it in your browser and update the session.',
		);
	if (
		String(lowerHeaders['x-muye-encrypt-downgrade'] ?? '') === '0' ||
		lowerHeaders['x-muye-encrypt-key']
	)
		throw new Error(
			'The income API returned an encrypted response. Browser protocol adaptation is required for this session; no income data was decoded.',
		);
	let response: unknown = body;
	if (typeof body === 'string') {
		if (!body.trim())
			throw new Error(
				'The author API returned an empty response. Check the session and complete any browser verification.',
			);
		try {
			response = parseLosslessJson(body);
		} catch {
			response = undefined;
		}
	}
	if (!response || typeof response !== 'object' || Array.isArray(response))
		throw new Error('Unexpected author API response format');
	const object = response as IDataObject;
	if (object.code === undefined)
		throw new Error('The response does not include an author API status code');
	if (Number(object.code) !== 0) {
		const message = safeMessage(object.message ?? object.msg, secrets);
		throw new Error(`Fanqie API code ${String(object.code)}: ${message}`);
	}
	if (typeof object.data === 'string' && /(?:income|encrypt)/i.test(String(object.message ?? '')))
		throw new Error('The API returned encoded income data that has not been decoded');
	return object;
}

export async function authorRequest(
	context: Context,
	endpoint: Pick<Endpoint, 'path' | 'method'>,
	params: IDataObject,
	settings: RequestSettings,
	itemIndex = 0,
): Promise<IDataObject> {
	assertAuthorPath(endpoint.path);
	validateObject(params);
	const defaultAuthentication = context.getNode().typeVersion < 1.1 ? 'session' : 'qrLogin';
	const authentication =
		'getInputData' in context
			? String(context.getNodeParameter('authentication', itemIndex, defaultAuthentication))
			: String(context.getCurrentNodeParameter('authentication') ?? defaultAuthentication);
	if (!['session', 'qrLogin'].includes(authentication))
		throw new Error('Choose a supported authentication method');
	const credentialName =
		authentication === 'qrLogin' ? 'fanqieAuthorQrLoginOAuth2Api' : 'fanqieAuthorApi';
	const credentials = await context.getCredentials(credentialName);
	const connection = authentication === 'qrLogin' ? qrConnection(credentials) : undefined;
	const secrets = connection
		? [connection.accessToken, String(credentials.clientSecret ?? '')]
		: [String(credentials.cookieToken ?? ''), String(credentials.csrfToken ?? '')];
	const data: IDataObject = { aid: 2503, app_name: 'muye_novel', ...params };
	const options: IHttpRequestOptions = {
		url: `${API_ORIGIN}${endpoint.path}`,
		method: endpoint.method,
		timeout: settings.timeout,
		returnFullResponse: true,
		disableFollowRedirect: true,
		json: false,
		encoding: 'text',
		sendCredentialsOnCrossOriginRedirect: false,
		headers: { Accept: 'application/json, text/plain, */*' },
	};
	if (endpoint.method === 'GET') options.qs = data;
	else {
		options.qs = { aid: 2503, app_name: 'muye_novel' };
		options.body = formEncode(data);
		options.headers = {
			...options.headers,
			'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8',
		};
	}
	const retryableRead =
		endpoint.method === 'GET' &&
		!/\/(?:delete|new|add|create|publish|modify|set|apply|agree|vote|handle|close|remove|accept|cancel|take|receive|post|save|update|operate)(?:_|\/)/i.test(
			endpoint.path,
		);
	for (let attempt = 0; ; attempt++) {
		let response: { body: unknown; headers: Record<string, unknown>; statusCode: number };
		try {
			if (connection) {
				const bridge = (await context.helpers.httpRequestWithAuthentication.call(
					context,
					credentialName,
					{
						url: `${connection.origin}/api/author-request`,
						method: 'POST',
						body: {
							path: endpoint.path,
							method: endpoint.method,
							query: formEncode(options.qs as IDataObject),
							...(endpoint.method === 'GET' ? {} : { body: String(options.body) }),
							timeout: settings.timeout,
						},
						json: true,
						returnFullResponse: true,
						disableFollowRedirect: true,
						sendCredentialsOnCrossOriginRedirect: false,
						timeout: Math.min(settings.timeout + 5000, 125000),
					},
				)) as {
					statusCode: number;
					body: { statusCode: number; body: string; headers: Record<string, unknown> };
				};
				if (
					bridge.statusCode !== 200 ||
					!bridge.body ||
					!Number.isInteger(bridge.body.statusCode) ||
					typeof bridge.body.body !== 'string' ||
					!bridge.body.headers ||
					typeof bridge.body.headers !== 'object'
				)
					throw new Error('Invalid login-service response');
				response = bridge.body;
			} else {
				response = (await context.helpers.httpRequestWithAuthentication.call(
					context,
					credentialName,
					options,
				)) as typeof response;
			}
		} catch (error) {
			const object = error as {
				statusCode?: number;
				httpCode?: string;
				response?: { status?: number };
				code?: string;
				cause?: { code?: string };
			};
			const status = Number(object.statusCode ?? object.httpCode ?? object.response?.status ?? 0);
			const transient =
				[429, 502, 503, 504].includes(status) ||
				['ETIMEDOUT', 'ECONNRESET', 'EAI_AGAIN'].includes(
					String(object.code ?? object.cause?.code),
				);
			if (retryableRead && transient && attempt < settings.readRetries) {
				await sleep(500 * 2 ** attempt);
				continue;
			}
			const detail = [401, 403].includes(status)
				? 'Refresh the author session or complete browser verification.'
				: status >= 300 && status < 400
					? 'The request redirected; check the author login session.'
					: endpoint.method !== 'GET'
						? 'The result is unknown. Inspect the workspace before retrying a write.'
						: 'Check connectivity and the author session.';
			throw new NodeApiError(
				context.getNode(),
				{ message: `Fanqie request failed${status ? ` (HTTP ${status})` : ''}. ${detail}` },
				{ itemIndex },
			);
		}
		if (
			retryableRead &&
			[429, 502, 503, 504].includes(response.statusCode) &&
			attempt < settings.readRetries
		) {
			await sleep(500 * 2 ** attempt);
			continue;
		}
		if (response.statusCode < 200 || response.statusCode >= 300)
			throw new NodeApiError(
				context.getNode(),
				{ message: `Unexpected HTTP ${response.statusCode}. Check the author session.` },
				{ itemIndex },
			);
		try {
			return decodeResponse(response.body, response.headers ?? {}, secrets);
		} catch (error) {
			throw new NodeApiError(
				context.getNode(),
				{ message: (error as Error).message },
				{ itemIndex },
			);
		}
	}
}

export function unwrapData(response: IDataObject): unknown {
	return response.data ?? {};
}

export function extractList(data: unknown, keys: string[]): unknown[] {
	if (Array.isArray(data)) return data;
	if (data && typeof data === 'object') {
		for (const key of keys) {
			let candidate: unknown = (data as IDataObject)[key];
			if (typeof candidate === 'string' && candidate.trim().startsWith('[')) {
				try {
					candidate = parseLosslessJson(candidate);
				} catch {
					continue;
				}
			}
			if (Array.isArray(candidate)) return candidate;
		}
	}
	throw new Error(
		'The list response does not match the known schema. Use Advanced API to inspect the response before proceeding.',
	);
}

export async function fetchList(
	context: IExecuteFunctions,
	operation: Operation,
	params: IDataObject,
	settings: RequestSettings,
	itemIndex: number,
	returnAll: boolean,
	limit: number,
	maxPages: number,
): Promise<unknown[]> {
	const results: unknown[] = [];
	const fingerprints = new Set<string>();
	const pageCount = 100;
	for (let page = 0; page < maxPages; page++) {
		const count = returnAll ? pageCount : Math.min(pageCount, limit - results.length);
		const response = await authorRequest(
			context,
			operation,
			{ ...params, page_index: page, page_count: count },
			settings,
			itemIndex,
		);
		const data = unwrapData(response);
		const list = extractList(data, operation.listKeys ?? ['list']);
		if (!list.length) return results;
		const fingerprint = JSON.stringify(list);
		if (fingerprints.has(fingerprint))
			throw new NodeOperationError(
				context.getNode(),
				'The API repeated a page. Pagination stopped to avoid returning duplicate data.',
				{ itemIndex },
			);
		fingerprints.add(fingerprint);
		results.push(...list);
		if (!returnAll && results.length >= limit) return results.slice(0, limit);
		const object =
			data && typeof data === 'object' && !Array.isArray(data) ? (data as IDataObject) : {};
		if (object.has_more === false || object.has_more === 0 || object.has_more === '0')
			return results;
		const total = Number(object.total_count ?? object.total ?? NaN);
		if (Number.isFinite(total) && results.length >= total) return results;
		if (
			list.length < count &&
			object.has_more !== true &&
			object.has_more !== 1 &&
			object.has_more !== '1'
		)
			return results;
	}
	throw new NodeOperationError(
		context.getNode(),
		`Pagination exceeded ${maxPages} pages. Increase Max Pages or narrow the query.`,
		{ itemIndex },
	);
}
