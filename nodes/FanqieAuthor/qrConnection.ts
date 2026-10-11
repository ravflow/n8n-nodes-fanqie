import type { IDataObject } from 'n8n-workflow';

export function loginServiceOrigin(value: unknown): string {
	let url: URL | undefined;
	try {
		url = new URL(String(value ?? ''));
	} catch {
		url = undefined;
	}
	if (!url) throw new Error('Configure a valid Login Service URL in the QR login credential');
	const host = url.hostname;
	const ipv4 =
		/^\d{1,3}(?:\.\d{1,3}){3}$/.test(host) && host.split('.').every((part) => Number(part) <= 255);
	const lan =
		host === 'localhost' ||
		host === '[::1]' ||
		(ipv4 &&
			(/^(?:127|10)\./.test(host) ||
				/^192\.168\./.test(host) ||
				/^172\.(?:1[6-9]|2\d|3[01])\./.test(host)));
	if (
		(url.protocol !== 'https:' && !(url.protocol === 'http:' && lan)) ||
		url.username ||
		url.password ||
		url.search ||
		url.hash ||
		url.pathname !== '/'
	)
		throw new Error(
			'Login Service URL must be an HTTPS origin; HTTP is limited to LAN or loopback',
		);
	return url.origin;
}

export function qrConnection(credentials: IDataObject): { origin: string; accessToken: string } {
	const origin = loginServiceOrigin(credentials.loginServiceUrl);
	const token = credentials.oauthTokenData;
	if (!token || typeof token !== 'object' || Array.isArray(token))
		throw new Error('Open the QR login credential and connect your Fanqie account');
	const accessToken = String((token as IDataObject).access_token ?? '');
	if (!/^[A-Za-z0-9_-]{43}$/.test(accessToken))
		throw new Error('The QR connection token is missing or invalid. Reconnect your account');
	return { origin, accessToken };
}
