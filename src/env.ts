import { defineEnvVars } from '@sveltejs/kit/env';

export const variables = defineEnvVars({
	DATABASE_URL: { schema: (input) => input },
	DROPBOX_APP_KEY: { schema: (input) => input },
	FACMANDU_AGENT_DATA: { schema: (input) => input },
	FACMANDU_CACHE_DIR: { schema: (input) => input },
	FACMANDU_OPERATOR_USER_IDS: { schema: (input) => input },
	FACMANDU_REPLICA_PATH: { schema: (input) => input },
	FACMANDU_REVISION: { schema: (input) => input },
	FACMANDU_SERVER_DIRECTORY: { schema: (input) => input },
	ORIGIN: { schema: (input) => input },
	TURSO_AUTH_TOKEN: { schema: (input) => input },
	TURSO_CONNECTION_URL: { schema: (input) => input }
});
