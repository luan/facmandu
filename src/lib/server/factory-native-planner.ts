import * as v from 'valibot';
import { z } from 'zod';
import type { ManagedServer } from './db/schema';
import {
	nativeFactoryPlanInput,
	nativePlannerInputs,
	nativePlannerMaximize
} from './factory-planning';
import { luaString } from './factory-query-bundle';
import { ServerError } from './server-files';
import { rconScript } from './server-rcon';

const scope = {
	force: nativeFactoryPlanInput.entries.force,
	player: nativeFactoryPlanInput.entries.player
};
const reference = v.pipe(v.string(), v.regex(/^toby:\/\/plan\/[1-9]\d{0,9}\/[1-9]\d{0,9}$/u));
export const savedFactoryPlanInput = v.variant('operation', [
	v.object({
		operation: v.literal('create'),
		...nativeFactoryPlanInput.entries,
		name: scope.force
	}),
	v.object({ operation: v.literal('list'), ...scope }),
	v.object({ operation: v.literal('read'), ...scope, reference }),
	v.object({
		operation: v.literal('set_inputs'),
		...scope,
		reference,
		expectedRevision: v.pipe(v.number(), v.integer(), v.minValue(0)),
		inputs: nativePlannerInputs,
		maximize: v.optional(nativePlannerMaximize)
	})
]);
type SavedPlanInput = v.InferOutput<typeof savedFactoryPlanInput>;
const reply = z.discriminatedUnion('ok', [
	z.object({ ok: z.literal(true), result: z.json() }),
	z.object({ ok: z.literal(false), error: z.string() })
]);

export async function savedFactoryPlan(
	server: ManagedServer,
	input: SavedPlanInput,
	requestKey: string,
	actor?: { name: string }
) {
	const data = { ...input, requestKey, actor };
	const output = await rconScript(
		server,
		`/silent-command local a=helpers.json_to_table(${luaString(JSON.stringify(data))}); local ok,result=pcall(function()
 local p=game.get_player(a.player)
 if not p or p.force.name~=a.force then error('Choose a player on this force',0) end
 if a.actor and (p.name~=a.actor.name or not p.connected) then error('Player permission changed; request again',0) end
 local interface='facmandu-toby-planner'
 local methods={create='create_plan',list='list_plans',read='read_plan',set_inputs='set_inputs'}
 local method=methods[a.operation]
 if not remote.interfaces[interface] or not remote.interfaces[interface][method] then error('This operation requires Toby built-in planning on the server',0) end
 local id
 if a.reference then
  local force_index,plan_id=a.reference:match('^toby://plan/(%d+)/(%d+)$')
  if tonumber(force_index)~=p.force.index then error('Plan reference belongs to another force',0) end
  id=tonumber(plan_id)
 end
 if a.operation=='create' then return remote.call(interface,method,a.force,a.player,a.surface,a.name,a.products,a.recipes,a.inputs,a.maximize,a.requestKey) end
 if a.operation=='set_inputs' then return remote.call(interface,method,a.force,a.player,id,a.expectedRevision,a.inputs,a.maximize) end
 return remote.call(interface,method,a.force,a.player,id)
 end)
 local output=helpers.table_to_json(ok and {ok=true,result=result} or {ok=false,error=tostring(result):match('^[^\\n]*')})
 if #output>262144 then output='{"ok":false,"error":"Plan response is too large; narrow the plan"}' end
 rcon.print(output)`
	);
	const parsed = reply.parse(JSON.parse(output));
	if (!parsed.ok) throw new ServerError(400, parsed.error);
	return parsed.result;
}
