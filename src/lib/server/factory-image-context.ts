import type { TranscriptContext } from '@earendil-works/pi-ai';
import { z } from 'zod';
import { factoryImageReferenceSchema } from '$lib/factory-images';
import { pngDimensions } from './factory-image-data';

const reference = factoryImageReferenceSchema.extend({ pending: z.boolean().optional() });
const imageResult = z.union([
	z.object({
		kind: z.literal('factory-result'),
		result: z.object({ kind: z.string().optional(), image: reference })
	}),
	z.object({ kind: z.string().optional(), image: reference }).transform((result) => ({ result }))
]);
// Load at the provider boundary: transcripts store small immutable image references, not base64 JSON.
export function addFactoryImages(
	context: TranscriptContext,
	read: (id: string) => Buffer | { data: Buffer; mimeType: 'image/jpeg' },
	vision = true
): TranscriptContext {
	const images = new Map<number, { id: string; pending: boolean }>();
	for (const [index, message] of context.messages.entries()) {
		if (
			message.role !== 'toolResult' ||
			message.isError ||
			!['factory_view', 'blueprint_operation', 'render_blueprint'].includes(message.toolName)
		)
			continue;
		for (const part of message.content) {
			if (part.type !== 'text') continue;
			try {
				const parsed = imageResult.safeParse(JSON.parse(part.text));
				if (parsed.success)
					images.set(index, {
						id: parsed.data.result.image.id,
						pending:
							parsed.data.result.kind === 'factory-preview-pending' ||
							parsed.data.result.image.pending === true
					});
			} catch {
				/* Other tool text is not an image reference. */
			}
		}
	}
	// Keep two recent views available for comparison; older snapshots remain in the harness history.
	const selected = new Map([...images].slice(-2));
	return {
		...context,
		messages: context.messages.map((message, index) => {
			const selectedImage = selected.get(index);
			if (!selectedImage || message.role !== 'toolResult') return message;
			let oversized = false;
			try {
				if (!vision) throw new Error('This model does not support images');
				const loaded = read(selectedImage.id);
				const data = Buffer.isBuffer(loaded) ? loaded : loaded.data;
				const mimeType = Buffer.isBuffer(loaded) ? 'image/png' : loaded.mimeType;
				oversized = data.length > 512 * 1024;
				if (oversized) throw new Error('Image exceeds model request budget');
				if (mimeType === 'image/png') pngDimensions(data);
				else if (
					data.length < 4 ||
					data.readUInt16BE(0) !== 0xffd8 ||
					data.readUInt16BE(data.length - 2) !== 0xffd9
				)
					throw new Error('Invalid JPEG preview');
				return {
					...message,
					content: [
						...message.content,
						{ type: 'image' as const, data: data.toString('base64'), mimeType }
					]
				};
			} catch {
				return {
					...message,
					content: [
						...message.content,
						{
							type: 'text' as const,
							text: oversized
								? 'The full image is available in the harness but exceeds the model request budget. Use structured queries; do not recapture or claim to have viewed it.'
								: vision
									? selectedImage.pending
										? 'The factory image is still preparing or unavailable. Continue with structured queries; do not recapture or claim to have viewed it.'
										: 'The referenced factory image is unavailable. Do not claim to have viewed it; capture another factory_view.'
									: 'This model does not support image input. The harness displays the snapshot, but you have not viewed it. Use structured factory queries.'
						}
					]
				};
			}
		})
	};
}
