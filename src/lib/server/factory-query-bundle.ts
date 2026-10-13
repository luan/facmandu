import { ServerError } from './server-files';

export function luaString(value: string) {
	let delimiter = '=';
	while (value.includes(`]${delimiter}]`)) delimiter += '=';
	return `[${delimiter}[${value}]${delimiter}]`;
}

// Sources use line comments only; multiline strings need Lua-aware compaction.
export function factoryBundle(sources: Record<string, string>, owners?: string[]) {
	const modules = Object.fromEntries(
		Object.entries(sources).map(([path, source]) => [
			path
				.replace('./factory-query/', '')
				.replace(/\.lua$/u, '')
				.replaceAll('/', '.'),
			source
				.split('\n')
				.filter((line) => line.trim() && !line.trimStart().startsWith('--'))
				.map((line) => line.trim())
				.join('\n')
		])
	);

	// Commands own their registry. No code is installed in the save, and only
	// reviewed local sources can supply modules or tools. Contracts identify owners;
	// static require dependencies keep each lookup's bundle small.
	const selected = new Set<string>();
	function include(name: string) {
		if (selected.has(name)) return;
		const source = modules[name];
		if (!source) throw new ServerError(400, 'Unknown query module');
		selected.add(name);
		for (const dependency of source.matchAll(/\brequire\s*\(\s*["']([^"']+)["']\s*\)/gu))
			if (dependency[1]) include(dependency[1]);
	}
	for (const owner of owners ?? Object.keys(modules)) include(owner);
	return `local native_remote = remote
local registry = {}
local remote = { interfaces = {} }
function remote.add_interface(name, functions) registry[name] = functions; remote.interfaces[name] = functions end
function remote.call(name, method, ...) return registry[name][method](...) end
local require
local modules = {
${[...selected].map((name) => `[ ${luaString(name)} ] = function()\n${modules[name]}\nend`).join(',\n')}
}
local loaded = {}
require = function(name)
 if not loaded[name] then loaded[name] = assert(modules[name], "Unknown query module")() end
 return loaded[name]
end
${
	owners
		? `local functions = {}
local manifest = {}
for _,name in ipairs({${owners.map(luaString).join(',')}}) do
 local module = require(name)
 if module.provider then module = module.provider(native_remote) end
 for tool,entry in pairs(module.manifest) do
  manifest[tool] = entry
  functions[tool] = assert(module.functions[tool], "Missing query implementation")
 end
end
functions.agent_tools_v1 = function() return {v=1,tools=manifest} end`
		: `require("scripts.tools.engine").register(native_remote)
local functions = registry["ai-agent-bridge-tools"]`
}
`;
}
