import type * as v from 'valibot';
import { z } from 'zod';
import type { savedFactoryPlanInput } from '$lib/factory-plan-input';
import type { ManagedServer } from './db/schema';

export { savedFactoryPlanInput } from '$lib/factory-plan-input';

import { luaString } from './factory-query-bundle';
import { ServerError } from './server-files';
import { rconScript } from './server-rcon';

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
 local methods={create='create_plan',list='list_plans',read='read_plan',set_inputs='set_inputs',set_products='set_products',edit_line='edit_line',nest_line='nest_line'}
 local method=methods[a.operation]
 if not remote.interfaces[interface] or not remote.interfaces[interface][method] then error('Toby planning does not support '..a.operation..' on this server; update the server mod',0) end
 local id
 if a.reference then
  local force_index,plan_id=a.reference:match('^toby://plan/(%d+)/(%d+)$')
  if tonumber(force_index)~=p.force.index then error('Plan reference belongs to another force',0) end
  id=tonumber(plan_id)
 end
 local configured=false
 for _,row in ipairs(a.recipes or {}) do for key in pairs(row) do if key~='name' and key~='machine' then configured=true end end end
 for _,rows in ipairs{a.products or {},a.inputs or {}} do for _,row in ipairs(rows) do if row.temperature~=nil then configured=true end end end
 if a.maximize and a.maximize.temperature~=nil then configured=true end
 if configured and not remote.interfaces[interface].edit_line then error('Configured lines and fluid temperatures require updated Toby planning on the server',0) end
 if a.operation=='create' then return remote.call(interface,method,a.force,a.player,a.surface,a.name,a.products,a.recipes,a.inputs,a.maximize,a.requestKey) end
 if a.operation=='set_products' then return remote.call(interface,method,a.force,a.player,id,a.expectedRevision,a.products) end
 if a.operation=='edit_line' then return remote.call(interface,method,a.force,a.player,id,a.expectedRevision,a.lineId,a.patch) end
 if a.operation=='nest_line' then return remote.call(interface,method,a.force,a.player,id,a.expectedRevision,a.lineId) end
 if a.operation=='set_inputs' then return remote.call(interface,method,a.force,a.player,id,a.expectedRevision,a.inputs,a.maximize) end
 return remote.call(interface,method,a.force,a.player,id)
 end)
 local output=helpers.table_to_json(ok and {ok=true,result=result} or {ok=false,error=tostring(result):match('^[^\\n]*')})
 if #output>262144 and ok and a.operation~='read' and a.operation~='list' and type(result)=='table' then
  output=helpers.table_to_json({ok=true,result={planId=result.planId,reference=result.reference,revision=result.revision,status=result.status,truncated=true,note='The edit was applied. Open the native planner for this large plan.'}})
 end
 if #output>262144 then output='{"ok":false,"error":"Plan response is too large; narrow the plan"}' end
 rcon.print(output)`
	);
	const parsed = reply.parse(JSON.parse(output));
	if (!parsed.ok) throw new ServerError(400, parsed.error);
	return parsed.result;
}
