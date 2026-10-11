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
	documentationUrl = 'https://github.com/ravflow/n8n-nodes-fanqie/blob/main/docs/CREDENTIALS.md';
	httpRequestNode = {
		name: 'Fanqie Author',
		docsUrl: 'https://github.com/ravflow/n8n-nodes-fanqie/blob/main/docs/CREDENTIALS.md',
		apiBaseUrl: 'https://fanqienovel.com',
	};

	properties: INodeProperties[] = [
		{
			displayName:
				'先在番茄作者后台登录。按 F12 → Network（网络）→ Fetch/XHR，刷新页面，打开成功的 /api/author/ 请求，在 Headers → Request Headers（请求标头）复制下面三个值。<a href="https://github.com/ravflow/n8n-nodes-fanqie/blob/main/docs/CREDENTIALS.md" target="_blank" rel="noopener noreferrer">查看中文填写教程</a>',
			name: 'sessionHelp',
			type: 'notice',
			default: '',
		},
		{
			displayName: 'Cookie',
			name: 'cookieToken',
			type: 'string',
			typeOptions: { password: true },
			required: true,
			default: '',
			placeholder: 'cookie_name_1=你的值; cookie_name_2=你的值',
			description:
				'从已登录作者后台请求的 Request Headers 复制完整 cookie 值，只填值，不含 Cookie: 前缀；多个条目用分号分隔，不要只复制某一个 Cookie',
		},
		{
			displayName: 'CSRF Token',
			name: 'csrfToken',
			type: 'string',
			typeOptions: { password: true },
			required: true,
			default: '',
			placeholder: '粘贴 x-secsdk-csrf-token 的完整值',
			description:
				'从同一登录会话的 Request Headers 复制 x-secsdk-csrf-token 完整值，只填值，不含请求头名称；不要用 passport_csrf_token Cookie 代替',
		},
		{
			displayName: 'User Agent',
			name: 'userAgent',
			type: 'string',
			default:
				'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36',
			description:
				'优先粘贴同一请求的 user-agent 完整值（通常以 Mozilla/5.0 开头）；只填值，不含 User-Agent: 前缀，预设默认值不是自动读取的浏览器信息',
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
						'番茄未接受此登录态。请重新登录作者后台，从新的成功请求中更新完整 Cookie、x-secsdk-csrf-token 和 user-agent；若仍失败，请参照凭据填写教程排查',
				},
			},
		],
	};
}
