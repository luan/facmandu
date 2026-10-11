# Toby

An in-game panel for Facmandu's assistant. Click **Toby** above the game view to open it. Select a conversation, send or steer a request, start a new chat, or stop the selected response. Progress and the latest answer appear in the panel. The full transcript and blueprint controls remain in Facmandu's web harness.

When Toby returns a blueprint, **Take blueprint** puts the latest displayed design in your cursor for ordinary ghost placement. It preserves your held item through Factorio's clear-cursor operation and refuses when the item cannot be returned to your inventory. It does not supply construction materials.

Install this mod on the server **and every client**. Enable the in-game assistant in Facmandu's server settings. The mod contains no model credentials and has no network client. Player GUI events are emitted into the server log; Facmandu checks the connected player and conversation ownership before dispatch. Responses arrive over the existing private RCON connection. Existing force and action permissions apply.

Ambient mode is optional in server settings and requires a connected NeuralWatt account with Clef access. It sends ordinary player chat and recent assistant context to Clef for routing. Bare `@`, `@toby`, and `@assistant` remain direct requests.

This first version provides chat and progress, not an autonomous drone or a solver. Factory Planner and Helmod reads are implemented in Facmandu. Task List, Entourage task control, and automated sandbox trials require further adapters; installing this mod does not claim those capabilities.
