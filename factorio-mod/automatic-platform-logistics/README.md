# Automatic Platform Logistics

Place normal logistic chests on a powered space platform. Logistic robots appear automatically and carry items between provider, storage, buffer, and requester chests. You do not need to build roboports, manufacture robots, or send robots into orbit.

- Covers the platform automatically as you expand its foundation.
- Uses Factorio's normal logistic deliveries, item qualities, requests, and circuit conditions.
- Supplies more logistic robots when all available robots are busy. Surplus robots retire after returning home.
- Requires power for the network and robot charging. During a blackout, already flying robots can finish using their remaining battery charge; new deliveries resume when power returns.
- Adds no construction robots and does not change platform construction, repair, or deconstruction.
- Leaves planetary logistic networks and existing robot recipes unchanged.
- Works on existing saves and new platforms. Each force and platform has its own network.

The network consumes **50 kW per occupied 32-by-32 tile area**, plus robot charging at up to **1 MW per charging station**. Available electricity limits charging throughput. Materials still come from your chests; the mod provides only the logistic robots and their implied roboports. Ordinary chests and machine inventories do not automatically become providers, and the platform hub keeps its usual cargo behavior.

Requires **Factorio 2.1 and Space Age**. No dependency on Robots in space is needed.

## Read the network with circuit wires

Craft a **Platform logistics reader** (one constant combinator and five electronic circuits) and place it anywhere on the powered platform. Connect red or green wire, then open its circuit controls and enable **Read logistic network contents** and/or **Read robot statistics**, just as on a roboport. Item signals retain their qualities, and the robot-count output signals are configurable. You can also select the native missing-requests read mode.

The reader takes one tile, consumes 1 kW, and does not house or charge robots. Its settings and wires use normal blueprint and copy/paste behavior. It reads available stock in the logistic network; requester chest contents and the platform hub's cargo inventory keep their normal Factorio behavior.

Inspired by [Robots in space](https://mods.factorio.com/mod/lyra_robots_in_space) by hopefuldecay. This is an independent implementation of automatic, powered platform logistics.
