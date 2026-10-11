import { LoginError } from './errors.mjs';
import { readOfficialCsrf } from './csrf.mjs';
import {
	AUTHOR_ORIGIN,
	ACCOUNT_PATH,
	ACCOUNT_QUERY,
	requestAuthor,
	validAccount,
} from './author.mjs';

const LOGIN_URL = `${AUTHOR_ORIGIN}/main/writer/login?enter_from=author_zone`;
const QR_SELECTOR = '.slogin-qrcode-scan-page__content__code';
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

export async function createQrBrowserFactory() {
	const { chromium } = await import('playwright');
	const browser = await chromium.launch({ headless: true });
	const factory = async () => {
		const context = await browser.newContext({
			viewport: { width: 1080, height: 800 },
			deviceScaleFactor: 2,
			locale: 'zh-CN',
			timezoneId: 'Asia/Shanghai',
			acceptDownloads: false,
			serviceWorkers: 'block',
		});
		let candidate = null;
		let authenticated = false;
		let authenticatedAt = 0;
		let capture = Promise.resolve();
		let closed = false;
		let refreshing = null;
		let verified = null;
		let csrfCapture = null;
		let csrfRetryAt = 0;
		await context.route('**/*', (route) =>
			allowedBrowserUrl(route.request().url()) ? route.continue() : route.abort(),
		);
		await context.routeWebSocket('**/*', (socket) => {
			if (allowedBrowserUrl(socket.url())) socket.connectToServer();
			else socket.close();
		});
		context.on('request', (request) => {
			const url = new URL(request.url());
			if (url.origin !== AUTHOR_ORIGIN || !url.pathname.startsWith('/api/author/')) return;
			capture = capture
				.then(async () => {
					if (closed) return;
					const headers = await request.allHeaders();
					if (headers.cookie && headers['user-agent'])
						candidate = {
							cookie: headers.cookie,
							csrf: headers['x-secsdk-csrf-token'] ?? candidate?.csrf ?? '',
							userAgent: headers['user-agent'],
						};
				})
				.catch(() => {});
		});
		context.on('response', (response) => {
			const url = new URL(response.url());
			if (
				url.origin !== AUTHOR_ORIGIN ||
				url.pathname !== ACCOUNT_PATH ||
				response.request().method() !== 'GET'
			)
				return;
			capture = capture
				.then(async () => {
					if (closed) return;
					authenticated = response.status() === 200 && validAccount(await response.json());
					if (authenticated && !authenticatedAt) authenticatedAt = Date.now();
				})
				.catch(() => {
					authenticated = false;
				});
		});
		const page = await context.newPage();
		page.setDefaultTimeout(10000);
		const loadQr = async () => {
			candidate = null;
			authenticated = false;
			authenticatedAt = 0;
			verified = null;
			csrfRetryAt = 0;
			await page.goto(LOGIN_URL, { waitUntil: 'domcontentloaded', timeout: 45000 });
			await page.getByText('扫码登录', { exact: true }).click({ timeout: 30000 });
			await page.locator(`${QR_SELECTOR} img`).waitFor({ state: 'visible', timeout: 30000 });
			await page.locator(`${QR_SELECTOR} img`).evaluate(
				(image) =>
					image.complete ||
					new Promise((resolve, reject) => {
						image.addEventListener('load', resolve, { once: true });
						image.addEventListener('error', reject, { once: true });
					}),
			);
		};
		try {
			await loadQr();
		} catch (error) {
			await context.close();
			throw error;
		}
		const ready = () =>
			authenticated &&
			candidate?.csrf &&
			/(?:^|;\s*)(?:sessionid(?:_ss)?|sid_tt)=[^;]+/.test(candidate.cookie);
		return {
			status: async () => {
				await capture;
				if (closed) return 'failed';
				if (refreshing) return 'starting';
				if (authenticated && candidate && !candidate.csrf && Date.now() >= csrfRetryAt) {
					if (!csrfCapture) csrfCapture = readOfficialCsrf(page, ACCOUNT_PATH).catch(() => null);
					const token = await csrfCapture;
					await capture;
					if (token && candidate)
						candidate = { ...candidate, csrf: token.value, csrfExpiresAt: token.expiresAt };
					csrfRetryAt = Date.now() + 15000;
					csrfCapture = null;
				}
				if (ready()) return 'ready';
				if (authenticated)
					return Date.now() - authenticatedAt > 20000 ? 'incomplete_session' : 'capturing';
				const text = await page.locator('body').innerText({ timeout: 2000 });
				if (/二维码.{0,10}(?:失效|过期)|(?:失效|过期).{0,10}二维码/.test(text)) return 'qr_expired';
				if (/扫描成功|扫码成功|已扫码|已扫描|手机.{0,8}确认|请.{0,8}确认登录/.test(text))
					return 'scanned';
				if (/拖动.{0,15}滑块|完成.{0,10}验证|安全验证|访问过于频繁|访问太频繁/.test(text))
					return 'verification_required';
				if (await page.locator(QR_SELECTOR).isVisible()) return 'waiting';
				return 'capturing';
			},
			qr: () => page.locator(QR_SELECTOR).screenshot({ type: 'png', timeout: 10000 }),
			refresh: async () => {
				if (refreshing) return refreshing;
				refreshing = loadQr();
				try {
					await refreshing;
				} finally {
					refreshing = null;
				}
			},
			session: async () => {
				await capture;
				if (!ready())
					throw new LoginError(409, 'login_required', '请扫码确认登录，并等待作者账号检查完成。');
				if (!verified) {
					const cookies = (await context.cookies()).filter((cookie) =>
						['fanqienovel.com', '.fanqienovel.com'].includes(cookie.domain),
					);
					const session = { ...candidate, cookies };
					const result = await requestAuthor(session, {
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
							'author_check_failed',
							'扫码已完成，但作者接口尚未接受此登录态，请重新连接。',
						);
					verified = session;
				}
				return verified;
			},
			close: async () => {
				closed = true;
				candidate = null;
				authenticated = false;
				verified = null;
				await context.close();
			},
		};
	};
	factory.close = () => browser.close();
	return factory;
}
