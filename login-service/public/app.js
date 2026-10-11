const base = location.pathname.replace(/\/$/, '');
const qr = document.querySelector('#qr');
const placeholder = document.querySelector('#qr-placeholder');
const status = document.querySelector('#status');
const refresh = document.querySelector('#refresh');
const retry = document.querySelector('#retry');
const cancel = document.querySelector('#cancel');
let stopped = false;
let completing = false;
let qrLoaded = false;
let imageUrl;
let timer;

function show(message, error = false) {
	status.textContent = message;
	status.classList.toggle('error', error);
}
async function api(operation, post = false) {
	const response = await fetch(`${base}/${operation}`, {
		credentials: 'same-origin',
		cache: 'no-store',
		...(post
			? {
					method: 'POST',
					headers: { 'Content-Type': 'application/json', 'X-Fanqie-Connect': '1' },
					body: '{}',
				}
			: {}),
	});
	const result = await response.json();
	if (!response.ok) throw new Error(result.message || '连接暂时不可用，请从 n8n 重新连接。');
	return result;
}
async function loadQr() {
	const response = await fetch(`${base}/qr`, { credentials: 'same-origin', cache: 'no-store' });
	if (!response.ok) throw new Error('二维码加载失败，请刷新重试。');
	if (imageUrl) URL.revokeObjectURL(imageUrl);
	imageUrl = URL.createObjectURL(await response.blob());
	qr.src = imageUrl;
	qr.hidden = false;
	placeholder.hidden = true;
	qrLoaded = true;
}
async function complete() {
	if (completing || stopped) return;
	completing = true;
	retry.hidden = true;
	show('扫码已确认，正在验证作者接口并绑定 n8n…');
	try {
		const result = await api('complete', true);
		stopped = true;
		show('账号检查通过，正在返回 n8n…');
		location.replace(result.redirect);
	} catch (error) {
		stopped = true;
		show(error.message, true);
		retry.hidden = false;
	} finally {
		completing = false;
	}
}
async function poll() {
	if (stopped) return;
	try {
		const result = await api('status');
		if (result.phase === 'ready') {
			await complete();
			return;
		}
		if (result.phase === 'failed') {
			show('暂时无法打开番茄官方扫码页，请从 n8n 重新连接。', true);
			stopped = true;
			return;
		}
		if (result.phase === 'verification_required') {
			show('番茄要求额外验证，本次扫码未能完成。请检查手机提示或重新连接。', true);
			refresh.hidden = false;
			stopped = true;
			return;
		}
		if (result.phase === 'incomplete_session') {
			show('已登录，但尚未取得完整作者凭据。请刷新后重新扫码；仍失败时联系管理员。', true);
			refresh.hidden = false;
			stopped = true;
			return;
		}
		if (result.phase === 'qr_expired') {
			show('二维码已过期，请刷新后再次扫码。');
			refresh.hidden = false;
			stopped = true;
			return;
		}
		if (result.phase === 'scanned') show('已扫码，请在手机上确认登录…');
		else if (result.phase === 'capturing') show('正在获取作者登录态，请稍候…');
		else if (result.phase === 'waiting') {
			if (!qrLoaded) await loadQr();
			show('等待扫码：使用番茄小说或番茄作家助手。');
			refresh.hidden = false;
		}
		timer = setTimeout(poll, 1600);
	} catch (error) {
		show(error.message, true);
		stopped = true;
		refresh.hidden = false;
	}
}
refresh.addEventListener('click', async () => {
	clearTimeout(timer);
	stopped = true;
	refresh.disabled = true;
	show('正在刷新官方二维码…');
	try {
		await api('refresh', true);
		qrLoaded = false;
		retry.hidden = true;
		stopped = false;
		await poll();
	} catch (error) {
		show(error.message, true);
	} finally {
		refresh.disabled = false;
	}
});
retry.addEventListener('click', () => {
	stopped = false;
	void complete();
});
cancel.addEventListener('click', async () => {
	stopped = true;
	clearTimeout(timer);
	cancel.disabled = true;
	try {
		await api('cancel', true);
		qr.hidden = true;
		placeholder.hidden = false;
		placeholder.textContent = '连接已取消';
		show('可以关闭此页面，返回 n8n。');
		refresh.hidden = true;
		retry.hidden = true;
	} catch (error) {
		show(error.message, true);
		cancel.disabled = false;
	}
});
window.addEventListener('pagehide', () => {
	clearTimeout(timer);
	if (imageUrl) URL.revokeObjectURL(imageUrl);
});
void poll();
