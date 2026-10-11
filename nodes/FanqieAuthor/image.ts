import { randomBytes } from 'node:crypto';
import type { IExecuteFunctions } from 'n8n-workflow';

export const MAX_COVER_BYTES = 5 * 1024 * 1024;
export const COVER_PATH = '/api/author/data/upload_pic_v2/v0/';
export interface CoverUpload {
	buffer: Buffer;
	mimeType: 'image/png' | 'image/jpeg';
	fileName: string;
	width: number;
	height: number;
	aiGenerated: boolean;
}

export function inspectCover(buffer: Buffer): Omit<CoverUpload, 'aiGenerated'> {
	if (!buffer.length || buffer.length > MAX_COVER_BYTES)
		throw new Error('Cover images must contain data and be no larger than 5 MiB');
	let width = 0;
	let height = 0;
	let mimeType: CoverUpload['mimeType'];
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
	} else
		throw new Error('Cover data must be a complete PNG or JPEG image, not a URL or another format');
	if (!width || !height || width > 16000 || height > 16000 || width * height > 40000000)
		throw new Error('The image dimensions are invalid or exceed 40 megapixels');
	return {
		buffer,
		mimeType,
		fileName: mimeType === 'image/png' ? 'cover.png' : 'cover.jpg',
		width,
		height,
	};
}

export function decodeCoverBase64(value: string): Buffer {
	const encoded = value.replace(/^data:image\/(?:png|jpeg);base64,/, '').replace(/\s/g, '');
	if (
		!encoded ||
		encoded.length > Math.ceil(MAX_COVER_BYTES / 3) * 4 ||
		!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(encoded)
	)
		throw new Error('Image Base64 must contain a PNG or JPEG of at most 5 MiB');
	const buffer = Buffer.from(encoded, 'base64');
	if (buffer.toString('base64') !== encoded) throw new Error('Image Base64 is not valid');
	return buffer;
}

export async function readCover(context: IExecuteFunctions, index: number): Promise<CoverUpload> {
	const source = String(context.getNodeParameter('coverSource', index, 'binary'));
	const buffer =
		source === 'binary'
			? await context.helpers.getBinaryDataBuffer(
					index,
					String(context.getNodeParameter('binaryPropertyName', index, 'data')),
				)
			: source === 'base64'
				? decodeCoverBase64(String(context.getNodeParameter('imageBase64', index, '')))
				: undefined;
	if (!buffer) throw new Error('Choose Binary Data or Base64 as the image source');
	const imageOrigin = String(context.getNodeParameter('imageOrigin', index, 'ai'));
	if (!['ai', 'original'].includes(imageOrigin))
		throw new Error('Choose whether the image is AI-generated');
	return { ...inspectCover(buffer), aiGenerated: imageOrigin === 'ai' };
}

export function coverQuery(aiGenerated: boolean): Record<string, string | number> {
	return {
		aid: 2503,
		app_name: 'muye_novel',
		blind_watermark: aiGenerated ? 'ai_cover' : '',
		watermark: aiGenerated ? 'true' : 'false',
		ai_label: aiGenerated ? '1' : '',
	};
}

export function multipartCover(cover: CoverUpload): { body: Buffer; contentType: string } {
	let boundary: string;
	do {
		boundary = `----n8n-fanqie-${randomBytes(18).toString('hex')}`;
	} while (cover.buffer.includes(boundary));
	return {
		contentType: `multipart/form-data; boundary=${boundary}`,
		body: Buffer.concat([
			Buffer.from(
				`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${cover.fileName}"\r\nContent-Type: ${cover.mimeType}\r\n\r\n`,
			),
			cover.buffer,
			Buffer.from(`\r\n--${boundary}--\r\n`),
		]),
	};
}
