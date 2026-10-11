import { randomBytes, createHash, createCipheriv, createDecipheriv } from 'node:crypto';
import { mkdir, readFile, writeFile, rename, unlink, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { LoginError } from './errors.mjs';

export const digest = (value) => createHash('sha256').update(String(value)).digest('base64url');
export const randomToken = () => randomBytes(32).toString('base64url');

export function validateSession(session) {
	if (
		!session ||
		['cookie', 'csrf', 'userAgent'].some(
			(key) =>
				typeof session[key] !== 'string' ||
				!session[key] ||
				session[key].length > 65536 ||
				/[\r\n\0]/.test(session[key]),
		)
	) {
		throw new LoginError(409, 'incomplete_session', '尚未取得完整作者登录态，请重新扫码。');
	}
	if (
		session.cookies !== undefined &&
		(!Array.isArray(session.cookies) ||
			session.cookies.length > 150 ||
			session.cookies.some(
				(cookie) =>
					!cookie ||
					typeof cookie.name !== 'string' ||
					typeof cookie.value !== 'string' ||
					!/^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/.test(cookie.name) ||
					/[;\r\n\0]/.test(cookie.value) ||
					!['fanqienovel.com', '.fanqienovel.com'].includes(cookie.domain) ||
					typeof cookie.path !== 'string' ||
					!cookie.path.startsWith('/') ||
					(cookie.expires !== undefined && !Number.isFinite(cookie.expires)),
			))
	) {
		throw new LoginError(409, 'incomplete_session', '作者 Cookie 格式异常，请重新扫码。');
	}
	return session;
}

export class SessionVault {
	constructor(directory, encodedKey, ttlMs = 30 * 24 * 3600000, now = Date.now) {
		if (
			!/^[A-Za-z0-9+/]{43}=$/.test(encodedKey ?? '') ||
			Buffer.from(encodedKey, 'base64').length !== 32
		)
			throw new Error('SESSION_ENCRYPTION_KEY must be 32 random bytes encoded as base64.');
		if (!Number.isFinite(ttlMs) || ttlMs < 3600000 || ttlMs > 90 * 24 * 3600000)
			throw new Error('Session retention must be between 1 hour and 90 days.');
		this.directory = directory;
		this.key = Buffer.from(encodedKey, 'base64');
		this.ttlMs = ttlMs;
		this.now = now;
	}

	async init() {
		await mkdir(this.directory, { recursive: true, mode: 0o700 });
		// A changed encryption key must fail explicitly rather than discard saved sessions.
		for (const name of await readdir(this.directory)) {
			if (/^[A-Za-z0-9_-]{43}\.json$/.test(name)) await this.readRecord(name.slice(0, -5));
		}
	}

	async readRecord(hash) {
		const envelope = JSON.parse(await readFile(join(this.directory, `${hash}.json`), 'utf8'));
		if (envelope.v !== 1) throw new Error('Unsupported session vault format.');
		const decrypt = createDecipheriv('aes-256-gcm', this.key, Buffer.from(envelope.iv, 'base64'));
		decrypt.setAAD(Buffer.from(hash));
		decrypt.setAuthTag(Buffer.from(envelope.tag, 'base64'));
		const decoded = Buffer.concat([
			decrypt.update(Buffer.from(envelope.data, 'base64')),
			decrypt.final(),
		]);
		const record = JSON.parse(decoded.toString('utf8'));
		validateSession(record.session);
		if (!Number.isFinite(record.expiresAt)) throw new Error('Invalid session vault record.');
		return record;
	}

	async issue(session) {
		validateSession(session);
		const token = randomToken();
		const hash = digest(token);
		const iv = randomBytes(12);
		const cipher = createCipheriv('aes-256-gcm', this.key, iv);
		cipher.setAAD(Buffer.from(hash));
		const expiresAt = this.now() + this.ttlMs;
		const data = Buffer.concat([
			cipher.update(JSON.stringify({ session, expiresAt }), 'utf8'),
			cipher.final(),
		]);
		const envelope = JSON.stringify({
			v: 1,
			iv: iv.toString('base64'),
			tag: cipher.getAuthTag().toString('base64'),
			data: data.toString('base64'),
		});
		const temporary = join(this.directory, `.${hash}.tmp`);
		try {
			await writeFile(temporary, envelope, { mode: 0o600, flag: 'wx' });
			await rename(temporary, join(this.directory, `${hash}.json`));
		} finally {
			await unlink(temporary).catch((error) => {
				if (error.code !== 'ENOENT') throw error;
			});
		}
		return { token, expiresAt };
	}

	async get(token) {
		if (!/^[A-Za-z0-9_-]{43}$/.test(token ?? ''))
			throw new LoginError(401, 'invalid_token', '请在 n8n 中重新连接番茄账号。');
		let record;
		try {
			record = await this.readRecord(digest(token));
		} catch (error) {
			if (error.code === 'ENOENT')
				throw new LoginError(401, 'invalid_token', '连接已撤销，请重新扫码。');
			throw new LoginError(
				503,
				'vault_unavailable',
				'无法读取已保存的登录态，请联系管理员检查加密密钥。',
			);
		}
		if (record.expiresAt <= this.now()) {
			await this.revoke(token);
			throw new LoginError(401, 'expired_token', '连接已过期，请重新扫码。');
		}
		return record.session;
	}

	async revoke(token) {
		if (!/^[A-Za-z0-9_-]{43}$/.test(token ?? ''))
			throw new LoginError(401, 'invalid_token', '无效连接。');
		await unlink(join(this.directory, `${digest(token)}.json`)).catch((error) => {
			if (error.code !== 'ENOENT') throw error;
		});
	}

	async sweep() {
		for (const name of await readdir(this.directory)) {
			if (!/^[A-Za-z0-9_-]{43}\.json$/.test(name)) continue;
			const hash = name.slice(0, -5);
			const record = await this.readRecord(hash);
			if (record.expiresAt <= this.now()) await unlink(join(this.directory, name));
		}
	}
}
