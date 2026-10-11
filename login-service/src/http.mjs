import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { LoginError } from './errors.mjs';
import {
	ACCOUNT_PATH,
	ACCOUNT_QUERY,
	requestAuthor,
	requestCoverUpload,
	validAccount,
} from './author.mjs';

const assets = {
	'/': ['index.html', 'text/html; charset=utf-8'],
	'/assets/app.js': ['app.js', 'text/javascript; charset=utf-8'],
	'/assets/style.css': ['style.css', 'text/css; charset=utf-8'],
};
const cookieName = (id) => `fq_${id}`;
const readCookie = (req, id) =>
	(req.headers.cookie ?? '')
		.split(';')
		.map((value) => value.trim())
		.find((value) => value.startsWith(`${cookieName(id)}=`))
		?.slice(cookieName(id).length + 1);
const bearer = (req) => /^Bearer ([A-Za-z0-9_-]{43})$/.exec(req.headers.authorization ?? '')?.[1];

async function readBody(req, maximum = 16384) {
	let size = 0;
	const chunks = [];
	for await (const chunk of req) {
		size += chunk.length;
		if (size > maximum) throw new LoginError(413, 'too_large', '请求内容过大。');
		chunks.push(chunk);
	}
	return Buffer.concat(chunks).toString('utf8');
}

async function readJson(req, maximum) {
	if (!String(req.headers['content-type']).startsWith('application/json'))
		throw new LoginError(415, 'invalid_request', '请使用 JSON 请求。');
	try {
		return JSON.parse(await readBody(req, maximum));
	} catch (error) {
		if (error instanceof LoginError) throw error;
		throw new LoginError(400, 'invalid_request', 'JSON 格式无效。');
	}
}

