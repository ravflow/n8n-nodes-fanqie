import { LoginError } from './errors.mjs';
import { validateSession } from './vault.mjs';

export const AUTHOR_ORIGIN = 'https://fanqienovel.com';
export const ACCOUNT_PATH = '/api/author/account/info/v0/';
export const ACCOUNT_QUERY = 'aid=2503&app_name=muye_novel';

export function validateAuthorRequest(input) {
	if (
		!input ||
		typeof input !== 'object' ||
		Array.isArray(input) ||
		typeof input.path !== 'string' ||
		input.path.length > 500 ||
		!/^\/api\/author\/[A-Za-z0-9_/-]+$/.test(input.path) ||
		input.path.includes('//') ||
		!['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].includes(input.method) ||
		typeof input.query !== 'string' ||
		input.query.length > 512000 ||
		(input.body !== undefined && (typeof input.body !== 'string' || input.body.length > 2000000)) ||
		(input.method === 'GET' && input.body) ||
		!Number.isFinite(input.timeout) ||
		input.timeout < 1000 ||
		input.timeout > 120000
	) {
		throw new LoginError(400, 'invalid_author_request', '请求仅支持番茄作者接口及合法的表单参数。');
	}
	return input;
}

function cookiesFor(session, url, now) {
	if (!session.cookies) return session.cookie;
	return session.cookies
		.filter(
			(cookie) =>
				(cookie.expires === undefined || cookie.expires <= 0 || cookie.expires > now / 1000) &&
				(url.pathname === cookie.path ||
					url.pathname.startsWith(cookie.path.endsWith('/') ? cookie.path : `${cookie.path}/`)),
		)
		.sort((a, b) => b.path.length - a.path.length)
		.map((cookie) => `${cookie.name}=${cookie.value}`)
		.join('; ');
}

async function boundedText(response) {
	const reader = response.body?.getReader();
	if (!reader) return '';
	let size = 0;
	const chunks = [];
	try {
		for (;;) {
			const { done, value } = await reader.read();
			if (done) break;
			size += value.byteLength;
			if (size > 8 * 1024 * 1024)
				throw new LoginError(502, 'response_too_large', '作者接口响应超过 8 MiB，请缩小查询范围。');
			chunks.push(Buffer.from(value));
		}
		return Buffer.concat(chunks).toString('utf8');
	} finally {
		await reader.cancel().catch(() => {});
	}
}

export function validAccount(body) {
	return Boolean(
		body &&
			Number(body.code) === 0 &&
			body.data &&
			typeof body.data === 'object' &&
			!Array.isArray(body.data) &&
			Object.keys(body.data).length,
	);
}

export async function requestAuthor(session, input, fetcher = fetch) {
	validateSession(session);
	validateAuthorRequest(input);
	const url = new URL(input.path, AUTHOR_ORIGIN);
	url.search = input.query;
	const cookie = cookiesFor(session, url, Date.now());
	if (!cookie)
		throw new LoginError(401, 'website_session_expired', '番茄登录态已过期，请重新扫码。');
	let response;
	let body;
	try {
		response = await fetcher(url, {
			method: input.method,
			redirect: 'manual',
			signal: AbortSignal.timeout(input.timeout),
			headers: {
				Accept: 'application/json, text/plain, */*',
				Cookie: cookie,
				'X-Secsdk-Csrf-Token': session.csrf,
				'User-Agent': session.userAgent,
				Origin: AUTHOR_ORIGIN,
				Referer: `${AUTHOR_ORIGIN}/main/writer/`,
				...(input.method === 'GET'
					? {}
					: { 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8' }),
			},
			...(input.method === 'GET' ? {} : { body: input.body ?? '' }),
		});
		body = await boundedText(response);
	} catch (error) {
		if (error instanceof LoginError) throw error;
		throw new LoginError(
			502,
			'upstream_unavailable',
			input.method === 'GET'
				? '暂时无法访问番茄作者接口，请稍后重试。'
				: '作者接口未返回确定结果，请先检查后台，避免重复提交。',
		);
	}
	// Keep the response as text, preserving long author/book/chapter IDs exactly.
	// Session headers are never returned to n8n, including in business errors.
	for (const secret of [
		cookie,
		session.csrf,
		...cookie
			.split(';')
			.map((item) => item.slice(item.indexOf('=') + 1).trim())
			.filter((value) => value.length >= 8),
	])
		if (secret) body = body.split(secret).join('[redacted]');
	const headers = {};
	for (const name of [
		'content-type',
		'bdturing-verify',
		'x-muye-encrypt-downgrade',
		'x-muye-encrypt-key',
	])
		if (response.headers.has(name)) headers[name] = response.headers.get(name);
	return { statusCode: response.status, headers, body };
}
