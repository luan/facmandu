import { z } from 'zod';
import adapter from '../../../factorio-mod/integrations/task-list.lua?raw';
import type { ManagedServer } from './db/schema';
import { ServerError } from './server-files';
import { rconScript } from './server-rcon';
import tables from './task-list/table.lua?raw';
import tasks from './task-list/task.lua?raw';
import util from './task-list/util.lua?raw';

// Console mod contexts let the unmodified public TaskList own its task methods,
// force privacy and GUI refreshes. Re-establish this interface after save reloads.
export const taskListBridgeCommand = `/silent-command __TaskList__ local ok,result=pcall(function()
assert(script.mod_name=='TaskList' and script.active_mods.TaskList=='0.6.0','Unsupported TaskList version')
if remote.interfaces['facmandu-task-list'] then return {ready=true} end
local require
local loaded={}
local modules={['scripts.task']=function() ${tasks} end,['scripts.util']=function() ${util} end,['__flib__.table']=function() ${tables} end}
require=function(name) if not loaded[name] then loaded[name]=assert(modules[name],'Unknown TaskList module')() end;return loaded[name] end
${adapter}
return {ready=true}
end);rcon.print(helpers.table_to_json(ok and result or {error=tostring(result)}))`;

export async function prepareTaskList(server: ManagedServer) {
	const raw = await rconScript(
		server,
		`/silent-command local api=remote.interfaces['facmandu-task-list'];rcon.print(helpers.table_to_json({version=script.active_mods.TaskList,ready=not not (api and api.read and api.add and api.update)}))`
	);
	const state = z
		.object({ version: z.string().optional(), ready: z.boolean() })
		.parse(JSON.parse(raw));
	if (state.ready || state.version !== '0.6.0') return;
	const result = z
		.object({ ready: z.boolean().optional(), error: z.string().optional() })
		.parse(JSON.parse(await rconScript(server, taskListBridgeCommand)));
	if (!result.ready) throw new ServerError(502, result.error || 'Could not connect to TaskList');
}
