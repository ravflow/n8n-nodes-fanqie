'use strict';

// Read-only administrator checks. Never prints credential contents or account data.
const { createRequire } = require('node:module');
const directory = process.env.FANQIE_N8N_APP_DIR || '/usr/local/lib/node_modules/n8n';
const appRequire = createRequire(directory + '/package.json');
process.env.NODE_CONFIG_DIR = process.env.NODE_CONFIG_DIR || directory + '/bin/config';
appRequire('reflect-metadata');
appRequire('./dist/config');
process.argv = [process.argv[0], __filename, 'fanqie-inspect-login'];
const { Container } = appRequire('@n8n/di');
const { Command } = appRequire('@n8n/decorators');
const { BaseCommand } = appRequire('./dist/commands/base-command');
const { OauthService } = appRequire('./dist/oauth/oauth.service');
const { CredentialsRepository, UserRepository } = appRequire('@n8n/db');

class InspectFanqieLogin extends BaseCommand {
	needsExpressionEngine = true;
	async run() {
		await this.initLicense();
		const oauth = Container.get(OauthService);
		const owner = await Container.get(UserRepository).findOne({
			where: { role: { slug: 'global:owner' } },
		});
		const result = { callbackUrl: oauth.getBaseUrl(2) + '/callback', ownerId: owner?.id };
		const id = process.env.FANQIE_BROWSER_CREDENTIAL_ID;
		if (id) {
			const credential = await Container.get(CredentialsRepository).findOneByOrFail({
				id,
				type: 'fanqieAuthorOAuth2Api',
			});
			const values = await oauth.getOAuthCredentials(credential);
			const auth = new URL(values.authUrl);
			const token = new URL(values.accessTokenUrl);
			result.credentialId = id;
			result.authorizeEndpoint = auth.origin + auth.pathname;
			result.tokenEndpoint = token.origin + token.pathname;
			result.pkceEnabled = oauth.shouldUsePkce(values);
			result.clientConfigured = Boolean(values.clientId && values.clientSecret);
			result.connected = Boolean(values.oauthTokenData?.fanqie_cookie);
			if (process.env.FANQIE_VALIDATE_NATIVE_AUTH_URI === 'true') {
				const request = { user: owner, headers: {}, cookies: {}, query: { id } };
				const response = { cookie() {} };
				const authUri = new URL(
					await oauth.generateAOauth2AuthUri(
						credential,
						{ cid: id, origin: 'static-credential', userId: owner.id },
						request,
						response,
					),
				);
				result.nativeAuthorizationValidated = authUri.origin === auth.origin;
				result.nativePkceMethod = authUri.searchParams.get('code_challenge_method');
				result.nativeRedirectUri = authUri.searchParams.get('redirect_uri');
			}
		}
		console.log(JSON.stringify(result));
	}
}
Command({
	name: 'fanqie-inspect-login',
	description: 'Inspect Fanqie browser login configuration without secrets',
})(InspectFanqieLogin);
Container.get(appRequire('./dist/command-registry').CommandRegistry)
	.execute()
	.catch(() => {
		console.error('Fanqie browser-login inspection failed.');
		process.exitCode = 1;
	});
