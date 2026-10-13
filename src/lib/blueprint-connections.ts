import type { BlueprintArtifact } from './blueprints';

type Transfer = BlueprintArtifact['inserter_transfers'][number];
type Endpoint = Pick<BlueprintArtifact['entities'][number], 'name' | 'recipe'>;
type Group = {
	pickup: Endpoint;
	drop: Endpoint;
	transfers: [number, number, number][];
	belt_side?: Transfer['drop_belt_side'];
	lane_items_per_second?: number;
	path?: Omit<NonNullable<Transfer['planned_belt_path']>, 'length'>;
};

// The full native traces remain in the saved artifact. Group repeated internal
// connections for the model; external joins and faulty paths retain exact points.
export function blueprintConnections(artifact: BlueprintArtifact) {
	const groups = new Map<string, Group>();
	const external: Transfer[] = [];
	const faults: Transfer[] = [];
	for (const transfer of artifact.inserter_transfers) {
		const pickupIndex = transfer.pickup_entity;
		const dropIndex = transfer.drop_entity;
		const pickup = pickupIndex && artifact.entities[pickupIndex - 1];
		const drop = dropIndex && artifact.entities[dropIndex - 1];
		if (!pickupIndex || !dropIndex || !pickup || !drop) {
			external.push(transfer);
			continue;
		}
		if (transfer.planned_belt_path && transfer.planned_belt_path.status !== 'external') {
			faults.push(transfer);
			continue;
		}
		let path: Group['path'];
		if (transfer.planned_belt_path) {
			const { length: _length, ...details } = transfer.planned_belt_path;
			path = details;
		}
		const connection = {
			pickup: { name: pickup.name, recipe: pickup.recipe },
			drop: { name: drop.name, recipe: drop.recipe },
			belt_side: transfer.drop_belt_side,
			lane_items_per_second: transfer.belt_lane_items_per_second,
			path
		};
		// Length differs along one shared output belt; its terminal is the same join.
		const key = JSON.stringify(connection);
		let group = groups.get(key);
		if (!group) {
			group = { ...connection, transfers: [] };
			groups.set(key, group);
		}
		group.transfers.push([transfer.inserter, pickupIndex, dropIndex]);
	}
	return {
		groups: [...groups.values()],
		external,
		faults,
		note: 'Transfers are [inserter, pickup entity, drop entity] indices. Paths describe proposed geometry; external joins and actual production need world inspection.'
	};
}
