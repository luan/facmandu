import { z } from 'zod';

export const factoryImageReferenceSchema = z.object({
	id: z.string().regex(/^[a-f0-9]{64}$/)
});
export const factoryImageSchema = factoryImageReferenceSchema.extend({
	width: z.number().int().min(1).max(1536),
	height: z.number().int().min(1).max(1536)
});
export type FactoryImage = z.infer<typeof factoryImageSchema>;
export const factoryImagePendingSchema = factoryImageReferenceSchema.extend({
	pending: z.literal(true)
});
export const factoryViewRequestSchema = z.strictObject({
	force: z.string().min(1).max(200),
	surface: z.string().min(1).max(200),
	position: z.strictObject({
		x: z.number().min(-1000000).max(1000000),
		y: z.number().min(-1000000).max(1000000)
	}),
	width: z.number().int().min(4).max(96).default(32),
	height: z.number().int().min(4).max(96).default(32)
});
export type FactoryViewRequest = z.infer<typeof factoryViewRequestSchema>;
export const factoryViewSchema = z.object({
	kind: z.literal('factory-view'),
	force: z.string(),
	surface: z.string(),
	tick: z.number().int().nonnegative(),
	area: z.object({
		left_top: z.object({ x: z.number(), y: z.number() }),
		right_bottom: z.object({ x: z.number(), y: z.number() })
	}),
	origin: z.object({ x: z.number(), y: z.number() }),
	count: z.number().int().positive().max(1000),
	image: factoryImageSchema
});
export const factoryPreviewPendingSchema = factoryViewSchema.omit({ image: true }).extend({
	kind: z.literal('factory-preview-pending'),
	image: factoryImageReferenceSchema
});
export const factoryImageUrl = (
	serverId: string,
	image: z.infer<typeof factoryImageReferenceSchema>
) => `/api/servers/${encodeURIComponent(serverId)}/images/${image.id}`;

export const factoryImageArtifactSchema = z.object({
	kind: z.literal('factory-image'),
	label: z.string(),
	image: factoryImageSchema.or(factoryImagePendingSchema)
});
