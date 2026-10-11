const root = location.pathname.replace(/\/$/, '');
const status = document.querySelector('#status');
const screen = document.querySelector('#screen');
const keyboard = document.querySelector('#keyboard');
const completeButton = document.querySelector('#complete');
let stopped = false;
let connecting = false;
let composing = false;
let imageUrl;
let queue = Promise.resolve();

async function api(action, data) {
	const response = await fetch(`${root}/${action}`, {
		method: data === undefined ? 'GET' : 'POST',
		credentials: 'same-origin',
		cache: 'no-store',
		redirect: 'error',
		headers:
			data === undefined ? {} : { 'Content-Type': 'application/json', 'X-Fanqie-Connect': '1' },
		body: data === undefined ? undefined : JSON.stringify(data),
		signal: AbortSignal.timeout(20_000),
	});
	const result = await response.json();
	if (!response.ok) {
		if (response.status === 401) stopped = true;
		throw new Error(result.message ?? '连接暂时不可用，请回到 n8n 重新连接。');
	}
	return result;
}

function input(event) {
	if (stopped || connecting) return;
	queue = queue
		.catch(() => {})
		.then(() => api('input', event))
		.catch(() => {
			status.textContent = '输入未送达，请稍后重试。';
		});
}

async function connect() {
	if (connecting || stopped) return;
	connecting = true;
	completeButton.disabled = true;
	status.textContent = '正在连接账号…';
	try {
		const result = await api('complete', {});
		stopped = true;
		status.textContent = '登录成功，正在返回 n8n…';
		if (imageUrl) URL.revokeObjectURL(imageUrl);
		location.replace(result.redirect);
	} catch (error) {
		status.textContent = error.message;
		connecting = false;
		completeButton.disabled = false;
	}
}

async function tick() {
	if (stopped) return;
	try {
		const result = await api('status');
		if (result.phase === 'failed') {
			stopped = true;
			status.textContent = '番茄登录页面未能打开，请回到 n8n 重新连接。';
		} else if (result.phase === 'ready' || result.phase === 'authorized') {
			await connect();
		} else if (result.phase === 'redeemed') {
			stopped = true;
			status.textContent = '账号已连接，请关闭此窗口并返回 n8n。';
		} else if (result.phase === 'login') {
			if (!connecting) status.textContent = '请在下方官网页面登录番茄账号。';
			const response = await fetch(`${root}/screen`, {
				credentials: 'same-origin',
				cache: 'no-store',
				signal: AbortSignal.timeout(15_000),
			});
			if (response.ok) {
				const nextImageUrl = URL.createObjectURL(await response.blob());
				screen.onload = () => {
					if (imageUrl) URL.revokeObjectURL(imageUrl);
					imageUrl = nextImageUrl;
					document.querySelector('#loading').hidden = true;
				};
				screen.src = nextImageUrl;
			}
		}
	} catch (error) {
		status.textContent = error.message;
	}
	if (!stopped) setTimeout(tick, 1200);
}

let pointerDown = false;
let lastMove = 0;
function coordinates(event) {
	const rect = screen.getBoundingClientRect();
	return {
		x: Math.max(0, Math.min(1079, ((event.clientX - rect.left) / rect.width) * 1080)),
		y: Math.max(0, Math.min(779, ((event.clientY - rect.top) / rect.height) * 780)),
	};
}
screen.addEventListener('pointerdown', (event) => {
	event.preventDefault();
	pointerDown = true;
	screen.setPointerCapture(event.pointerId);
	keyboard.focus({ preventScroll: true });
	input({ type: 'down', ...coordinates(event) });
});
screen.addEventListener('pointermove', (event) => {
	if (pointerDown && Date.now() - lastMove > 40) {
		lastMove = Date.now();
		input({ type: 'move', ...coordinates(event) });
	}
});
function release(event) {
	if (!pointerDown) return;
	pointerDown = false;
	input({ type: 'up', ...coordinates(event) });
}
screen.addEventListener('pointerup', release);
screen.addEventListener('pointercancel', release);
screen.addEventListener('contextmenu', (event) => event.preventDefault());
screen.addEventListener(
	'wheel',
	(event) => {
		event.preventDefault();
		input({
			type: 'wheel',
			x: Math.max(-2000, Math.min(2000, event.deltaX)),
			y: Math.max(-2000, Math.min(2000, event.deltaY)),
		});
	},
	{ passive: false },
);
keyboard.addEventListener('compositionstart', () => {
	composing = true;
});
function insertText() {
	if (composing || !keyboard.value) return;
	input({ type: 'text', value: keyboard.value });
	keyboard.value = '';
}
keyboard.addEventListener('compositionend', () => {
	composing = false;
	insertText();
});
keyboard.addEventListener('input', insertText);
keyboard.addEventListener('keydown', (event) => {
	if (event.isComposing) return;
	const controls = [
		'Backspace',
		'Delete',
		'Tab',
		'Enter',
		'Escape',
		'ArrowLeft',
		'ArrowRight',
		'ArrowUp',
		'ArrowDown',
		'Home',
		'End',
	];
	if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'a') {
		event.preventDefault();
		input({ type: 'key', key: event.metaKey ? 'Meta+A' : 'Control+A' });
	} else if (controls.includes(event.key)) {
		event.preventDefault();
		input({ type: 'key', key: event.key });
	}
});
completeButton.addEventListener('click', connect);
document.querySelector('#reload').addEventListener('click', () => input({ type: 'reload' }));
document.querySelector('#cancel').addEventListener('click', async () => {
	try {
		await api('cancel', {});
		stopped = true;
		status.textContent = '已取消连接，可以关闭此窗口。';
		window.close();
	} catch (error) {
		status.textContent = error.message;
	}
});
tick();
