export function validModName(name: string): boolean {
	return (
		name.length > 0 &&
		name.length <= 100 &&
		name === name.trim() &&
		name !== '.' &&
		name !== '..' &&
		!/[\\/]/u.test(name) &&
		Array.from(name).every((character) => {
			const code = character.charCodeAt(0);
			return code >= 32 && code !== 127;
		})
	);
}
