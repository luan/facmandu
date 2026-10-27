import { variables } from '../../src/env';

export function emptyPrivateEnv() {
	return Object.fromEntries(Object.keys(variables).map((name) => [name, undefined]));
}
