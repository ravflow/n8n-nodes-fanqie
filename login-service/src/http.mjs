import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { LoginError } from './broker.mjs';

const assets = {
	'/': ['index.html', 'text/html; charset=utf-8'],
	'/assets/app.js': ['app.js', 'text/javascript; charset=utf-8'],
	'/assets/style.css': ['style.css', 'text/css; charset=utf-8'],
};
const cookieName = (id) => `fq_${id}`;
const readCookie = (req, id) =>
	(req.headers.cookie ?? '')
		.split(';')
		.map((s) => s.trim())
		.find((s) => s.startsWith(`${cookieName(id)}=`))
		?.slice(cookieName(id).length + 1);

async function readBody(req) {
	const chunks = [];
	let size = 0;
	for await (const chunk of req) {
		size += chunk.length;
		if (size > 16_384) throw new LoginError(413, 'too_large', 'Request is too large.');
		chunks.push(chunk);
	}
	return Buffer.concat(chunks).toString('utf8');
}

export function createLoginServer(broker) {
	const rates = new Map();
	function rateLimit(req, label, limit) {
		const key = `${label}:${req.socket.remoteAddress}`;
		const now = Date.now();
		let rate = rates.get(key);
		if (!rate || rate.end <= now) {
			rate = { count: 0, end: now + 60_000 };
			rates.set(key, rate);
		}
		if (++rate.count > limit) throw new LoginError(429, 'rate_limited', 'Please retry shortly.');
		for (const [id, value] of rates) if (value.end <= now) rates.delete(id);
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
			if (req.method === 'GET' && url.pathname === '/oauth/authorize') {
				rateLimit(req, 'authorize', 10);
				const { id, cookie } = await broker.authorize(url.searchParams);
				const secure = broker.config.publicUrl.startsWith('https:') ? '; Secure' : '';
				res.writeHead(302, {
					Location: `/connect/${id}`,
					'Set-Cookie': `${cookieName(id)}=${cookie}; HttpOnly; SameSite=Lax; Path=/connect/${id}; Max-Age=600${secure}`,
				});
				return res.end();
			}
			if (req.method === 'POST' && url.pathname === '/oauth/token') {
				rateLimit(req, 'token', 30);
				if (!String(req.headers['content-type']).startsWith('application/x-www-form-urlencoded'))
					throw new LoginError(415, 'invalid_request', 'Use form-encoded token requests.');
				return json(200, broker.token(new URLSearchParams(await readBody(req))));
			}
			const connect =
				/^\/connect\/([a-f0-9]{32})(?:\/(status|screen|input|complete|cancel))?$/.exec(
					url.pathname,
				);
			if (connect) {
				const [, id, operation] = connect;
				const cookie = readCookie(req, id);
				broker.getFlow(id, cookie);
				if (req.method === 'GET' && !operation) {
					const html = await readFile(new URL('../public/connect.html', import.meta.url));
					res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
					return res.end(html);
				}
				if (req.method === 'GET' && operation === 'status')
					return json(200, await broker.status(id, cookie));
				if (req.method === 'GET' && operation === 'screen') {
					rateLimit(req, `screen-${id}`, 90);
					const screenshot = await broker.screen(id, cookie);
					res.writeHead(200, { 'Content-Type': 'image/jpeg' });
					return res.end(screenshot);
				}
				if (req.method === 'POST' && ['input', 'complete', 'cancel'].includes(operation)) {
					if (
						req.headers.origin !== broker.config.publicUrl ||
						req.headers['x-fanqie-connect'] !== '1'
					)
						throw new LoginError(403, 'invalid_origin', 'Return to the original login window.');
					if (!String(req.headers['content-type']).startsWith('application/json'))
						throw new LoginError(415, 'invalid_request', 'Use JSON input requests.');
					rateLimit(req, `input-${id}`, 1800);
					if (operation === 'complete') return json(200, await broker.complete(id, cookie));
					if (operation === 'cancel') {
						await broker.cancel(id, cookie);
						return json(200, { cancelled: true });
					}
					let event;
					try {
						event = JSON.parse(await readBody(req));
					} catch (error) {
						if (error instanceof LoginError) throw error;
						throw new LoginError(400, 'invalid_input', 'Invalid JSON.');
					}
					await broker.input(id, cookie, event);
					return json(200, { accepted: true });
				}
			}
			if (req.method === 'GET' && assets[url.pathname]) {
				const [file, type] = assets[url.pathname];
				const body = await readFile(new URL(`../public/${file}`, import.meta.url));
				res.writeHead(200, { 'Content-Type': type });
				return res.end(body);
			}
			throw new LoginError(404, 'not_found', 'Page not found.');
		} catch (error) {
			if (!res.headersSent)
				json(error instanceof LoginError ? error.status : 500, {
					error: error instanceof LoginError ? error.code : 'login_error',
					message:
						error instanceof LoginError ? error.message : '登录服务暂时不可用，请从 n8n 重新连接。',
				});
			else res.end();
		}
	});
}
