# Toby

Private development build, version **0.0.1**. This package has not been published to the Mod Portal.

Click **Toby** above the game view, or press **Ctrl+Shift+T**, to open the side panel. **Chat** shows recent messages, **Activity** shows the selected run's tool activity, and **Design** holds its latest blueprint. Switch conversations while a run continues, or use **Steer** to add instructions. Press **Enter** to send or steer. Closing the panel keeps your typed draft. Shortcuts are configurable in Factorio’s Controls settings.

**Open blueprint** uses Factorio's blueprint editor. Press **Ctrl+Shift+Enter** from the message input, or **Ctrl+Shift+B** from the game view, to open it with the keyboard. **Place ghosts** puts the design in your cursor and closes the panel so you can place it. Both preserve your held item through Factorio's clear-cursor operation and refuse when the item cannot be returned to your inventory. Neither supplies construction materials.

Install this mod on the server **and every client**. Enable the in-game assistant in Facmandu's server settings. The mod contains no model credentials and has no network client. Player GUI events are emitted into the server log; Facmandu checks the connected player and conversation ownership before dispatch. Responses arrive over the existing private RCON connection. Existing force and action permissions apply.

Ambient mode is optional in server settings and requires a connected NeuralWatt account with Clef access. It sends ordinary player chat and recent assistant context to Clef for routing. Bare `@`, `@toby`, and `@assistant` remain direct requests.

**Drone** (or **Ctrl+Shift+D** from the game view) controls Toby’s own craftable construction companion. It is independent of Entourage. The recipe unlocks with personal roboport equipment. Place it to assign it to yourself; an unassigned drone can be claimed by pointing at it and pressing **Ctrl+Shift+Y**. Each player controls one drone. **Equipment and inventory** opens its native equipment grid and cargo. Load ordinary power equipment, a personal roboport, construction robots and building materials; nothing is supplied automatically. **Follow me** and **Stay here** use native movement. The assistant can inspect it and send it to an explored destination within 256 tiles after an explicit request. It stays on its current surface when you leave or disconnect, preserving its inventory. Construction, repair and deconstruction use Factorio’s normal robot network and consumption rules.

Factory Planner and Helmod reads are implemented in Facmandu. Task List requires its separate adapter from server settings. Automated sandbox trials are still pending.
