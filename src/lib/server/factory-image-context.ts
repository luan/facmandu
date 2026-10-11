import type { TranscriptContext } from '@earendil-works/pi-ai';
import { z } from 'zod';
import { factoryImageReferenceSchema } from '$lib/factory-images';
import { pngDimensions } from './factory-image-data';

const imageResult = z.union([
	z.object({
		kind: z.literal('factory-result'),
		result: z.object({ kind: z.string().optional(), image: factoryImageReferenceSchema })
	}),
	z
		.object({ kind: z.string().optional(), image: factoryImageReferenceSchema })
		.transform((result) => ({ result }))
]);
// Load at the provider boundary: transcripts store small immutable image references, not base64 JSON.
export function addFactoryImages(
	context: TranscriptContext,
	read: (id: string) => Buffer,
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
						pending: parsed.data.result.kind === 'factory-preview-pending'
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
			try {
				if (!vision) throw new Error('This model does not support images');
				const png = read(selectedImage.id);
				pngDimensions(png);
				return {
					...message,
					content: [
						...message.content,
						{ type: 'image' as const, data: png.toString('base64'), mimeType: 'image/png' }
					]
				};
			} catch {
				return {
					...message,
					content: [
						...message.content,
						{
							type: 'text' as const,
							text: vision
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
