import { inflateSync } from 'node:zlib';
import { z } from 'zod';

const entity = z
	.object({
		entity_number: z.number().int().positive(),
		name: z.string().min(1).max(200),
		position: z.object({ x: z.number().finite(), y: z.number().finite() })
	})
	.passthrough();
const blueprint = z
	.object({
		version: z.number().int().positive(),
		entities: z.array(entity).max(1000).default([]),
		tiles: z
			.array(
				z.object({
					name: z.string().min(1).max(200),
					position: z.object({ x: z.number().finite(), y: z.number().finite() })
				})
			)
			.max(16384)
			.optional()
	})
	.passthrough()
	.refine((value) => value.entities.length + (value.tiles?.length ?? 0) > 0, 'Empty blueprint');

export function blueprintImageData(encoded: string) {
	if (!/^0[A-Za-z0-9+/=]+$/u.test(encoded) || encoded.length > 256000)
		throw new Error('Invalid blueprint string');
	const decoded: unknown = JSON.parse(
		inflateSync(Buffer.from(encoded.slice(1), 'base64'), { maxOutputLength: 1024 * 1024 }).toString(
			'utf8'
		)
	);
	const parsed = z.object({ blueprint }).parse(decoded).blueprint;
	const positions = [...parsed.entities, ...(parsed.tiles ?? [])].map((item) => item.position);
	const xs = positions.map((p) => p.x);
	const ys = positions.map((p) => p.y);
	// Outpost routes can span 512 tiles; the renderer still caps the PNG at 1536 pixels.
	if (Math.max(...xs) - Math.min(...xs) > 512 || Math.max(...ys) - Math.min(...ys) > 512)
		throw new Error('The layout is too large to render; select a smaller area');
	// Titles and inventory icons do not change the rendered world layout.
	delete parsed.label;
	delete parsed.label_color;
	delete parsed.description;
	delete parsed.icons;
	return parsed;
}

export function pngDimensions(png: Buffer) {
	if (
		png.length < 24 ||
		png.length > 8 * 1024 * 1024 ||
		!png.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
	)
		throw new Error('Invalid rendered PNG');
	const width = png.readUInt32BE(16);
	const height = png.readUInt32BE(20);
	if (width < 1 || height < 1 || width > 1536 || height > 1536)
		throw new Error('Rendered image exceeds the size limit');
	return { width, height };
}
