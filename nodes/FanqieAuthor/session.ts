import type { IDataObject } from 'n8n-workflow';

export function browserSession(credentials: IDataObject): {
	cookie: string;
	csrf: string;
	userAgent: string;
} {
	const token = credentials.oauthTokenData;
	if (!token || typeof token !== 'object' || Array.isArray(token))
		throw new Error('Open the Fanqie Author Browser Login credential and connect your account.');
	const data = token as IDataObject;
	const cookie = String(data.fanqie_cookie ?? '');
	const csrf = String(data.fanqie_csrf ?? '');
	const userAgent = String(data.fanqie_user_agent ?? '');
	if (!cookie || !csrf || !userAgent)
		throw new Error('The author session is incomplete. Reconnect through your login service.');
	if (
		[cookie, csrf, userAgent].some(
			(value) => /[\r\n]/.test(value) || value.includes(String.fromCharCode(0)),
		)
	)
		throw new Error('The login service returned invalid session headers. Reconnect your account.');
	return { cookie, csrf, userAgent };
}

export function sessionHeaders(session: ReturnType<typeof browserSession>): Record<string, string> {
	return {
		Cookie: session.cookie,
		'X-Secsdk-Csrf-Token': session.csrf,
		'User-Agent': session.userAgent,
		Origin: 'https://fanqienovel.com',
		Referer: 'https://fanqienovel.com/main/writer/',
	};
}
