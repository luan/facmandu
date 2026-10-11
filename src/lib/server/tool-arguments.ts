import type {
	AssistantMessage,
	AssistantMessageEventStream,
	JsonValue,
	ToolCall,
	TranscriptContext
} from '@earendil-works/pi-ai';

const object = (value: unknown): value is Record<string, unknown> =>
	value !== null && typeof value === 'object' && !Array.isArray(value);

// Some compatible providers double-encode structured fields. Decode only fields
// declared as objects/arrays; the tool's original validation still runs afterward.
export function decodeToolArguments(value: JsonValue, schema: unknown): JsonValue {
	if (!object(schema)) return value;
	let decoded = value;
	if (typeof decoded === 'string' && (schema.type === 'object' || schema.type === 'array')) {
		try {
			const parsed: JsonValue = JSON.parse(decoded);
			if (
				(schema.type === 'object' && object(parsed)) ||
				(schema.type === 'array' && Array.isArray(parsed))
			)
				decoded = parsed;
		} catch {
			// Malformed JSON remains invalid; never guess or repair the model's intent.
		}
	}
	if (Array.isArray(decoded) && schema.type === 'array')
		decoded = decoded.map((item) => decodeToolArguments(item, schema.items));
	else if (object(decoded) && object(schema.properties)) {
		const properties = schema.properties;
		decoded = Object.fromEntries(
			Object.entries(decoded).map(([key, item]) => [
				key,
				decodeToolArguments(item, properties[key])
			])
		);
	}
	for (const branch of [schema.anyOf, schema.oneOf, schema.allOf])
		if (Array.isArray(branch))
			for (const candidate of branch) decoded = decodeToolArguments(decoded, candidate);
	return decoded;
}

export function decodeToolStream(
	stream: AssistantMessageEventStream,
	transcript: TranscriptContext
): AssistantMessageEventStream {
	const schemas = new Map(
		transcript.messages.flatMap((message) =>
			message.role === 'system'
				? (message.toolsAdded ?? []).map((tool) => [tool.name, tool.parameters] as const)
				: []
		)
	);
	const decodeCall = (call: ToolCall) => {
		call.arguments = decodeToolArguments(
			call.arguments,
			schemas.get(call.name)
		) as typeof call.arguments;
	};
	const decodeMessage = (message: AssistantMessage) => {
		for (const block of message.content) if (block.type === 'toolCall') decodeCall(block);
		return message;
	};
	const iterator = stream[Symbol.asyncIterator].bind(stream);
	const result = stream.result.bind(stream);
	stream[Symbol.asyncIterator] = async function* () {
		for await (const event of { [Symbol.asyncIterator]: iterator }) {
			if (event.type === 'toolcall_end') {
				decodeCall(event.toolCall);
				decodeMessage(event.partial);
			} else if (event.type === 'done') decodeMessage(event.message);
			yield event;
		}
	};
	stream.result = () => result().then(decodeMessage);
	return stream;
}
