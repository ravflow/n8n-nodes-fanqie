import { LoginError } from './broker.mjs';

export const VIEWPORT = { width: 1080, height: 780 };
const ORIGIN = 'https://fanqienovel.com';
const ACCOUNT = `${ORIGIN}/api/author/account/info/v0/?aid=2503&app_name=muye_novel`;
const allowedDomains = [
	'fanqienovel.com',
	'bytedance.com',
	'bytegoofy.com',
	'bytetos.com',
	'byteimg.com',
	'bytednsdoc.com',
	'bytedns.net',
	'bytedns.com',
	'bytecdn.cn',
	'pstatp.com',
	'snssdk.com',
	'zijieapi.com',
	'toutiao.com',
	'douyin.com',
	'ibytedtos.com',
];

export function allowedBrowserUrl(value) {
	try {
		const url = new URL(value);
		return (
			['https:', 'wss:'].includes(url.protocol) &&
			!url.username &&
			!url.password &&
			allowedDomains.some(
				(domain) => url.hostname === domain || url.hostname.endsWith(`.${domain}`),
			)
		);
	} catch {
		return false;
	}
}

export function validateInput(event) {
	if (!event || typeof event !== 'object')
		throw new LoginError(400, 'invalid_input', 'Invalid input.');
	if (['down', 'move', 'up', 'click'].includes(event.type)) {
		if (
			!Number.isFinite(event.x) ||
			!Number.isFinite(event.y) ||
			event.x < 0 ||
			event.x >= VIEWPORT.width ||
			event.y < 0 ||
			event.y >= VIEWPORT.height
		)
			throw new LoginError(400, 'invalid_input', 'Pointer is outside the login window.');
	} else if (event.type === 'text') {
		if (typeof event.value !== 'string' || !event.value || event.value.length > 2000)
			throw new LoginError(400, 'invalid_input', 'Invalid text input.');
	} else if (event.type === 'key') {
		if (
			![
				'Backspace',
				'Delete',
				'Tab',
				'Enter',
				'Escape',
				'ArrowLeft',
				'ArrowRight',
				'ArrowUp',
				'ArrowDown',
				'Home',
				'End',
				'Control+A',
				'Meta+A',
			].includes(event.key)
		)
			throw new LoginError(400, 'invalid_input', 'Unsupported key.');
	} else if (event.type === 'wheel') {
		if (![event.x, event.y].every((value) => Number.isFinite(value) && Math.abs(value) <= 2000))
			throw new LoginError(400, 'invalid_input', 'Invalid scroll input.');
	} else if (event.type !== 'reload')
		throw new LoginError(400, 'invalid_input', 'Unsupported input.');
	return event;
}

const validAccount = (body) =>
	body &&
	Number(body.code) === 0 &&
	body.data &&
	typeof body.data === 'object' &&
	!Array.isArray(body.data) &&
	Object.keys(body.data).length > 0;

export async function createBrowserFactory() {
	const { chromium } = await import('playwright');
	const browser = await chromium.launch({ headless: true });
	const factory = async () => {
		const context = await browser.newContext({
			viewport: VIEWPORT,
			locale: 'zh-CN',
			timezoneId: 'Asia/Shanghai',
			acceptDownloads: false,
			serviceWorkers: 'block',
		});
		let candidate = null;
		let authenticated = false;
		let capture = Promise.resolve();
		let closed = false;
		let inputQueue = Promise.resolve();
		await context.route('**/*', (route) => {
			if (allowedBrowserUrl(route.request().url())) return route.continue();
			return route.abort();
		});
		await context.routeWebSocket('**/*', (socket) => {
			if (allowedBrowserUrl(socket.url())) socket.connectToServer();
			else socket.close();
		});
		context.on('request', (request) => {
			const url = new URL(request.url());
			if (url.origin !== ORIGIN || !url.pathname.startsWith('/api/author/')) return;
			capture = capture
				.then(async () => {
					if (closed) return;
					const headers = await request.allHeaders();
					if (headers.cookie && headers['x-secsdk-csrf-token'] && headers['user-agent']) {
						candidate = {
							cookie: headers.cookie,
							csrf: headers['x-secsdk-csrf-token'],
							userAgent: headers['user-agent'],
						};
					}
				})
				.catch(() => {});
		});
		context.on('response', (response) => {
			const url = new URL(response.url());
			if (url.origin !== ORIGIN || !url.pathname.startsWith('/api/author/account/info/')) return;
			capture = capture
				.then(async () => {
					if (closed) return;
					authenticated = response.status() === 200 && validAccount(await response.json());
				})
				.catch(() => {
					authenticated = false;
				});
		});
		const page = await context.newPage();
		page.setDefaultTimeout(15_000);
		try {
			await page.goto(`${ORIGIN}/main/writer/`, { waitUntil: 'domcontentloaded', timeout: 45_000 });
		} catch (error) {
			await context.close();
			throw error;
		}
		const isReady = () =>
			authenticated &&
			candidate &&
			/(?:^|;\s*)(?:sessionid(?:_ss)?|sid_tt)=[^;]+/.test(candidate.cookie);
		return {
			isReady: () => Boolean(isReady()),
			screenshot: () => page.screenshot({ type: 'jpeg', quality: 78, timeout: 10_000 }),
			input: async (value) => {
				const event = validateInput(value);
				const next = inputQueue
					.catch(() => {})
					.then(async () => {
						if (closed) throw new LoginError(409, 'closed', 'The login window has closed.');
						if (['down', 'move', 'up', 'click'].includes(event.type)) {
							await page.mouse.move(event.x, event.y);
							if (event.type === 'down') await page.mouse.down();
							if (event.type === 'up') await page.mouse.up();
							if (event.type === 'click') await page.mouse.click(event.x, event.y);
						} else if (event.type === 'text') await page.keyboard.insertText(event.value);
						else if (event.type === 'key') await page.keyboard.press(event.key);
						else if (event.type === 'wheel') await page.mouse.wheel(event.x, event.y);
						else if (event.type === 'reload') await page.reload({ waitUntil: 'domcontentloaded' });
					});
				inputQueue = next;
				return next;
			},
			session: async () => {
				await capture;
				if (!isReady()) {
					const csrf = candidate?.csrf ?? '';
					const accepted = await page.evaluate(
						async ({ url, csrfToken }) => {
							try {
								const response = await fetch(url, {
									credentials: 'include',
									redirect: 'error',
									headers: csrfToken ? { 'X-Secsdk-Csrf-Token': csrfToken } : {},
									signal: AbortSignal.timeout(15_000),
								});
								const body = await response.json();
								return (
									response.ok &&
									Number(body.code) === 0 &&
									body.data &&
									typeof body.data === 'object' &&
									Object.keys(body.data).length > 0
								);
							} catch {
								return false;
							}
						},
						{ url: ACCOUNT, csrfToken: csrf },
					);
					await capture;
					authenticated = Boolean(accepted);
				}
				if (!isReady())
					throw new LoginError(409, 'login_required', '请先完成番茄登录、作者权限开通及网站验证。');
				// Read only cookies that the browser would send to this exact author endpoint.
				const cookies = await context.cookies(ACCOUNT);
				const cookie = cookies
					.sort((a, b) => b.path.length - a.path.length)
					.map((item) => `${item.name}=${item.value}`)
					.join('; ');
				return { ...candidate, cookie };
			},
			close: async () => {
				closed = true;
				candidate = null;
				authenticated = false;
				await context.close();
			},
		};
	};
	factory.close = () => browser.close();
	return factory;
}
