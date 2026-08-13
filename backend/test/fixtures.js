import { deflateSync } from "node:zlib";

function crc32(buffer) {
	let crc = 0xffffffff;
	for (const byte of buffer) {
		crc ^= byte;
		for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
	}
	return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
	const type_buffer = Buffer.from(type, "ascii");
	const length = Buffer.alloc(4);
	length.writeUInt32BE(data.length);
	const checksum = Buffer.alloc(4);
	checksum.writeUInt32BE(crc32(Buffer.concat([type_buffer, data])));
	return Buffer.concat([length, type_buffer, data, checksum]);
}

export function createPng(width = 1, height = 1) {
	const header = Buffer.alloc(13);
	header.writeUInt32BE(width, 0);
	header.writeUInt32BE(height, 4);
	header.set([8, 6, 0, 0, 0], 8);
	const rows = Buffer.alloc((width * 4 + 1) * height);
	return Buffer.concat([
		Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
		pngChunk("IHDR", header),
		pngChunk("IDAT", deflateSync(rows)),
		pngChunk("IEND", Buffer.alloc(0)),
	]);
}

export function createGif(frame_count = 1, width = 1, height = 1) {
	const header = Buffer.alloc(13);
	header.write("GIF89a", 0, "ascii");
	header.writeUInt16LE(width, 6);
	header.writeUInt16LE(height, 8);
	header[10] = 0x80;
	const palette = Buffer.from([0, 0, 0, 255, 255, 255]);
	const frames = [];
	for (let frame = 0; frame < frame_count; frame++) {
		const descriptor = Buffer.alloc(10);
		descriptor[0] = 0x2c;
		descriptor.writeUInt16LE(width, 5);
		descriptor.writeUInt16LE(height, 7);
		if (width !== 1 || height !== 1) throw new RangeError("The test GIF helper currently supports 1×1 frames only.");
		frames.push(descriptor, Buffer.from([2, 2, 0x4c, 0x01, 0]));
	}
	return Buffer.concat([header, palette, ...frames, Buffer.from([0x3b])]);
}

export function createPepepaintGif(width = 20, height = 20, frame_count = 1) {
	const clear_code = 256;
	const end_code = 257;
	const codes = [clear_code];
	for (let pixel = 0; pixel < width * height; pixel++) {
		codes.push(0);
		if ((pixel + 1) % 250 === 0 && pixel < width * height - 1) codes.push(clear_code);
	}
	codes.push(end_code);

	const compressed = [];
	let bit_buffer = 0;
	let bit_count = 0;
	for (const code of codes) {
		bit_buffer += code * 2 ** bit_count;
		bit_count += 9;
		while (bit_count >= 8) {
			compressed.push(bit_buffer % 256);
			bit_buffer = Math.floor(bit_buffer / 256);
			bit_count -= 8;
		}
	}
	if (bit_count > 0) compressed.push(bit_buffer & 0xff);

	const sub_blocks = [];
	for (let offset = 0; offset < compressed.length; offset += 255) {
		const block = compressed.slice(offset, offset + 255);
		sub_blocks.push(Buffer.from([block.length, ...block]));
	}

	const header = Buffer.alloc(13);
	header.write("GIF89a", 0, "ascii");
	header.writeUInt16LE(width, 6);
	header.writeUInt16LE(height, 8);
	header[10] = 0xf7;
	const palette = Buffer.alloc(256 * 3);
	const descriptor = Buffer.alloc(10);
	descriptor[0] = 0x2c;
	descriptor.writeUInt16LE(width, 5);
	descriptor.writeUInt16LE(height, 7);
	const loop_extension = Buffer.from([0x21, 0xff, 0x0b, ...Buffer.from("NETSCAPE2.0", "ascii"), 3, 1, 0, 0, 0]);
	const frames = [];
	for (let frame = 0; frame < frame_count; frame++) {
		frames.push(Buffer.from([0x21, 0xf9, 4, 0, 2, 0, 0, 0]), descriptor, Buffer.from([8]), ...sub_blocks, Buffer.from([0]));
	}
	return Buffer.concat([header, palette, loop_extension, ...frames, Buffer.from([0x3b])]);
}