export function createLoginServer(
	broker,
	authorRequest = requestAuthor,
	coverUpload = requestCoverUpload,
) {
	const rates = new Map();
	function rateLimit(req, label, maximum) {
		const key = `${label}:${req.socket.remoteAddress}`;
		const now = Date.now();
		for (const [name, rate] of rates) if (rate.end <= now) rates.delete(name);
		let rate = rates.get(key);
		if (!rate) {
			rate = { count: 0, end: now + 60000 };
			rates.set(key, rate);
		}
		if (++rate.count > maximum)
			throw new LoginError(429, 'rate_limited', '操作过于频繁，请稍后重试。');
	}
	return createServer(async (req, res) => {
		res.setHeader('Cache-Control', 'no-store');
		res.setHeader('Pragma', 'no-cache');
		res.setHeader('Referrer-Policy', 'no-referrer');
		res.setHeader('X-Content-Type-Options', 'nosniff');
		res.setHeader('X-Frame-Options', 'DENY');
		res.setHeader(
			'Content-Security-Policy',
			"default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' blob:; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'",
		);
		const json = (status, body) => {
			res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
			res.end(JSON.stringify(body));
		};
		try {
			const url = new URL(req.url, broker.config.publicUrl);
			if (req.method === 'GET' && url.pathname === '/health') return json(200, { status: 'ok' });
			if (
				(req.headers.host ?? '').toLowerCase() !==
				new URL(broker.config.publicUrl).host.toLowerCase()
			)
				throw new LoginError(400, 'invalid_host', '请使用管理员配置的连接地址。');
			if (req.method === 'GET' && url.pathname === '/oauth/authorize') {
				rateLimit(req, 'authorize', 10);
				const { id, cookie } = await broker.authorize(url.searchParams);
				const secure = broker.config.publicUrl.startsWith('https:') ? '; Secure' : '';
				res.writeHead(302, {
					Location: `/connect/${id}`,
					'Set-Cookie': `${cookieName(id)}=${cookie}; HttpOnly; SameSite=Lax; Path=/connect/${id}; Max-Age=${Math.ceil(broker.config.flowTtlMs / 1000)}${secure}`,
				});
				return res.end();
			}
			if (req.method === 'POST' && url.pathname === '/oauth/token') {
				rateLimit(req, 'token', 30);
				if (!String(req.headers['content-type']).startsWith('application/x-www-form-urlencoded'))
					throw new LoginError(415, 'invalid_request', '请使用表单格式交换连接码。');
				return json(200, await broker.token(new URLSearchParams(await readBody(req))));
			}
			const connect = /^\/connect\/([a-f0-9]{32})(?:\/(status|qr|refresh|complete|cancel))?$/.exec(
				url.pathname,
			);
			if (connect) {
				const [, id, operation] = connect;
				const cookie = readCookie(req, id);
				broker.getFlow(id, cookie);
				if (req.method === 'GET' && !operation) {
					res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
					return res.end(await readFile(new URL('../public/connect.html', import.meta.url)));
				}
				if (req.method === 'GET' && operation === 'status') {
					rateLimit(req, `status-${id}`, 90);
					return json(200, await broker.status(id, cookie));
				}
				if (req.method === 'GET' && operation === 'qr') {
					rateLimit(req, `qr-${id}`, 15);
					const qr = await broker.qr(id, cookie);
					res.writeHead(200, { 'Content-Type': 'image/png' });
					return res.end(qr);
				}
				if (req.method === 'POST' && ['refresh', 'complete', 'cancel'].includes(operation)) {
					if (
						req.headers.origin !== broker.config.publicUrl ||
						req.headers['x-fanqie-connect'] !== '1'
					)
						throw new LoginError(403, 'invalid_origin', '请回到原来的连接页面继续。');
					await readJson(req);
					rateLimit(req, `action-${id}`, 15);
					if (operation === 'complete') return json(200, await broker.complete(id, cookie));
					if (operation === 'refresh') {
						await broker.refresh(id, cookie);
						return json(200, { refreshed: true });
					}
					await broker.cancel(id, cookie);
					return json(200, { cancelled: true });
				}
			}
			if (url.pathname.startsWith('/api/')) {
				rateLimit(req, 'author', 1200);
				const token = bearer(req);
				const session = await broker.vault.get(token);
				if (req.method === 'POST' && url.pathname === '/api/cover/upload') {
					rateLimit(req, 'cover-upload', 12);
					return json(200, await coverUpload(session, await readJson(req, 7 * 1024 * 1024)));
				}
				if (req.method === 'GET' && url.pathname === '/api/session/check') {
					const result = await authorRequest(session, {
						path: ACCOUNT_PATH,
						method: 'GET',
						query: ACCOUNT_QUERY,
						timeout: 15000,
					});
					let account;
					try {
						account = JSON.parse(result.body);
					} catch {
						account = null;
					}
					if (
						result.statusCode !== 200 ||
						result.headers['bdturing-verify'] ||
						!validAccount(account)
					)
						throw new LoginError(
							409,
							'website_session_expired',
							'番茄作者登录态已失效或需要验证，请重新扫码。',
						);
					return json(200, { connected: true });
				}
				if (req.method === 'POST' && url.pathname === '/api/session/revoke') {
					await readJson(req);
					await broker.vault.revoke(token);
					return json(200, { revoked: true });
				}
				if (req.method === 'POST' && url.pathname === '/api/author-request')
					return json(200, await authorRequest(session, await readJson(req, 2200000)));
			}
			if (req.method === 'GET' && assets[url.pathname]) {
				const [name, type] = assets[url.pathname];
				res.writeHead(200, { 'Content-Type': type });
				return res.end(await readFile(new URL(`../public/${name}`, import.meta.url)));
			}
			throw new LoginError(404, 'not_found', '页面不存在。');
		} catch (error) {
			if (!res.headersSent)
				json(error instanceof LoginError ? error.status : 500, {
					error: error instanceof LoginError ? error.code : 'service_unavailable',
					message:
						error instanceof LoginError
							? error.message
							: '登录组件暂时不可用，请稍后从 n8n 重新连接。',
				});
			else res.end();
		}
	});
}
