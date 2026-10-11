import type { ICredentialType, INodeProperties, Icon } from 'n8n-workflow';

export class FanqieAuthorOAuth2Api implements ICredentialType {
	name = 'fanqieAuthorOAuth2Api';
	displayName = 'Fanqie Author Browser Login OAuth2 API';
	extends = ['oAuth2Api'];
	icon: Icon = {
		light: 'file:../nodes/FanqieAuthor/fanqie.svg',
		dark: 'file:../nodes/FanqieAuthor/fanqie.dark.svg',
	};
	documentationUrl = 'https://github.com/ravflow/n8n-nodes-fanqie/blob/main/docs/BROWSER_LOGIN.md';
	testedBy = 'testBrowserLogin';
	properties: INodeProperties[] = [
		{
			displayName:
				'Connect through your own Fanqie login service. Complete the website login in the window that opens. Your n8n administrator supplies the service URL and client credentials.',
			name: 'browserLoginNotice',
			type: 'notice',
			default: '',
		},
		{
			displayName: 'Login Service URL',
			name: 'loginServiceUrl',
			type: 'string',
			default: '',
			placeholder: 'https://fanqie-login.example.com',
			required: true,
			description: 'The URL of your self-hosted login service, accessible by your browser and n8n',
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
