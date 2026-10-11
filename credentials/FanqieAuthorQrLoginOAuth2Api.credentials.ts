import type { ICredentialType, INodeProperties, Icon } from 'n8n-workflow';

export class FanqieAuthorQrLoginOAuth2Api implements ICredentialType {
	name = 'fanqieAuthorQrLoginOAuth2Api';
	displayName = '番茄作者 · 扫码登录（Fanqie） OAuth2 API';
	extends = ['oAuth2Api'];
	icon: Icon = {
		light: 'file:../nodes/FanqieAuthor/fanqie.svg',
		dark: 'file:../nodes/FanqieAuthor/fanqie.dark.svg',
	};
	documentationUrl = 'https://github.com/ravflow/n8n-nodes-fanqie/blob/main/docs/QR_LOGIN.md';
	testedBy = 'testQrConnection';
	properties: INodeProperties[] = [
		{
			displayName:
				'点击连接按钮，用手机上的番茄小说或番茄作家助手扫码确认，随后自动返回 n8n。登录态由管理员部署的组件加密保存。如果仍显示服务地址或 Client Secret 等设置，请联系管理员完成一次性配置。<a href="https://github.com/ravflow/n8n-nodes-fanqie/blob/main/docs/QR_LOGIN.md" target="_blank" rel="noopener noreferrer">查看扫码连接教程</a>',
			name: 'qrLoginHelp',
			type: 'notice',
			default: '',
		},
		{
			displayName: 'Login Service URL',
			name: 'loginServiceUrl',
			type: 'string',
			default: '',
			required: true,
			placeholder: 'https://fanqie-login.example.com',
			description: '管理员部署的扫码组件地址，浏览器和 n8n 均须能访问；公网使用 HTTPS',
		},
		{ displayName: 'Grant Type', name: 'grantType', type: 'hidden', default: 'authorizationCode' },
		{ displayName: 'Use PKCE', name: 'usePkce', type: 'hidden', default: true },
		{
			displayName: 'Authorization URL',
			name: 'authUrl',
			type: 'hidden',
			default: '={{$self["loginServiceUrl"].replace(/\\/$/, "") + "/oauth/authorize"}}',
			required: true,
		},
		{
			displayName: 'Access Token URL',
			name: 'accessTokenUrl',
			type: 'hidden',
			default: '={{$self["loginServiceUrl"].replace(/\\/$/, "") + "/oauth/token"}}',
			required: true,
		},
		{ displayName: 'Scope', name: 'scope', type: 'hidden', default: '' },
		{
			displayName: 'Auth URI Query Parameters',
			name: 'authQueryParameters',
			type: 'hidden',
			default: '',
		},
		{ displayName: 'Authentication', name: 'authentication', type: 'hidden', default: 'body' },
	];
}
