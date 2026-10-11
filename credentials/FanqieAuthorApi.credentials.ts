import type {
	IAuthenticateGeneric,
	ICredentialTestRequest,
	ICredentialType,
	INodeProperties,
	Icon,
} from 'n8n-workflow';

export class FanqieAuthorApi implements ICredentialType {
	name = 'fanqieAuthorApi';
	displayName = 'Fanqie Author Session API';
	icon: Icon = {
		light: 'file:../nodes/FanqieAuthor/fanqie.svg',
		dark: 'file:../nodes/FanqieAuthor/fanqie.dark.svg',
	};
	documentationUrl = 'https://fanqienovel.com/main/writer/';
	httpRequestNode = {
		name: 'Fanqie Author',
		docsUrl: 'https://fanqienovel.com/main/writer/',
		apiBaseUrl: 'https://fanqienovel.com',
	};

	properties: INodeProperties[] = [
		{
			displayName: 'Cookie',
			name: 'cookieToken',
			type: 'string',
			typeOptions: { password: true },
			required: true,
			default: '',
			description: 'The Cookie header from your own signed-in author workspace request',
		},
		{
			displayName: 'CSRF Token',
			name: 'csrfToken',
			type: 'string',
			typeOptions: { password: true },
			required: true,
			default: '',
			description: 'The X-Secsdk-Csrf-Token header from the same author workspace session',
		},
		{
			displayName: 'User Agent',
			name: 'userAgent',
			type: 'string',
			default:
				'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36',
			description: 'Use the User-Agent from the browser that created the session',
		},
		{
			displayName: 'Allowed HTTP Request Domains',
			name: 'allowedHttpRequestDomains',
			type: 'hidden',
			default: 'domains',
		},
		{
			displayName: 'Allowed Domains',
			name: 'allowedDomains',
			type: 'hidden',
			default: 'fanqienovel.com',
		},
	];

	authenticate: IAuthenticateGeneric = {
		type: 'generic',
		properties: {
			headers: {
				Cookie: '={{$credentials.cookieToken}}',
				'X-Secsdk-Csrf-Token': '={{$credentials.csrfToken}}',
				'User-Agent': '={{$credentials.userAgent}}',
				Origin: 'https://fanqienovel.com',
				Referer: 'https://fanqienovel.com/main/writer/',
			},
		},
	};

	test: ICredentialTestRequest = {
		request: {
			baseURL: 'https://fanqienovel.com',
			url: '/api/author/account/info/v0/',
			method: 'GET',
			qs: { aid: 2503, app_name: 'muye_novel' },
			disableFollowRedirect: true,
		},
		rules: [
			{
				type: 'responseSuccessBody',
				properties: {
					key: 'code',
					value: 0,
					message:
						'The session was not accepted by the author workspace. Check the Cookie and CSRF token.',
				},
			},
		],
	};
}
