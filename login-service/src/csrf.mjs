// The official SecSDK obtains CSRF through a credentialed HEAD handshake.
// Never substitute a passport cookie or accept its DOWNGRADE sentinel.
export async function readOfficialCsrf(page, authorPath) {
	const token = await page.evaluate(async (path) => {
		const csrf = window.secsdk?.csrf;
		if (
			typeof csrf?.fetchTokenFromServer !== 'function' ||
			typeof csrf?.getTokenPath !== 'function'
		)
			return null;
		const result = await csrf.fetchTokenFromServer(
			location.host,
			csrf.getTokenPath(location.host, path),
		);
		return result ? { value: result.value, expiresAt: result.expiredAt } : null;
	}, authorPath);
	if (
		!token ||
		typeof token.value !== 'string' ||
		!token.value ||
		token.value === 'DOWNGRADE' ||
		token.value.length > 65536 ||
		/[\r\n\0]/.test(token.value) ||
		!Number.isFinite(token.expiresAt) ||
		token.expiresAt <= Date.now()
	)
		return null;
	return token;
}
