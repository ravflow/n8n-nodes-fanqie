import { LoginBroker } from './broker.mjs';
import { SessionVault } from './vault.mjs';
import { createQrBrowserFactory } from './browser.mjs';
import { createLoginServer } from './http.mjs';

const vault = new SessionVault(
	process.env.DATA_DIR ?? '/app/data',
	process.env.SESSION_ENCRYPTION_KEY,
	Number(process.env.SESSION_TTL_HOURS ?? 720) * 3600000,
);
await vault.init();
const factory = await createQrBrowserFactory();
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
		maxSessions: Number(process.env.MAX_LOGIN_SESSIONS ?? 2),
	},
	factory,
	vault,
);
const server = createLoginServer(broker);
server.requestTimeout = 150000;
server.headersTimeout = 15000;
server.maxHeadersCount = 40;
const cleanup = setInterval(() => {
	void broker.sweep().catch(() => {});
}, 30000);
const vaultCleanup = setInterval(() => {
	void vault.sweep().catch(() => {});
}, 3600000);
cleanup.unref();
vaultCleanup.unref();
server.listen(Number(process.env.PORT ?? 8789), '0.0.0.0', () => {
	console.log('Fanqie QR login service ready.');
});
let closing = false;
const shutdown = async () => {
	if (closing) return;
	closing = true;
	clearInterval(cleanup);
	clearInterval(vaultCleanup);
	server.close();
	await broker.close();
	await factory.close();
	process.exit(0);
};
process.once('SIGTERM', shutdown);
process.once('SIGINT', shutdown);
