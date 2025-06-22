import { encodeBase32LowerCase } from '@oslojs/encoding';

export function genID(prefix: string) {
	const bytes = crypto.getRandomValues(new Uint8Array(15));
	const id = encodeBase32LowerCase(bytes);
	return `${prefix}-${id}`;
}
