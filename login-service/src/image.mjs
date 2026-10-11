export const MAX_COVER_BYTES = 5 * 1024 * 1024;

export function decodeCover(input) {
	if (
		!input ||
		typeof input.imageBase64 !== 'string' ||
		typeof input.aiGenerated !== 'boolean' ||
		!Number.isFinite(input.timeout) ||
		input.timeout < 1000 ||
		input.timeout > 120000
	)
		throw new Error('Invalid image upload parameters');
	const encoded = input.imageBase64;
	if (
		!encoded ||
		encoded.length > Math.ceil(MAX_COVER_BYTES / 3) * 4 ||
		!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(encoded)
	)
		throw new Error('Invalid or oversized image');
	const buffer = Buffer.from(encoded, 'base64');
	if (buffer.length > MAX_COVER_BYTES || buffer.toString('base64') !== encoded)
		throw new Error('Invalid image encoding');
	let mimeType,
		width = 0,
		height = 0;
	if (
		buffer.length >= 45 &&
		buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) &&
		buffer.readUInt32BE(8) === 13 &&
		buffer.toString('ascii', 12, 16) === 'IHDR' &&
		buffer.subarray(-8, -4).toString('ascii') === 'IEND'
	) {
		mimeType = 'image/png';
		width = buffer.readUInt32BE(16);
		height = buffer.readUInt32BE(20);
	} else if (
		buffer.length >= 12 &&
		buffer.readUInt16BE(0) === 0xffd8 &&
		buffer.readUInt16BE(buffer.length - 2) === 0xffd9
	) {
		mimeType = 'image/jpeg';
		let offset = 2;
		while (offset + 4 <= buffer.length) {
			if (buffer[offset++] !== 0xff) break;
			while (buffer[offset] === 0xff) offset++;
			const marker = buffer[offset++];
			if (marker === 0xda || marker === 0xd9) break;
			if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
			if (offset + 2 > buffer.length) break;
			const length = buffer.readUInt16BE(offset);
			if (length < 2 || offset + length > buffer.length) break;
			if (
				[0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(
					marker,
				) &&
				length >= 8
			) {
				height = buffer.readUInt16BE(offset + 3);
				width = buffer.readUInt16BE(offset + 5);
				break;
			}
			offset += length;
		}
	} else throw new Error('Only complete PNG and JPEG images are supported');
	if (!width || !height || width > 16000 || height > 16000 || width * height > 40000000)
		throw new Error('Invalid image dimensions');
	return { buffer, mimeType, fileName: mimeType === 'image/png' ? 'cover.png' : 'cover.jpg' };
}
