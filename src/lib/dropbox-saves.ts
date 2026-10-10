import { createHash } from 'node:crypto';
import { unzipSync } from 'fflate';

export const cloudSaveLimit = 100 * 1024 * 1024;
// Dropbox hashes the concatenated SHA-256 digests of each 4 MiB block.
export function dropboxContentHash(bytes: Uint8Array): string {
	const hash = createHash('sha256');
	for (let offset = 0; offset < bytes.length; offset += 4 * 1024 * 1024)
		hash.update(
			createHash('sha256')
				.update(bytes.subarray(offset, offset + 4 * 1024 * 1024))
				.digest()
		);
	return hash.digest('hex');
}
export function validateCloudSave(bytes: Uint8Array): void {
	if (!bytes.length || bytes.length > cloudSaveLimit)
		throw new Error('Save must be smaller than 100 MB');
	const entries = new Set<string>();
	let unsafePath = false;
	// Inspect archive entries without inflating the world or any untrusted ZIP contents.
	unzipSync(bytes, {
		filter: (entry) => {
			if (
				entry.name.startsWith('/') ||
				entry.name.includes('\\') ||
				entry.name.split('/').some((part) => part === '..' || part === '.')
			)
				unsafePath = true;
			if (entry.originalSize > 0) entries.add(entry.name);
			return false;
		}
	});
	const world = [...entries].some((name) => {
		if (/^[^/\\]+\/level\.dat$/u.test(name)) return true;
		if (!/^[^/\\]+\/level-init\.dat$/u.test(name)) return false;
		const root = name.slice(0, name.lastIndexOf('/') + 1);
		// Factorio 2.1 splits the world into numbered chunks plus metadata.
		return entries.has(`${root}level.dat0`) && entries.has(`${root}level.datmetadata`);
	});
	if (!world || unsafePath)
		throw new Error('Choose a complete Factorio save ZIP containing world data');
}
