import { isBundledMod } from '$lib/dependencies';

// Clipboard and archive exports share the same version pins and explicit bundled choices.
export function createModList(
	mods: { name: string; enabled: boolean | null; version: string | null }[]
) {
	return {
		mods: [
			{ name: 'base', enabled: true },
			...mods
				.filter((mod) => mod.name !== 'base' && (mod.enabled || isBundledMod(mod.name)))
				.toSorted((a, b) => a.name.localeCompare(b.name))
				.map(({ name, enabled, version }) => ({
					name,
					enabled: !!enabled,
					...(!isBundledMod(name) && version ? { version } : {})
				}))
		]
	};
}
