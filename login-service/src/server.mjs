import { LoginBroker } from './broker.mjs';
import { createBrowserFactory } from './browser.mjs';
import { createLoginServer } from './http.mjs';

const factory = await createBrowserFactory();
const broker = new LoginBroker(
	{
		publicUrl: process.env.PUBLIC_URL,
		clientId: process.env.CLIENT_ID,
		clientSecret: process.env.CLIENT_SECRET,
		redirectUris: (process.env.REDIRECT_URIS ?? '')
			.split(',')
			.map((url) => url.trim())
			.filter(Boolean),
		allowInsecureHttp: process.env.ALLOW_INSECURE_HTTP === 'true',
	},
	factory,
);
const server = createLoginServer(broker);
server.requestTimeout = 60_000;
server.headersTimeout = 15_000;
const cleanup = setInterval(() => {
	void broker.sweep().catch(() => {});
}, 30_000);
cleanup.unref();
server.listen(Number(process.env.PORT ?? 8789), '0.0.0.0', () => {
	console.log('Fanqie login service ready. No request, session, or input logging is enabled.');
});
const shutdown = async () => {
	clearInterval(cleanup);
	server.close();
	await broker.close();
	await factory.close();
	process.exit(0);
};
process.once('SIGTERM', shutdown);
process.once('SIGINT', shutdown);
