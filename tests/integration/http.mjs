// Exercises the built HTTP app with a fresh database and isolated external services.
// Run after `bun run build`. The child cannot contact real Factorio or Turso services.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { once } from 'node:events';
import { appendFile, mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { createServer as createTcpServer } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { zstdDecompressSync } from 'node:zlib';
import { createClient } from '@libsql/client';
import { hash } from '@node-rs/argon2';
import { strToU8, zipSync } from 'fflate';

import {
	createModSettings,
	decodeModSettings,
	encodeModSettings,
	getModSettingValues,
	updateModSettingValues
} from '../../src/lib/mod-settings.ts';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const directory = await mkdtemp(join(tmpdir(), 'facmandu-integration-'));
const database = join(directory, 'app.db');
const cache = join(directory, 'cache');
const origin = 'http://localhost';
const calls = new Map();
const machineDirs = [];
const readState = async (index, path) =>
	JSON.parse(await readFile(join(machineDirs[index], path), 'utf8'));
await mkdir(join(directory, 'bin'));
await writeFile(
	join(directory, 'bin/systemctl'),
	'#!/bin/sh\nprintf "ActiveState=inactive\\nSubState=dead\\n"\n',
	{ mode: 0o755 }
);
await writeFile(
	join(directory, 'bin/xvfb-run'),
	'#!/bin/sh\n[ "$1" = "-a" ] && shift\nexec "$@"\n',
	{ mode: 0o755 }
);
const longName = 'long-mod-name-'.padEnd(100, 'x');
const archive = Buffer.from('immutable fixture archive bytes');
const sha1 = createHash('sha1').update(archive).digest('hex');
async function factorioArchiveFor(version) {
	const fixtureFactorioRoot = join(directory, `factorio-fixture-${version}`);
	const fixtureFactorioBin = join(fixtureFactorioRoot, 'factorio/bin/x64');
	await mkdir(fixtureFactorioBin, { recursive: true });
	await mkdir(join(fixtureFactorioRoot, 'factorio/data/base'), { recursive: true });
	await writeFile(
		join(fixtureFactorioRoot, 'factorio/data/base/info.json'),
		JSON.stringify({ name: 'base', version, dependencies: [] })
	);
	await writeFile(
		join(fixtureFactorioRoot, 'factorio/fixture-save.zip'),
		zipSync({ 'world.txt': strToU8('fixture world') })
	);
	await writeFile(
		join(fixtureFactorioBin, 'factorio'),
		`#!/bin/sh
for arg in "$@"; do
  if [ "$arg" = "--version" ]; then printf 'Version: ${version} (fixture)\n'; exit 0; fi
done
previous=''
for arg in "$@"; do
  if [ "$previous" = "--create" ]; then cp "$(dirname "$0")/../../fixture-save.zip" "$arg"; exit $?; fi
  previous="$arg"
done
exit 1
`,
		{ mode: 0o755 }
	);
	const fixtureFactorioTar = join(directory, `factorio-fixture-${version}.tar.xz`);
	const tarFixture = spawn('tar', [
		'-cJf',
		fixtureFactorioTar,
		'-C',
		fixtureFactorioRoot,
		'factorio'
	]);
	assert.equal((await once(tarFixture, 'exit'))[0], 0);
	return readFile(fixtureFactorioTar);
}
const factorioArchive = await factorioArchiveFor('2.1.20');
const experimentalArchive = await factorioArchiveFor('2.1.21');
const catalog = (name, version, dependencies = ['base >= 2.1']) => ({
	name,
	title: `Fixture ${name}`,
	owner: 'fixture',
	summary: 'Integration fixture',
	releases: [
		{
			version,
			sha1,
			download_url: `/download/${name}/${version}`,
			info_json: { factorio_version: '2.1', dependencies }
		}
	]
});
const metadata = new Map([
	[
		'root-mod',
		catalog('root-mod', '1.0.0', [
			'base >= 2.1',
			'dependency >= 1.0.0',
			'? companion',
			'? missing-ranking'
		])
	],
	['dependency', catalog('dependency', '1.0.0')],
	[longName, catalog(longName, '1.0.0')],
	['cold-mod', catalog('cold-mod', '1.0.0')],
	['companion', catalog('companion', '1.0.0')],
	['missing-ranking', catalog('missing-ranking', '1.0.0')]
]);
metadata.set('choice', {
	...catalog('choice', '1.0.0'),
	releases: [
		...catalog('choice', '1.0.0', ['base >= 2.1', 'choice-dependency >= 1.0.0']).releases,
		...catalog('choice', '2.0.0', ['base >= 2.1', 'choice-dependency >= 2.0.0']).releases,
		{
			...catalog('choice', '3.0.0').releases[0],
			info_json: { factorio_version: '2.0', dependencies: ['base >= 2.0'] }
		}
	]
});
metadata.set('choice-dependency', {
	...catalog('choice-dependency', '1.0.0'),
	releases: [
		...catalog('choice-dependency', '1.0.0').releases,
		...catalog('choice-dependency', '2.0.0').releases
	]
});
for (let index = 0; index < 25; index++)
	metadata.set(`bulk-${index}`, catalog(`bulk-${index}`, '1.0.0'));
let oauthSubject = 'fixture-openai-owner';
const requestedModels = [];
const codexMenus = [];
const routingQueries = [];
const assistantToolOutputs = [];
let fixturePlanListId;
let fixtureSharedListId;
let fixtureUnrelatedListId;
let portalOffline = false;
let setupDownloadOffline = false;
let incompleteRankings = true;
let blockDownload;
let downloadStarted;
let blockReleases;
let releasesStarted;
const fixture = createServer(async (request, response) => {
	try {
		const url = new URL(request.url, origin);
		const key = url.pathname;
		calls.set(key, (calls.get(key) ?? 0) + 1);
		const send = (value, status = 200) => {
			response.writeHead(status, { 'content-type': 'application/json' });
			response.end(JSON.stringify(value));
		};

		if (key === '/openai/api/accounts/deviceauth/usercode')
			return send({ device_auth_id: 'fixture-device', user_code: 'TEST-1234', interval: 0 });
		if (key === '/openai/api/accounts/deviceauth/token')
			return send({ authorization_code: 'fixture-code', code_verifier: 'fixture-verifier' });
		if (key === '/openai/oauth/token') {
			const claims = {
				sub: oauthSubject,
				iss: 'https://auth.openai.com',
				exp: Math.floor(Date.now() / 1000) + 3600,
				'https://api.openai.com/auth': { chatgpt_account_id: 'shared-workspace' }
			};
			return send({
				access_token: `header.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.signature`,
				refresh_token: 'fixture-refresh-secret',
				expires_in: 3600
			});
		}
		if (key === '/codex/backend-api/codex/models') {
			assert.equal(url.searchParams.get('client_version'), '0.159.2');
			assert.equal(request.headers['chatgpt-account-id'], 'shared-workspace');
			return send({
				models: [
					{
						slug: 'gpt-6-astra',
						display_name: 'GPT-6-Astra',
						visibility: 'list',
						context_window: 272000,
						priority: 1,
						supported_reasoning_levels: [
							{ effort: 'medium' },
							{ effort: 'high' },
							{ effort: 'max' }
						],
						default_reasoning_level: 'medium'
					},
					{
						slug: 'gpt-6-sol',
						display_name: 'GPT-6-Sol',
						visibility: 'list',
						context_window: 272000,
						priority: 2,
						supported_reasoning_levels: [{ effort: 'medium' }, { effort: 'high' }],
						default_reasoning_level: 'medium'
					},
					{
						slug: 'gpt-6-luna',
						display_name: 'GPT-6-Luna',
						visibility: 'list',
						context_window: 272000,
						priority: 3,
						supported_reasoning_levels: [{ effort: 'low' }, { effort: 'medium' }],
						default_reasoning_level: 'medium'
					},
					{
						slug: 'hidden-model',
						display_name: 'Hidden',
						visibility: 'hide',
						context_window: 272000,
						supported_reasoning_levels: [{ effort: 'medium' }],
						default_reasoning_level: 'medium'
					}
				]
			});
		}
		if (key === '/codex/backend-api/codex/realtime/calls') {
			assert.equal(url.searchParams.get('intent'), 'quicksilver');
			assert.equal(request.headers['chatgpt-account-id'], 'shared-workspace');
			assert.equal(request.headers['openai-alpha'], 'quicksilver=v2');
			const chunks = [];
			for await (const chunk of request) chunks.push(chunk);
			const body = JSON.parse(Buffer.concat(chunks).toString());
			assert.equal(body.session.model, 'gpt-live-1-codex');
			assert.equal(body.session.delegation.type, 'client');
			assert.ok(body.session.instructions.includes('Delegate every request'));
			assert.ok(Array.isArray(body.session.initial_items));
			assert.ok(request.headers.authorization.startsWith('Bearer header.'));
			response.writeHead(201, { 'Content-Type': 'application/sdp' });
			response.end('v=0\r\nfixture-voice-answer');
			return;
		}
		if (key.startsWith('/codex/')) {
			const chunks = [];
			for await (const chunk of request) chunks.push(chunk);
			let bytes = Buffer.concat(chunks);
			if (request.headers['content-encoding'] === 'zstd') bytes = zstdDecompressSync(bytes);
			const body = JSON.parse(bytes.toString());
			requestedModels.push(body.model);
			assert.ok(request.headers.authorization.startsWith('Bearer header.'));
			const currentRequest = JSON.stringify(
				body.input.findLast(
					(item) => item.role === 'user' && JSON.stringify(item).includes('facmandu-request')
				) ?? body.input.filter((item) => item.role === 'user').at(-1)
			);
			const requestIndex = body.input.findLastIndex(
				(item) => item.role === 'user' && JSON.stringify(item).includes('facmandu-request')
			);
			const currentInput = body.input.slice(Math.max(0, requestIndex));
			const called = (name) =>
				currentInput.some((item) => item.type === 'function_call' && item.name === name);
			const directCallCount = currentInput.filter(
				(item) => item.type === 'function_call' && item.name === 'apply_changes'
			).length;
			for (const item of currentInput.filter((item) => item.type === 'function_call_output'))
				assistantToolOutputs.push({ callId: item.call_id, output: item.output });
			codexMenus.push({
				request: currentRequest,
				// Responses can anchor newly loaded tools in the input transcript.
				// Observe both forms so this checks the model's complete tool menu.
				tools: [
					...(body.tools ?? []),
					...body.input.flatMap((item) =>
						item.type === 'additional_tools' || item.type === 'tool_search_output'
							? (item.tools ?? [])
							: []
					)
				].map((tool) => tool.name),
				parallelToolCalls: body.parallel_tool_calls
			});
			if (currentRequest.includes('fixture-fresh-chat'))
				assert.ok(
					!JSON.stringify(body.input).includes('fixture-plan'),
					'New chat must not inherit another conversation'
				);
			const wantsCompaction = currentRequest.includes('fixture-long-context');
			const wantsGame = currentRequest.includes('fixture-game-');
			const wantsGameQuestionAction = currentRequest.includes('fixture-game-question-action');
			if (wantsGame) {
				assert.equal(body.model, 'gpt-6-luna');
				assert.equal(body.reasoning.effort, 'medium');
				assert.match(currentRequest, /connected in-game player/u);
			}
			const wantsPlan = currentRequest.includes('User request: fixture-plan');
			if (wantsPlan) assert.equal(body.reasoning.effort, 'high');
			const wantsCards = currentRequest.includes('User request: fixture-cards');
			const wantsLoadTools = currentRequest.includes('fixture-load-tools');
			const wantsServerSaves = currentRequest.includes('fixture-server-saves');
			const wantsServerSettings = currentRequest.includes('fixture-server-settings');
			const wantsServerModPlan = currentRequest.includes('fixture-server-mod-plan');
			const wantsCombinedReview = currentRequest.includes('User request: fixture-combined-review');
			const wantsDirectApply = currentRequest.includes('User request: fixture-direct-apply');
			const wantsPreviewRecommendations = currentRequest.includes(
				'User request: fixture-preview-recommendations'
			);
			const wantsDismissRecommendation = currentRequest.includes(
				'User request: fixture-dismiss-recommendation'
			);
			const wantsRestoreRecommendation = currentRequest.includes(
				'User request: fixture-restore-recommendation'
			);
			const wantsRestoreAndRank = currentRequest.includes('User request: fixture-restore-and-rank');
			const wantsRankedRecommendations = currentRequest.includes(
				'User request: fixture-ranked-recommendations'
			);
			const wantsLockMod = currentRequest.includes('User request: fixture-lock-mod');
			const wantsUnlockMod = currentRequest.includes('User request: fixture-unlock-mod');
			const wantsDisableLocked = currentRequest.includes('User request: fixture-disable-locked');
			const wantsUnlockDisable = currentRequest.includes('User request: fixture-unlock-disable');
			const wantsSelectRelease = currentRequest.includes('User request: fixture-select-release');
			const wantsSelectIncompatible = currentRequest.includes(
				'User request: fixture-select-incompatible'
			);
			const wantsIceboxAbsent = currentRequest.includes('User request: fixture-icebox-absent');
			const wantsBundledLock = currentRequest.includes('User request: fixture-bundled-lock');
			const wantsBundledUnlock = currentRequest.includes('User request: fixture-bundled-unlock');
			const wantsBundledDisable = currentRequest.includes('User request: fixture-bundled-disable');
			const wantsBrowseLists = currentRequest.includes('User request: fixture-browse-lists');
			const wantsInspectShared = currentRequest.includes('User request: fixture-inspect-shared');
			const wantsInspectUnrelated = currentRequest.includes(
				'User request: fixture-inspect-unrelated'
			);
			const wantsCompareLists = currentRequest.includes('User request: fixture-compare-lists');
			const wantsProvision = currentRequest.includes('User request: fixture-provision-create');
			const provisionCalls = currentInput.filter(
				(item) => item.type === 'function_call' && item.name === 'create_server_from_list'
			).length;
			if (wantsLoadTools) {
				const tools = body.tools.map((tool) => tool.name);
				assert.ok(tools.includes('load_tools'));
			}
			if (wantsCards) assert.equal(body.reasoning.effort, 'max');
			if (wantsCards)
				assert.ok(
					JSON.stringify(body.input).includes('fixture-plan'),
					'Model changes preserve conversation history'
				);
			const hasResult = body.input.some((item) => item.type === 'function_call_output');
			const compoundItem = wantsRestoreAndRank
				? !called('restore_recommendations')
					? {
							type: 'function_call',
							id: 'fc_restore_and_rank_restore',
							call_id: 'call_restore_and_rank_restore',
							name: 'restore_recommendations',
							arguments: JSON.stringify({ names: ['blueprint-shotgun'] })
						}
					: !called('find_recommendations')
						? {
								type: 'function_call',
								id: 'fc_restore_and_rank_read',
								call_id: 'call_restore_and_rank_read',
								name: 'find_recommendations',
								arguments: '{}'
							}
						: null
				: null;
			const item =
				(wantsGameQuestionAction && !called('factory_action')
					? {
							type: 'function_call',
							id: 'fc_game_question_action',
							call_id: 'call_game_question_action',
							name: 'factory_action',
							arguments: JSON.stringify({
								operation: 'research_add',
								args: { force: 'player', expectedQueue: [], technology: 'automation' }
							})
						}
					: null) ??
				compoundItem ??
				((wantsSelectRelease || wantsSelectIncompatible || wantsIceboxAbsent) &&
				!called('apply_changes')
					? {
							type: 'function_call',
							id: 'fc_choice_change',
							call_id: 'call_choice_change',
							name: 'apply_changes',
							arguments: JSON.stringify({
								changes: [
									wantsIceboxAbsent
										? { name: 'cold-mod', action: 'icebox' }
										: {
												name: 'choice',
												action: 'set_version',
												version: wantsSelectRelease ? '2.0.0' : '3.0.0'
											}
								]
							})
						}
					: (wantsLockMod ||
								wantsUnlockMod ||
								wantsDisableLocked ||
								wantsUnlockDisable ||
								wantsBundledLock ||
								wantsBundledUnlock ||
								wantsBundledDisable) &&
							!called('apply_changes')
						? {
								type: 'function_call',
								id: 'fc_lock_change',
								call_id: 'call_lock_change',
								name: 'apply_changes',
								arguments: JSON.stringify({
									changes: wantsUnlockDisable
										? [
												{ name: 'root-mod', action: 'unlock' },
												{ name: 'root-mod', action: 'disable' }
											]
										: [
												{
													name:
														wantsBundledLock || wantsBundledUnlock || wantsBundledDisable
															? 'quality'
															: 'root-mod',
													action:
														wantsLockMod || wantsBundledLock
															? 'lock'
															: wantsUnlockMod || wantsBundledUnlock
																? 'unlock'
																: 'disable'
												}
											]
								})
							}
						: wantsRestoreRecommendation && !called('restore_recommendations')
							? {
									type: 'function_call',
									id: 'fc_restore_recommendation',
									call_id: 'call_restore_recommendation',
									name: 'restore_recommendations',
									arguments: JSON.stringify({ names: ['blueprint-shotgun'] })
								}
							: wantsDismissRecommendation && !called('dismiss_recommendations')
								? {
										type: 'function_call',
										id: 'fc_dismiss_recommendation',
										call_id: 'call_dismiss_recommendation',
										name: 'dismiss_recommendations',
										arguments: JSON.stringify({ names: ['blueprint-shotgun'] })
									}
								: wantsRankedRecommendations && !called('find_recommendations')
									? {
											type: 'function_call',
											id: 'fc_ranked_recommendations',
											call_id: 'call_ranked_recommendations',
											name: 'find_recommendations',
											arguments: '{}'
										}
									: wantsProvision && !called('inspect_server_setup')
										? {
												type: 'function_call',
												id: 'fc_setup_inspect',
												call_id: 'call_setup_inspect',
												name: 'inspect_server_setup',
												arguments: '{}'
											}
										: wantsProvision && provisionCalls < 2
											? {
													type: 'function_call',
													id: `fc_setup_create_${provisionCalls}`,
													call_id: `call_setup_create_${provisionCalls}`,
													name: 'create_server_from_list',
													arguments: JSON.stringify({
														name: 'Provisioned fixture',
														saveName: 'world.zip',
														start: false
													})
												}
											: wantsBrowseLists && !called('list_my_modlists')
												? {
														type: 'function_call',
														id: 'fc_browse_lists',
														call_id: 'call_browse_lists',
														name: 'list_my_modlists',
														arguments: '{}'
													}
												: wantsInspectShared && !called('inspect_other_list')
													? {
															type: 'function_call',
															id: 'fc_inspect_shared',
															call_id: 'call_inspect_shared',
															name: 'inspect_other_list',
															arguments: JSON.stringify({ listId: fixtureSharedListId })
														}
													: wantsInspectUnrelated && !called('inspect_other_list')
														? {
																type: 'function_call',
																id: 'fc_inspect_unrelated',
																call_id: 'call_inspect_unrelated',
																name: 'inspect_other_list',
																arguments: JSON.stringify({ listId: fixtureUnrelatedListId })
															}
														: wantsCompareLists && !called('compare_my_modlists')
															? {
																	type: 'function_call',
																	id: 'fc_compare_lists',
																	call_id: 'call_compare_lists',
																	name: 'compare_my_modlists',
																	arguments: '{}'
																}
															: wantsCombinedReview && !called('prepare_changes')
																? {
																		type: 'function_call',
																		id: 'fc_combined_review',
																		call_id: 'call_combined_review',
																		name: 'prepare_changes',
																		arguments: JSON.stringify({
																			changes: [
																				{ name: 'review-alpha', action: 'enable' },
																				{ name: 'review-beta', action: 'enable' }
																			]
																		})
																	}
																: wantsDirectApply && directCallCount < 2
																	? {
																			type: 'function_call',
																			id: `fc_direct_apply_${directCallCount}`,
																			call_id: `call_direct_apply_${directCallCount}`,
																			name: 'apply_changes',
																			arguments: JSON.stringify({
																				changes: [
																					{ name: 'direct-alpha', action: 'enable' },
																					{ name: 'direct-beta', action: 'enable' }
																				]
																			})
																		}
																	: wantsPreviewRecommendations && !called('show_mods')
																		? {
																				type: 'function_call',
																				id: 'fc_preview_recommendations',
																				call_id: 'call_preview_recommendations',
																				name: 'show_mods',
																				arguments: JSON.stringify({
																					mods: [
																						{ name: 'review-alpha', reason: 'Preview only' },
																						{ name: 'review-beta', reason: 'Preview only' }
																					]
																				})
																			}
																		: wantsLoadTools &&
																				!body.input.some(
																					(item) =>
																						item.type === 'function_call' &&
																						item.name === 'load_tools'
																				)
																			? {
																					type: 'function_call',
																					id: 'fc_load_tools',
																					call_id: 'call_load_tools',
																					name: 'load_tools',
																					arguments: JSON.stringify({ groups: ['watches'] })
																				}
																			: wantsServerModPlan &&
																					!body.input.some(
																						(item) =>
																							item.type === 'function_call' &&
																							item.name === 'prepare_server_mod_list'
																					)
																				? {
																						type: 'function_call',
																						id: 'fc_server_mod_plan',
																						call_id: 'call_server_mod_plan',
																						name: 'prepare_server_mod_list',
																						arguments: JSON.stringify({ listId: fixturePlanListId })
																					}
																				: (wantsServerSaves || wantsServerSettings) &&
																						!body.input.some(
																							(item) =>
																								item.type === 'function_call' &&
																								item.name ===
																									(wantsServerSaves
																										? 'server_saves'
																										: 'server_settings')
																						)
																					? {
																							type: 'function_call',
																							id: 'fc_server_read',
																							call_id: 'call_server_read',
																							name: wantsServerSaves
																								? 'server_saves'
																								: 'server_settings',
																							arguments: '{}'
																						}
																					: wantsCards &&
																							!body.input.some(
																								(item) =>
																									item.type === 'function_call' &&
																									item.name === 'show_mods'
																							)
																						? {
																								type: 'function_call',
																								id: 'fc_cards',
																								call_id: 'call_cards',
																								name: 'show_mods',
																								arguments: JSON.stringify({
																									mods: [
																										{
																											name: 'agent-addon',
																											reason:
																												'Adds transport options alongside root-mod.'
																										}
																									]
																								})
																							}
																						: wantsPlan && !hasResult
																							? {
																									type: 'function_call',
																									id: 'fc_fixture',
																									call_id: 'call_fixture',
																									name: 'prepare_changes',
																									arguments: JSON.stringify({
																										changes: [
																											{ name: 'agent-addon', action: 'enable' }
																										]
																									})
																								}
																							: {
																									type: 'message',
																									role: 'assistant',
																									id: 'msg_fixture',
																									status: 'completed',
																									content: [
																										{
																											type: 'output_text',
																											text: wantsCompaction
																												? 'Remember this factory context. '.repeat(
																														1400
																													)
																												: wantsGame
																													? '**Iron nearby:** [item=iron-plate] [gps=12,34,nauvis].'
																													: 'Fixture contextual explanation: this adds transport options alongside your enabled root-mod.',
																											annotations: []
																										}
																									]
																								});
			response.writeHead(200, { 'content-type': 'text/event-stream' });
			for (const event of [
				{
					type: 'response.output_item.added',
					output_index: 0,
					item: { ...item, content: [], arguments: '' }
				},
				...(item.type === 'message'
					? [
							{
								type: 'response.output_text.delta',
								output_index: 0,
								content_index: 0,
								delta: item.content[0].text
							}
						]
					: []),
				{ type: 'response.output_item.done', output_index: 0, item },
				{
					type: 'response.completed',
					response: {
						id: 'resp_fixture',
						status: 'completed',
						output: [item],
						usage: {
							input_tokens: wantsCompaction ? 300000 : 10,
							output_tokens: wantsCompaction ? 14000 : 10
						}
					}
				}
			])
				response.write(`data: ${JSON.stringify(event)}\n\n`);
			return response.end();
		}
		if (key === '/typesafe/v1/systemone') {
			assert.equal(request.headers.authorization, 'Bearer fixture-typesafe-key');
			let body = '';
			for await (const chunk of request) body += chunk;
			const query = JSON.parse(body);
			assert.equal(query.model, 'jev-latest');
			if (query.questions.intent) {
				routingQueries.push(query);
				const server = 'research' in query.questions;
				const selected = server
					? ['server']
					: /^fixture-provision-/u.test(query.state.request)
						? ['inspect', 'server']
						: /^(fixture-plan|fixture-combined-review|fixture-direct-apply|fixture-lock-mod|fixture-unlock-mod|fixture-disable-locked|fixture-unlock-disable|fixture-select-release|fixture-select-incompatible|fixture-icebox-absent|fixture-bundled-lock|fixture-bundled-unlock|fixture-bundled-disable)/u.test(
									query.state.request
								)
							? ['inspect', 'changes']
							: /^(fixture-preview-recommendations|fixture-dismiss-recommendation|fixture-restore-recommendation|fixture-restore-and-rank|fixture-ranked-recommendations|fixture-browse-lists|fixture-inspect-shared|fixture-inspect-unrelated|fixture-compare-lists)/u.test(
										query.state.request
									)
								? ['inspect', 'discover']
								: ['inspect'];
				const groups = server
					? ['research', 'production', 'power', 'logistics', 'server', 'watches', 'planning']
					: ['inspect', 'discover', 'changes', 'server'];
				return send({
					answers: {
						intent: {
							choice:
								query.state.request === 'Show list status'
									? 'inspect'
									: query.state.request === 'Show server status'
										? 'status'
										: 'question',
							confidence: 0.99
						},
						ambiguous: { noul: 0.01 },
						...Object.fromEntries(
							groups.map((group) => [group, { noul: selected.includes(group) ? 0.99 : 0.01 }])
						)
					}
				});
			}
			if (Buffer.byteLength(JSON.stringify(query.state)) > 28_000)
				return send({ detail: { error_type: 'max_tokens_exceeded' } }, 400);
			assert.deepEqual(Object.keys(query.state).sort(), [
				'candidates',
				'dismissedMods',
				'enabledMods',
				'factorioVersion'
			]);
			assert.equal(Object.keys(query.questions).length, query.state.candidates.length * 3);
			for (const question of Object.values(query.questions)) {
				assert.equal(question.type, 'score');
				assert.equal(question.criteria.length, 4);
			}
			assert.ok(
				query.state.enabledMods.every((item) =>
					Object.keys(item).every((key) =>
						['name', 'summary', 'title', 'category', 'description'].includes(key)
					)
				)
			);
			return send({
				answers:
					query.state.candidates[0].name === 'missing-ranking' && incompleteRankings
						? { candidate_0_fit: { type: 'score', score: 3, confidence: 0.9 } }
						: {
								candidate_0_fit: {
									type: 'score',
									score: query.state.dismissedMods.some((mod) => mod.name === 'cold-mod') ? 1.5 : 3,
									confidence: 0.9
								},
								candidate_0_novelty: { type: 'score', score: 1.5, confidence: 0.6 },
								candidate_0_integration: { type: 'score', score: 0, confidence: 0.8 }
							}
			});
		}
		if (key.startsWith('/portal/')) {
			if (portalOffline) return send({ error: 'offline' }, 503);
			if (key === '/portal/get-download/2.1.20/headless/linux64') {
				response.writeHead(200, { 'content-type': 'application/x-xz' });
				response.end(factorioArchive);
				return;
			}
			if (key === '/portal/get-download/2.1.21/headless/linux64') {
				if (setupDownloadOffline) return send({ error: 'offline' }, 503);
				response.writeHead(200, { 'content-type': 'application/x-xz' });
				response.end(experimentalArchive);
				return;
			}
			if (key === '/portal/api/search') {
				let body = '';
				for await (const chunk of request) body += chunk;
				const query = JSON.parse(body);
				if (query.token === 'rejected') return send({ error: 'invalid credentials' }, 401);
				assert.equal(query.version, '2.1.0');
				assert.equal(query.sort_attribute, 'relevancy');
				return send({
					results: [
						{
							name: `search-${query.page}`,
							title: 'Solar fixture',
							owner: 'fixture',
							latest_release: 'opaque-release-id',
							latest_release_version: '1.0.0',
							factorio_versions: ['2.1', '2.0']
						}
					],
					pagination: { page: query.page, page_count: 2, page_size: 30, count: 31 }
				});
			}
			if (key === '/portal/api/latest-releases') {
				releasesStarted?.resolve();
				if (blockReleases) await blockReleases.promise;
				return send({ stable: { headless: '2.1.20' }, experimental: { headless: '2.1.21' } });
			}
			if (key === '/portal/api/bookmarks') return send(['root-mod', 'dependency']);
			if (key.startsWith('/portal/download/')) {
				downloadStarted?.();
				if (blockDownload) await blockDownload;
				response.end(archive);
				return;
			}
			const name = decodeURIComponent(key.split('/')[4] ?? '');
			if (metadata.has(name)) return send(metadata.get(name));
			return send({ error: 'missing' }, 404);
		}
		return send({ error: 'unknown fixture path' }, 404);
	} catch (cause) {
		response.writeHead(500);
		response.end(String(cause));
	}
});
fixture.listen(0, '127.0.0.1');
await once(fixture, 'listening');
const fixtureUrl = `http://127.0.0.1:${fixture.address().port}`;
const childEnv = {
	PATH: `${join(directory, 'bin')}:${process.env.PATH}`,
	FACMANDU_SERVER_DIRECTORY: join(directory, 'servers'),
	NODE_ENV: 'production',
	DATABASE_URL: `file:${database}`,
	TURSO_CONNECTION_URL: `file:${database}`,
	TURSO_AUTH_TOKEN: '',
	FACMANDU_CACHE_DIR: cache,
	FACMANDU_REPLICA_PATH: '',
	FACMANDU_OPERATOR_USER_IDS: 'owner',
	FACMANDU_TYPESAFE_API_KEY: 'must-not-use-global-key',
	TYPESAFE_API_KEY: 'unused-fallback-key',
	HOST: '127.0.0.1',
	PORT: '0',
	ORIGIN: origin,
	SHUTDOWN_TIMEOUT: '1'
};
let app;
let appUrl;
let logs = '';
let client;
async function command(executable, args) {
	const child = spawn(executable, args, {
		cwd: directory,
		env: childEnv,
		stdio: ['ignore', 'pipe', 'pipe']
	});
	let output = '';
	child.stdout.on('data', (chunk) => {
		output += chunk;
	});
	child.stderr.on('data', (chunk) => {
		output += chunk;
	});
	const [code] = await once(child, 'exit');
	assert.equal(code, 0, `${executable} failed: ${output}`);
	return output;
}
async function start() {
	const bootstrap = join(directory, 'server.mjs');
	await writeFile(
		bootstrap,
		`
const nativeFetch = globalThis.fetch;
globalThis.fetch = (input, init) => {
 const url = new URL(input instanceof Request ? input.url : input);
 if (url.hostname === 'mods.factorio.com' || url.hostname === 'factorio.com') return nativeFetch(${JSON.stringify(fixtureUrl)} + '/portal' + url.pathname + url.search, init);
 if (url.hostname === 'auth.openai.com') return nativeFetch(${JSON.stringify(fixtureUrl)} + '/openai' + url.pathname, init);
 if (url.hostname === 'chatgpt.com') return nativeFetch(${JSON.stringify(fixtureUrl)} + '/codex' + url.pathname + url.search, init);
 if (url.hostname === 'api.typesafe.ai') return nativeFetch(${JSON.stringify(fixtureUrl)} + '/typesafe' + url.pathname, init);
 if (url.hostname === '127.0.0.1') return nativeFetch(input, init);
 throw new Error('Integration test blocked external request to ' + url.hostname);
};
const {server} = await import(${JSON.stringify(pathToFileURL(join(root, 'build/index.js')).href)});
const ready = () => console.info('TEST_READY:' + server.server.address().port);
if (server.server.listening) ready(); else server.server.once('listening', ready);
`
	);
	app = spawn(process.execPath, [bootstrap], {
		cwd: directory,
		env: childEnv,
		stdio: ['ignore', 'pipe', 'pipe']
	});
	logs = '';
	app.stderr.on('data', (chunk) => {
		logs += chunk;
	});
	await new Promise((resolveReady, reject) => {
		app.once('exit', (code) => reject(new Error(`App exited ${code}: ${logs}`)));
		app.stdout.on('data', (chunk) => {
			logs += chunk;
			const match = logs.match(/TEST_READY:(\d+)/u);
			if (match) {
				appUrl = `http://127.0.0.1:${match[1]}`;
				resolveReady();
			}
		});
	});
}
async function stop() {
	if (!app || app.exitCode !== null) return;
	const finished = once(app, 'exit');
	app.kill('SIGTERM');
	await finished;
	app = undefined;
}
function request(path, { cookie = '', method = 'GET', form, body } = {}) {
	const headers = { Origin: origin, Cookie: cookie, Accept: 'text/html' };
	if (form) {
		headers['content-type'] = 'application/x-www-form-urlencoded';
		body = new URLSearchParams(form);
	} else if (body) {
		headers['content-type'] = 'application/json';
		body = JSON.stringify(body);
	}
	return fetch(`${appUrl}${path}`, { method, headers, body, redirect: 'manual' });
}
async function json(path, options) {
	const response = await request(path, options);
	assert.ok(response.ok, `${path}: ${response.status} ${await response.clone().text()}`);
	return response.json();
}
async function action(path, cookie, form, expected = 200) {
	const response = await request(path, { cookie, method: 'POST', form });
	assert.equal(response.status, expected, `${path}: ${await response.clone().text()}`);
	return response;
}
async function until(path, cookie, done) {
	const deadline = Date.now() + 10_000;
	while (Date.now() < deadline) {
		const value = await json(path, { cookie });
		if (done(value)) return value;
	}
	throw new Error(`Timed out waiting for ${path}: ${logs}`);
}
let checks = 0;
function passed(message) {
	checks++;
	console.info(`✓ ${message}`);
}
try {
	const legacy = createClient({ url: `file:${database}` });
	await legacy.executeMultiple(await readFile(join(root, 'src/lib/server/db/initial.sql'), 'utf8'));
	await legacy.execute(
		"INSERT INTO user (id, username, password_hash) VALUES ('legacy-luan', 'luan', 'unusable-fixture-password')"
	);
	legacy.close();
	await start();
	const initialized = await fetch(`${appUrl}/login`);
	assert.equal(initialized.status, 200, await initialized.text());
	client = createClient({ url: `file:${database}`, timeout: 1000 });
	assert.equal(
		(await client.execute("SELECT is_admin FROM user WHERE username = 'luan'")).rows[0].is_admin,
		1
	);
	await client.execute("UPDATE user SET is_admin = 0 WHERE username = 'luan'");
	const passwordHash = await hash('fixture-password', {
		memoryCost: 19456,
		timeCost: 2,
		outputLen: 32,
		parallelism: 1
	});
	for (const id of ['owner', 'viewer', 'stranger'])
		await client.execute({
			sql: 'INSERT INTO user (id, username, password_hash, factorio_username, factorio_token) VALUES (?, ?, ?, ?, ?)',
			args: [id, id, passwordHash, 'fixture', 'fixture-token']
		});
	for (const [key, data] of metadata) {
		if (key === 'cold-mod') continue;
		await client.execute({
			sql: 'INSERT INTO portal_cache (key, body, status, fetched_at, retry_after) VALUES (?, ?, 200, ?, 0)',
			args: [`mod:${key}`, JSON.stringify(data), Date.now()]
		});
	}
	await mkdir(join(cache, 'mods'), { recursive: true });
	for (const name of ['root-mod', 'dependency', longName])
		await writeFile(join(cache, 'mods', `${name}_1.0.0_${sha1}.zip`), archive);
	await client.execute(
		"UPDATE user SET is_admin = 1, typesafe_api_key = 'fixture-typesafe-key' WHERE id = 'owner'"
	);
	const cookies = {};
	for (const id of ['owner', 'viewer', 'stranger']) {
		const result = await action('/login', '', { username: id, password: 'fixture-password' }, 303);
		cookies[id] = result.headers.get('set-cookie').split(';')[0];
		assert.match(result.headers.get('set-cookie'), /HttpOnly/iu);
		assert.match(result.headers.get('set-cookie'), /Secure/iu);
	}
	await action('/login', '', { username: 'owner', password: 'wrong-password' }, 400);
	await action('/login', '', { username: 'owner', password: 'x'.repeat(20_000) }, 413);
	assert.equal(
		(await request('/login', { method: 'POST', body: { username: 'owner' } })).status,
		415
	);
	const oversizedStream = new ReadableStream({
		start(controller) {
			controller.enqueue(new TextEncoder().encode(`username=owner&password=${'x'.repeat(20_000)}`));
			controller.close();
		}
	});
	const oversized = await fetch(`${appUrl}/register`, {
		method: 'POST',
		headers: {
			Origin: origin,
			Accept: 'text/html',
			'Content-Type': 'application/x-www-form-urlencoded'
		},
		body: oversizedStream,
		duplex: 'half'
	});
	assert.equal(oversized.status, 413, `${oversized.url}: ${(await oversized.text()).slice(-1200)}`);
	const loginPage = await request('/login');
	const scriptPolicy = loginPage.headers
		.get('content-security-policy')
		.match(/script-src ([^;]+)/u)?.[1];
	assert.ok(scriptPolicy?.includes("'self'"));
	assert.ok(!scriptPolicy.includes('unsafe-inline'));
	const nonce = scriptPolicy.match(/'nonce-([^']+)'/u)?.[1];
	assert.ok(nonce);
	assert.ok((await loginPage.text()).includes(`nonce="${nonce}"`));

	const newInvite = async () => {
		const response = await action('/admin?/invite', cookies.owner, {});
		const html = await response.text();
		const code = html.match(/<code[^>]*>([a-zA-Z0-9_-]{32})/u)?.[1];
		assert.ok(code, 'admin receives the raw code exactly once');
		return code;
	};
	assert.equal((await request('/admin', { cookie: cookies.viewer })).status, 403);
	await action('/admin?/invite', cookies.viewer, {}, 403);
	await action('/admin?/role', cookies.viewer, { id: 'viewer', admin: 'true' }, 403);
	await action('/admin?/role', cookies.owner, { id: 'owner', admin: 'false' }, 409);
	await action(
		'/register',
		'',
		{ username: 'no-invite', password: 'fixture-password', confirm: 'fixture-password' },
		400
	);
	const invitation = await newInvite();
	await action(
		'/register',
		'',
		{
			username: 'owner',
			password: 'fixture-password',
			confirm: 'fixture-password',
			invite: invitation
		},
		400
	);
	const registered = await action(
		'/register?redirectTo=//evil.invalid',
		'',
		{
			username: 'new-user',
			password: 'fixture-password',
			confirm: 'fixture-password',
			invite: invitation
		},
		303
	);
	assert.equal(registered.headers.get('location'), '/');
	await action(
		'/register',
		'',
		{
			username: 'reuse-user',
			password: 'fixture-password',
			confirm: 'fixture-password',
			invite: invitation
		},
		400
	);
	const concurrentCode = await newInvite();
	const concurrent = await Promise.all(
		['racer-one', 'racer-two'].map((username) =>
			request('/register', {
				method: 'POST',
				form: {
					username,
					password: 'fixture-password',
					confirm: 'fixture-password',
					invite: concurrentCode
				}
			})
		)
	);
	assert.deepEqual(concurrent.map((response) => response.status).sort(), [303, 400]);
	const revokedCode = await newInvite();
	const invitationHash = createHash('sha256').update(revokedCode).digest('hex');
	await action('/admin?/revoke', cookies.owner, { id: invitationHash });
	await action(
		'/register',
		'',
		{
			username: 'revoked-user',
			password: 'fixture-password',
			confirm: 'fixture-password',
			invite: revokedCode
		},
		400
	);
	const expiredCode = await newInvite();
	await client.execute({
		sql: 'UPDATE invite SET expires_at = 1 WHERE hash = ?',
		args: [createHash('sha256').update(expiredCode).digest('hex')]
	});
	await action(
		'/register',
		'',
		{
			username: 'expired-user',
			password: 'fixture-password',
			confirm: 'fixture-password',
			invite: expiredCode
		},
		400
	);
	await action('/admin?/role', cookies.owner, { id: 'viewer', admin: 'true' });
	assert.equal((await request('/admin', { cookie: cookies.viewer })).status, 200);
	await action('/admin?/role', cookies.owner, { id: 'viewer', admin: 'false' });
	assert.equal((await request('/admin', { cookie: cookies.viewer })).status, 403);
	await action('/settings?/typesafe', cookies.viewer, { key: 'viewer-separate-key' });
	const accountSettings = await request('/settings', { cookie: cookies.viewer });
	assert.ok(!(await accountSettings.text()).includes('viewer-separate-key'));
	passed(
		'invite-only registration, atomic single-use redemption, role checks, revocation, last-admin protection and secret redaction'
	);

	const codexLogin = async (cookie = '') => {
		const started = await request('/api/auth/codex', {
			cookie,
			method: 'POST',
			form: { operation: 'start' }
		});
		assert.equal(started.status, 200, await started.clone().text());
		assert.equal((await started.json()).code, 'TEST-1234');
		const pendingCookie = started.headers
			.getSetCookie()
			.find((value) => value.startsWith('codex-login='))
			.split(';')[0];
		const both = [cookie, pendingCookie].filter(Boolean).join('; ');
		await until('/api/auth/codex', both, (value) => value.ready);
		return both;
	};
	const linkedCookie = await codexLogin(cookies.owner);
	await action('/api/auth/codex', linkedCookie, { operation: 'finish' });
	const linked = (
		await client.execute("SELECT codex_subject, codex_credentials FROM user WHERE id = 'owner'")
	).rows[0];
	assert.equal(linked.codex_subject, 'fixture-openai-owner');
	assert.ok(linked.codex_credentials.includes('fixture-refresh-secret'));
	const linkedPage = await request('/settings', { cookie: cookies.owner });
	assert.ok(!(await linkedPage.text()).includes('fixture-refresh-secret'));
	const returning = await codexLogin();
	const signedIn = await action('/api/auth/codex', returning, { operation: 'finish' });
	assert.ok(signedIn.headers.get('set-cookie').includes('auth-session='));
	oauthSubject = 'fixture-openai-second-person'; // Same workspace, distinct human identity.
	const newCodex = await codexLogin();
	await action('/api/auth/codex', newCodex, { operation: 'finish' }, 400);
	const oauthInvite = await newInvite();
	await action('/api/auth/codex', newCodex, {
		operation: 'finish',
		username: 'codex-person',
		invite: oauthInvite
	});
	assert.equal(
		(await client.execute("SELECT is_admin FROM user WHERE username = 'codex-person'")).rows[0]
			.is_admin,
		0
	);
	await action('/login', '', { username: 'codex-person', password: 'fixture-password' }, 400);
	assert.equal(
		(await client.execute('SELECT count(*) as count FROM user WHERE codex_subject IS NOT NULL'))
			.rows[0].count,
		2
	);
	passed(
		'Codex device sign-in, account linking, invite enforcement, workspace identity isolation and credential redaction'
	);
	const cold = await Promise.all(
		Array.from({ length: 8 }, () => json('/api/factorio-mods/cold-mod'))
	);
	assert.ok(cold.every((value) => value.name === 'cold-mod'));
	assert.equal(calls.get('/portal/api/mods/cold-mod/full'), 1);
	await json('/api/factorio-mods/cold-mod');
	assert.equal(calls.get('/portal/api/mods/cold-mod/full'), 2);
	passed('concurrent metadata requests deduplicate and a later user open refreshes the catalog');
	metadata.set('cache-write-outage', catalog('cache-write-outage', '1.0.0'));
	await client.execute(`CREATE TRIGGER reject_cache_insert BEFORE INSERT ON portal_cache
		WHEN NEW.key = 'mod:cache-write-outage'
		BEGIN SELECT RAISE(ABORT, 'fixture cache write outage'); END`);
	assert.equal((await json('/api/factorio-mods/cache-write-outage')).name, 'cache-write-outage');
	assert.equal((await json('/api/factorio-mods/cache-write-outage')).name, 'cache-write-outage');
	assert.equal(calls.get('/portal/api/mods/cache-write-outage/full'), 2);
	await client.execute('DROP TRIGGER reject_cache_insert');
	passed('portal results remain usable when cache writes fail');

	const imported = await action(
		'/modlists/new',
		cookies.owner,
		{
			name: 'Integration list',
			factorioVersion: '2.1',
			json: JSON.stringify({
				mods: [
					{ name: 'base', enabled: true },
					{ name: 'root-mod', enabled: true, version: '1.0.0' },
					{ name: longName, enabled: true, version: '1.0.0' }
				]
			})
		},
		303
	);
	const listPath = imported.headers.get('location');
	const listId = listPath.split('/').at(-1);
	fixturePlanListId = listId;
	assert.match(listPath, /^\/modlists\/modlist-/u);
	assert.equal(
		(
			await client.execute({
				sql: 'SELECT version FROM mod WHERE modlist_id = ? AND name = ?',
				args: [listId, 'root-mod']
			})
		).rows[0].version,
		'1.0.0'
	);
	await json(`/api/modlists/${listId}/repair`, { cookie: cookies.owner, method: 'POST' });
	const repair = await until(
		`/api/modlists/${listId}/repair`,
		cookies.owner,
		(value) => value?.state !== 'running'
	);
	assert.equal(repair.state, 'done');
	assert.deepEqual(repair.issues, []);
	assert.equal(repair.dependenciesAdded, 1);
	assert.equal(repair.networkRequests, 0);
	const rows = (
		await client.execute({
			sql: 'SELECT name, enabled, version, title, auto_dependency FROM mod WHERE modlist_id = ?',
			args: [listId]
		})
	).rows;
	assert.equal(rows.length, 3);
	assert.ok(rows.every((row) => row.enabled === 1 && row.version === '1.0.0' && row.title));
	assert.equal(rows.find((row) => row.name === 'dependency').auto_dependency, 1);
	await json(`/api/modlists/${listId}/repair`, { cookie: cookies.owner, method: 'POST' });
	const secondRepair = await until(
		`/api/modlists/${listId}/repair`,
		cookies.owner,
		(value) => value?.state !== 'running'
	);
	assert.deepEqual(secondRepair, repair);
	assert.equal(secondRepair.networkRequests, 0);
	await action(`${listPath}?/removeMod`, cookies.owner, { modName: 'dependency' }, 400);
	passed(
		'imports preserve pins; repair fills metadata and dependencies from cache, is idempotent and protects required mods'
	);
	await action(`${listPath}?/setFactorioVersion`, cookies.owner, { version: '2.0' });
	const incompatible = await until(
		`/api/modlists/${listId}/repair`,
		cookies.owner,
		(value) => value?.state !== 'running'
	);
	assert.equal(incompatible.state, 'done');
	assert.ok(incompatible.issues.length >= 3);
	assert.equal(incompatible.networkRequests, 3);
	assert.equal(incompatible.metadataUpdated, 0);
	assert.deepEqual(
		(
			await client.execute({
				sql: 'SELECT name, enabled, version, title, auto_dependency FROM mod WHERE modlist_id = ?',
				args: [listId]
			})
		).rows,
		rows
	);
	await action(`${listPath}?/setFactorioVersion`, cookies.owner, { version: '2.1' });
	const compatible = await until(
		`/api/modlists/${listId}/repair`,
		cookies.owner,
		(value) => value?.state !== 'running'
	);
	assert.deepEqual(compatible.issues, []);
	assert.equal(compatible.metadataUpdated, 0);
	assert.equal(compatible.networkRequests, 0);
	passed('changing compatibility rechecks mismatched catalogs without changing pins');
	await action(`/modlists/${listId}?/addIceboxMod`, cookies.owner, { modName: 'cold-mod' });
	const savedForLater = (
		await client.execute({
			sql: 'SELECT id, enabled, icebox FROM mod WHERE modlist_id = ? AND name = ?',
			args: [listId, 'cold-mod']
		})
	).rows[0];
	assert.equal(savedForLater.enabled, 0);
	assert.equal(savedForLater.icebox, 1);
	await action(`/modlists/${listId}?/addMod`, cookies.owner, { modName: 'cold-mod' });
	const activated = (
		await client.execute({
			sql: 'SELECT enabled, icebox, updated_by FROM mod WHERE id = ?',
			args: [savedForLater.id]
		})
	).rows[0];
	assert.equal(activated.enabled, 1);
	assert.equal(activated.icebox, 0);
	assert.equal(activated.updated_by, 'owner');
	await action(`/modlists/${listId}?/removeMod`, cookies.owner, { modName: 'cold-mod' });
	await until(
		`/api/modlists/${listId}/repair`,
		cookies.owner,
		(value) => value.state !== 'running'
	);
	passed('activating a saved mod enables it and schedules dependency repair');

	assert.equal((await request(listPath, { cookie: cookies.stranger })).status, 403);
	assert.equal(
		(await request(`/api/modlists/${listId}/repair`, { cookie: cookies.stranger, method: 'POST' }))
			.status,
		403
	);
	await action(`${listPath}?/shareAdd`, cookies.owner, { username: 'viewer' });
	assert.equal((await request(listPath, { cookie: cookies.viewer })).status, 200);
	await action(`${listPath}?/sharePublic`, cookies.owner, { enabled: 'true' });
	assert.equal((await request(listPath)).status, 200);
	assert.equal((await request(`/api/modlists/${listId}/export`, { method: 'POST' })).status, 401);
	const activityAbort = new AbortController();
	const activityResponse = await fetch(`${appUrl}/api/activity`, {
		headers: { Cookie: cookies.viewer },
		signal: activityAbort.signal
	});
	const activityReader = activityResponse.body.getReader();
	await activityReader.read();
	await action(`${listPath}?/shareRemove`, cookies.owner, { userId: 'viewer' });
	let accessEvent = '';
	while (!accessEvent.includes('event: permissions')) {
		const { value, done } = await activityReader.read();
		assert.equal(done, false);
		accessEvent += new TextDecoder().decode(value);
	}
	assert.ok(accessEvent.includes(listId));
	activityAbort.abort();
	assert.equal(
		(await request(`/api/modlists/${listId}/repair`, { cookie: cookies.viewer, method: 'POST' }))
			.status,
		403
	);
	passed('private lists, collaboration, public read-only access and export permissions');
	metadata.set('agent-addon', catalog('agent-addon', '1.0.0', ['base >= 2.0']));
	const assistantPath = `/api/modlists/${listId}/assistant`;
	assert.equal((await request(assistantPath, { cookie: cookies.stranger })).status, 403);
	const assistantCatalog = await json(assistantPath, { cookie: cookies.owner });
	assert.deepEqual(
		assistantCatalog.models.map((model) => model.id),
		['gpt-6-astra', 'gpt-6-sol', 'gpt-6-luna']
	);
	assert.equal(assistantCatalog.model, 'gpt-6-astra');
	const listHistory = await json(`${assistantPath}?models=0`, { cookie: cookies.owner });
	assert.equal(listHistory.chat.id, assistantCatalog.chat.id);
	const voiceForm = { chat: assistantCatalog.chat.id, listId, sdp: 'v=0\r\nfixture-offer' };
	assert.equal(
		(await request('/api/assistant/voice', { method: 'POST', form: voiceForm })).status,
		401
	);
	await action('/api/assistant/voice', cookies.stranger, voiceForm, 403);
	await action('/api/assistant/voice', cookies.viewer, voiceForm, 403);
	await action('/api/assistant/voice', cookies.owner, { ...voiceForm, chat: 'missing-chat' }, 404);
	await action(
		'/api/assistant/voice',
		cookies.owner,
		{ ...voiceForm, sdp: `v=0${'x'.repeat(17000)}` },
		413
	);
	await action(
		'/api/assistant/voice',
		cookies.owner,
		{ ...voiceForm, serverId: 'other-target' },
		400
	);
	const voiceReply = await request('/api/assistant/voice', {
		cookie: cookies.owner,
		method: 'POST',
		form: voiceForm
	});
	assert.equal(voiceReply.status, 200);
	assert.equal(voiceReply.headers.get('cache-control'), 'no-store');
	assert.equal(
		voiceReply.headers.get('permissions-policy'),
		'camera=(), microphone=(self), geolocation=()'
	);
	assert.equal(await voiceReply.text(), 'v=0\r\nfixture-voice-answer');
	passed('voice SDP setup uses private chats, bounded input and server-owned Codex credentials');

	assert.equal('models' in listHistory, false);
	await action(assistantPath, cookies.owner, { prompt: 'test', model: 'hidden-model' }, 400);
	const statusReply = await request(assistantPath, {
		cookie: cookies.owner,
		method: 'POST',
		form: { prompt: 'Show list status' }
	});
	assert.ok((await statusReply.text()).includes('enabled'));
	const agentReply = await request(assistantPath, {
		cookie: cookies.owner,
		method: 'POST',
		form: { prompt: 'fixture-plan: add agent-addon', model: 'gpt-6-sol', effort: 'high' }
	});
	const agentText = await agentReply.text();
	assert.ok(
		agentText.includes('Fixture contextual explanation'),
		agentText +
			'\n' +
			JSON.stringify(await json(assistantPath, { cookie: cookies.owner })) +
			'\nmodel calls: ' +
			JSON.stringify([...calls].filter(([key]) => key.startsWith('/codex/')))
	);
	const conversation = await json(assistantPath, { cookie: cookies.owner });
	assert.equal(conversation.model, 'gpt-6-sol');
	assert.deepEqual([...new Set(requestedModels)], ['gpt-6-sol']);
	assert.equal(calls.get('/codex/backend-api/codex/models'), 1);
	assert.equal(conversation.plans.length, 1, JSON.stringify(conversation));
	assert.ok(conversation.plans[0].changes.some((change) => change.includes('agent-addon')));
	const planId = conversation.plans[0].id;
	const cardsReply = await request(assistantPath, {
		cookie: cookies.owner,
		method: 'POST',
		form: { prompt: 'fixture-cards: explain agent-addon', model: 'gpt-6-astra', effort: 'max' }
	});
	const cardsText = await cardsReply.text();
	assert.ok(cardsText.includes('"mods":'), `${cardsText}\n${JSON.stringify(codexMenus.slice(-3))}`);
	const cardsConversation = await json(assistantPath, { cookie: cookies.owner });
	assert.equal(cardsConversation.model, 'gpt-6-astra');
	assert.equal(cardsConversation.effort, 'max');
	const shownMods = cardsConversation.turns.find((turn) =>
		turn.prompt.startsWith('fixture-cards')
	).mods;
	assert.equal(shownMods[0].name, 'agent-addon');
	assert.equal(shownMods[0].version, '1.0.0');
	assert.equal(shownMods[0].enabled, false);
	const followupReply = await request(assistantPath, {
		cookie: cookies.owner,
		method: 'POST',
		form: { prompt: 'fixture-followup: explain briefly', model: 'gpt-6-sol', effort: 'medium' }
	});
	const followupText = await followupReply.text();
	assert.ok(followupText.includes('Fixture contextual explanation'), followupText);
	assert.ok(!followupText.includes('"mods":'), 'Prior mod cards must not replay into a new reply');
	const followupConversation = await json(assistantPath, { cookie: cookies.owner });
	assert.deepEqual(
		followupConversation.turns.find((turn) => turn.prompt.startsWith('fixture-followup')).mods,
		[]
	);
	const followupRoute = routingQueries.find((query) =>
		query.state.request.startsWith('fixture-followup')
	);
	assert.ok(followupRoute, 'Jev routed the follow-up');
	assert.ok(
		followupRoute.state.recent.some((turn) => turn.prompt.startsWith('fixture-cards')),
		'Jev receives recent turns from this chat'
	);
	assert.equal(followupRoute.questions.discover.type, 'noul');
	assert.equal(followupRoute.questions.changes.type, 'noul');
	const planMenu = codexMenus.find((menu) => menu.request.includes('User request: fixture-plan'));
	assert.ok(planMenu.tools.includes('prepare_changes'));
	assert.ok(
		!planMenu.tools.includes('search_mods'),
		'A list change starts with a narrow tool menu'
	);
	await action(assistantPath, cookies.owner, { operation: 'prepare', name: 'agent-addon' });
	passed(
		'account model discovery, per-list model selection, shared conversation and native mod cards'
	);

	await action(`${listPath}?/shareAdd`, cookies.owner, { username: 'viewer' });
	await action(assistantPath, cookies.viewer, { operation: 'apply', plan: planId }, 409);
	await action(`${listPath}?/shareRemove`, cookies.owner, { userId: 'viewer' });
	await action(`${listPath}?/updateModlistName`, cookies.owner, {
		name: 'Changed while reviewing'
	});
	await action(assistantPath, cookies.owner, { operation: 'apply', plan: planId }, 409);
	await action(`${listPath}?/updateModlistName`, cookies.owner, { name: 'Integration list' });
	await action(assistantPath, cookies.owner, { operation: 'apply', plan: planId });
	await action(assistantPath, cookies.owner, { operation: 'apply', plan: planId });
	assert.equal(
		(
			await client.execute({
				sql: 'SELECT count(*) as count FROM mod WHERE modlist_id = ? AND name = ? AND enabled = 1',
				args: [listId, 'agent-addon']
			})
		).rows[0].count,
		1
	);
	await action(`${listPath}?/removeMod`, cookies.owner, { modName: 'agent-addon' });
	passed(
		'Jev status routing, Flue tools, contextual explanations, reviewed changes, actor isolation and idempotent apply'
	);

	const searchPath = `/api/modlists/${listId}/search?q=solar&version=2.1`;
	const search = await json(searchPath, { cookie: cookies.owner });
	assert.equal(search.results[0].latest_release_version, '1.0.0');
	assert.deepEqual(search.results[0].factorio_versions, ['2.1', '2.0']);
	assert.equal(search.totalPages, 2);
	await json(searchPath, { cookie: cookies.owner });
	assert.equal(calls.get('/portal/api/search'), 1);
	const nextPage = await json(`${searchPath}&page=2`, { cookie: cookies.owner });
	assert.equal(nextPage.currentPage, 2);
	assert.equal(nextPage.results[0].name, 'search-2');
	assert.equal(calls.get('/portal/api/search'), 2);
	await client.execute("UPDATE user SET factorio_token = 'rejected' WHERE id = 'owner'");
	const rejectedSearch = searchPath.replace('q=solar', 'q=credential-check');
	const rejectedResponse = await request(rejectedSearch, { cookie: cookies.owner });
	assert.equal(rejectedResponse.status, 401);
	assert.match((await rejectedResponse.json()).message, /Reconnect your account/u);
	const searchRequests = calls.get('/portal/api/search');
	assert.equal((await request(rejectedSearch, { cookie: cookies.owner })).status, 401);
	assert.equal(calls.get('/portal/api/search'), searchRequests);
	await client.execute("UPDATE user SET factorio_token = 'fixture-token' WHERE id = 'owner'");
	assert.equal((await json(rejectedSearch, { cookie: cookies.owner })).results[0].name, 'search-1');
	passed(
		'search normalizes portal responses, caches pages and isolates credential failure cooldowns'
	);

	const serverResult = await action('/servers/new', cookies.owner, { name: 'Fixture server' }, 303);
	const serverPath = serverResult.headers.get('location').split('?')[0];
	const serverId = serverPath.split('/').at(-1);
	const firstPorts = (
		await client.execute({
			sql: 'SELECT game_port, rcon_port FROM native_server WHERE id = ?',
			args: [serverId]
		})
	).rows[0];
	for (const tab of ['console', 'mods', 'saves', 'settings', 'access']) {
		const page = await request(`${serverPath}?tab=${tab}`, { cookie: cookies.owner });
		assert.equal(page.status, 200);
		const html = await page.text();
		assert.match(html, new RegExp(`role="status" aria-label="Loading ${tab}"`));
		assert.match(html, /aria-busy="true"/u);
	}
	passed('server sections render a loading layout before JavaScript or instance data arrives');
	const automaticServer = await action(
		'/servers/new',
		cookies.owner,
		{ name: 'Automatic ports' },
		303
	);
	const automaticId = automaticServer.headers.get('location').split('?')[0].split('/').at(-1);
	const automaticPorts = (
		await client.execute({
			sql: 'SELECT game_port, rcon_port FROM native_server WHERE id = ?',
			args: [automaticId]
		})
	).rows[0];
	assert.notEqual(automaticPorts.game_port, firstPorts.game_port);
	assert.notEqual(automaticPorts.rcon_port, firstPorts.rcon_port);
	await client.execute({ sql: 'DELETE FROM native_server WHERE id = ?', args: [automaticId] });
	const secondServer = await action(
		'/servers/new',
		cookies.owner,
		{
			name: 'Second server',
			gamePort: String(automaticPorts.game_port),
			rconPort: String(automaticPorts.rcon_port)
		},
		303
	);
	const secondPath = secondServer.headers.get('location').split('?')[0];
	assert.equal((await request(`${serverPath}/data`, { cookie: cookies.stranger })).status, 403);
	await action(
		'/servers/new',
		cookies.owner,
		{
			name: 'Duplicate',
			gamePort: String(firstPorts.game_port),
			rconPort: String(firstPorts.rcon_port)
		},
		409
	);
	for (const path of [serverPath, secondPath]) {
		const id = path.split('/').at(-1);
		const dir = join(directory, 'servers', id);
		machineDirs.push(dir);
		await mkdir(join(dir, 'versions/stable/2.1.20/bin/x64'), { recursive: true });
		await mkdir(join(dir, 'versions/stable/2.1.20/data/base'), { recursive: true });
		await writeFile(join(dir, 'versions/stable/2.1.20/bin/x64/factorio'), 'fixture');
		await writeFile(
			join(dir, 'versions/stable/2.1.20/data/base/info.json'),
			JSON.stringify({ name: 'base', version: '2.1.20', dependencies: [] })
		);
		const config = JSON.parse(await readFile(join(dir, 'facmandu.json'), 'utf8'));
		await writeFile(
			join(dir, 'facmandu.json'),
			JSON.stringify({
				...config,
				version: { branch: 'stable', version: '2.1.20' },
				account: { username: 'fixture', token: 'fixture-token' }
			})
		);
		await writeFile(
			join(dir, 'config/server-settings.json'),
			JSON.stringify({
				name: 'Fixture',
				max_players: 10,
				token: 'must-not-leak',
				integration: { token: 'must-not-leak', enabled: true },
				visibility: { public: false, lan: true }
			})
		);
		await writeFile(
			join(dir, 'logs/server.log'),
			Array.from({ length: 2500 }, (_, i) => `fixture log ${i}\n`).join('')
		);
	}

	blockReleases = Promise.withResolvers();
	releasesStarted = Promise.withResolvers();
	const pendingReleases = json(`${serverPath}/releases`, { cookie: cookies.owner });
	await releasesStarted.promise;
	const settings = await json(`${serverPath}/data?tab=settings`, { cookie: cookies.owner });
	assert.equal(settings.versions.installed.stable[0], '2.1.20');
	assert.deepEqual(settings.versions.available, {});
	assert.ok(!JSON.stringify(settings).includes('must-not-leak'));
	assert.ok(!settings.settingFields.some((field) => field.key === 'integration'));
	blockReleases.resolve();
	blockReleases = undefined;
	assert.equal((await pendingReleases).data.stable.headless, '2.1.20');
	await json(`${serverPath}/releases`, { cookie: cookies.owner });
	await json(`${serverPath}/data?tab=settings&fresh=1`, { cookie: cookies.owner });
	assert.equal(calls.get('/portal/api/latest-releases'), 1);
	const settingForm = Object.fromEntries(
		settings.settingFields.map((field) => [`setting:${field.key}`, field.value])
	);
	await action(
		`${serverPath}?/manage`,
		cookies.owner,
		{
			...settingForm,
			operation: 'saveSettingsForm',
			'setting:visibility': JSON.stringify({ public: true, token: 'injected' })
		},
		400
	);
	await action(
		`${serverPath}?/manage`,
		cookies.owner,
		{
			operation: 'saveSettings',
			settings: JSON.stringify({ integration: { enabled: false } })
		},
		400
	);
	await action(`${serverPath}?/manage`, cookies.owner, {
		...settingForm,
		operation: 'saveSettingsForm',
		'setting:name': 'Changed fixture'
	});
	assert.equal((await readState(0, 'config/server-settings.json')).name, 'Changed fixture');
	assert.equal(
		(await readState(0, 'config/server-settings.json')).integration.token,
		'must-not-leak'
	);
	await action(`${serverPath}?/manage`, cookies.owner, {
		operation: 'saveSettings',
		settings: JSON.stringify({ max_players: 20 })
	});
	assert.equal((await readState(0, 'config/server-settings.json')).max_players, 20);
	assert.equal((await readState(0, 'config/server-settings.json')).token, 'must-not-leak');
	const settingsFile = join(machineDirs[0], 'mods/mod-settings.dat');
	const nativeSettings = updateModSettingValues(createModSettings('2.1.20.4'), {
		startup: { flag: true, untouched: 'keep' },
		'runtime-global': { speed: 1.5 },
		'runtime-per-user': { tint: { r: 0.1, g: 0.2, b: 0.3, a: 1 } }
	});
	await writeFile(settingsFile, encodeModSettings(nativeSettings));
	const nativeView = await json(`${serverPath}/data?tab=settings`, { cookie: cookies.owner });
	assert.equal(JSON.parse(nativeView.modSettings).startup.flag.value, true);
	await action(`${serverPath}?/manage`, cookies.owner, {
		operation: 'saveModSettings',
		modSettings: JSON.stringify({ startup: { flag: { value: false } } })
	});
	const updatedNative = decodeModSettings(await readFile(settingsFile));
	assert.deepEqual(updatedNative.version, [2, 1, 20, 4]);
	assert.deepEqual(getModSettingValues(updatedNative), {
		startup: { flag: false, untouched: 'keep' },
		'runtime-global': { speed: 1.5 },
		'runtime-per-user': { tint: { r: 0.1, g: 0.2, b: 0.3, a: 1 } }
	});
	await action(`${serverPath}?/manage`, cookies.owner, {
		operation: 'saveModSettings',
		modSettings: JSON.stringify({ 'runtime-global': { speed: { value: 2 } } })
	});
	assert.equal(
		getModSettingValues(decodeModSettings(await readFile(settingsFile)))['runtime-global'].speed,
		2
	);
	const updatedBytes = await readFile(settingsFile);
	await action(
		`${serverPath}?/manage`,
		cookies.owner,
		{
			operation: 'saveModSettings',
			modSettings: JSON.stringify({ wrongScope: { flag: { value: true } } })
		},
		400
	);
	assert.deepEqual(await readFile(settingsFile), updatedBytes);
	await writeFile(settingsFile, Buffer.from('damaged settings'));
	await action(
		`${serverPath}?/manage`,
		cookies.owner,
		{
			operation: 'saveModSettings',
			modSettings: JSON.stringify({ startup: { flag: { value: true } } })
		},
		422
	);
	assert.equal((await readFile(settingsFile)).toString(), 'damaged settings');
	await writeFile(settingsFile, updatedBytes);
	passed(
		'native mod settings read, patch, preserve other scopes and reject invalid or damaged data'
	);
	const modCallsBeforeBookmarks = calls.get('/portal/api/mods/root-mod/full') ?? 0;
	const bookmarks = await json(`${serverPath}/bookmarks`, { cookie: cookies.owner });
	assert.deepEqual(bookmarks.names, ['dependency', 'root-mod']);
	await json(`${serverPath}/bookmarks`, { cookie: cookies.owner });
	assert.equal(calls.get('/portal/api/bookmarks'), 1);
	assert.equal(calls.get('/portal/api/mods/root-mod/full') ?? 0, modCallsBeforeBookmarks);
	passed(
		'server connections, access, redaction, cached bookmarks and settings independent of slow release checks'
	);

	await action(
		`${serverPath}?/manage`,
		cookies.owner,
		{ operation: 'rcon', command: 'é'.repeat(501) },
		400
	);
	const logAbort = new AbortController();
	const logStreams = await Promise.all(
		[0, 1].map(() =>
			fetch(`${appUrl}${serverPath}/logs`, {
				headers: { Cookie: cookies.owner },
				signal: logAbort.signal
			})
		)
	);
	const logReaders = logStreams.map((stream) => stream.body.getReader());
	for (const reader of logReaders) {
		let text = '';
		while (!text.includes('fixture log 2499')) {
			const { value, done } = await reader.read();
			assert.equal(done, false);
			text += new TextDecoder().decode(value);
		}
		const packet = text
			.split('\n')
			.filter((line) => line.startsWith('data: '))
			.map((line) => JSON.parse(line.slice(6)))
			.find((value) => value.type === 'lines');
		assert.equal(packet.lines.length, 2000);
		assert.equal(packet.lines[0].text, 'fixture log 500');
		assert.equal(packet.lines.at(-1).text, 'fixture log 2499');
		assert.equal(new Set(packet.lines.map((line) => line.id)).size, 2000);
	}
	await appendFile(join(machineDirs[0], 'logs/server.log'), 'output while disconnected\n');
	let replay = '';
	while (!replay.includes('output while disconnected')) {
		const { value, done } = await logReaders[0].read();
		assert.equal(done, false);
		replay += new TextDecoder().decode(value);
	}
	const recoveredLogs = replay
		.split('\n')
		.filter((line) => line.startsWith('data: '))
		.map((line) => JSON.parse(line.slice(6)))
		.find((packet) => packet.type === 'lines');
	assert.equal(recoveredLogs.lines.length, 1);

	assert.equal(recoveredLogs.lines.at(-1).text, 'output while disconnected');
	logAbort.abort();
	passed(
		'authenticated log streaming reads local files, bounds replay, and enforces RCON byte limits'
	);
	// Save creation returns immediately; its activity event reports completion or failure.
	const saveEventsAbort = new AbortController();
	const saveEvents = await fetch(`${appUrl}/api/activity`, {
		headers: { Cookie: cookies.owner },
		signal: saveEventsAbort.signal
	});
	const saveReader = saveEvents.body.getReader();
	let saveEventsBuffer = '';
	async function saveOutcome() {
		while (true) {
			const boundary = saveEventsBuffer.indexOf('\n\n');
			if (boundary >= 0) {
				const event = saveEventsBuffer.slice(0, boundary);
				saveEventsBuffer = saveEventsBuffer.slice(boundary + 2);
				const line = event.split('\n').find((line) => line.startsWith('data: '));
				if (!line) continue;
				const item = JSON.parse(line.slice(6));
				if (item.task === 'save-create' && item.state !== 'running') return item;
			} else {
				const { value, done } = await saveReader.read();
				assert.equal(done, false);
				saveEventsBuffer += new TextDecoder().decode(value);
			}
		}
	}
	const engine = join(machineDirs[0], 'versions/stable/2.1.20/bin/x64/factorio');
	const nativeData = join(machineDirs[0], 'versions/stable/2.1.20/data');
	await writeFile(
		join(nativeData, 'map-settings.example.json'),
		JSON.stringify({
			pollution: { enabled: true, diffusion_ratio: 0.02 },
			enemy_evolution: { enabled: true, time_factor: 0.000004 },
			enemy_expansion: {
				min_expansion_cooldown: 14400,
				max_expansion_cooldown: 216000,
				settler_group_min_size: 5,
				settler_group_max_size: 20
			}
		})
	);
	await writeFile(join(nativeData, 'map-gen-settings.example.json'), '{}');
	await writeFile(
		join(nativeData, 'fixture-map-catalog.json'),
		JSON.stringify({
			'autoplace-control': {
				'iron-ore': { name: 'iron-ore', category: 'resource', richness: true }
			},
			'map-gen-presets': { default: { name: 'default', default: { default: true, order: 'a' } } }
		})
	);
	const createFixture = `#!/bin/sh
config=''
operation=''
previous=''
for arg in "$@"; do
 [ "$previous" = "--config" ] && config="$arg"
 [ "$arg" = "--dump-data" ] && operation='dump'
 [ "$arg" = "--dump-prototype-locale" ] && operation='locale'
 [ "$arg" = "--help" ] && operation='help'
 previous="$arg"
done
if [ "$operation" = 'help' ]; then printf -- '--generate-map-preview\\n'; exit 0; fi
if [ "$operation" = 'dump' ] || [ "$operation" = 'locale' ]; then
 write=$(sed -n 's/^write-data=//p' "$config")
 mkdir -p "$write/script-output"
 if [ "$operation" = 'dump' ]; then cp "$(dirname "$0")/../../data/fixture-map-catalog.json" "$write/script-output/data-raw-dump.json";
 else printf '{}' > "$write/script-output/autoplace-control-locale.json"; fi
 exit 0
fi
while [ "$#" -gt 0 ]; do
 case "$1" in
  --map-gen-settings) shift; cp "$1" "$(dirname "$0")/../../applied-map-gen.json" ;;
  --map-settings) shift; cp "$1" "$(dirname "$0")/../../applied-map-settings.json" ;;
  --create) shift; printf 'PK\\003\\004fixture' > "$1" ;;
 esac
 shift
done
`;
	await writeFile(engine, createFixture, { mode: 0o755 });
	// Existing fixture files were created without executable mode.
	await import('node:fs/promises').then((fs) => fs.chmod(engine, 0o755));
	const mapGenerationPath = `/api/servers/${serverPath.split('/').at(-1)}/map-generation`;
	assert.equal((await request(mapGenerationPath)).status, 401);
	assert.equal((await request(mapGenerationPath, { cookie: cookies.stranger })).status, 403);
	const generationCatalog = await json(mapGenerationPath, { cookie: cookies.owner });
	assert.deepEqual(
		generationCatalog.resources.map((resource) => resource.name),
		['iron-ore']
	);
	assert.equal(generationCatalog.presets[0].name, 'default');
	assert.equal(
		(
			await fetch(`${appUrl}${mapGenerationPath}/preview`, {
				method: 'POST',
				headers: { Origin: origin, Cookie: cookies.owner, 'content-type': 'application/json' },
				body: '{'
			})
		).status,
		400
	);
	for (const body of [{ settings: { seed: -1 } }, { settings: {} }])
		assert.equal(
			(
				await request(`${mapGenerationPath}/preview`, {
					cookie: cookies.owner,
					method: 'POST',
					body
				})
			).status,
			400
		);
	for (const expansion of [{ minCooldown: 300000 }, { maxGroupSize: 2 }]) {
		const response = await request(`${mapGenerationPath}/preview`, {
			cookie: cookies.owner,
			method: 'POST',
			body: { settings: { seed: 12345, expansion } }
		});
		assert.equal(response.status, 400);
		assert.match(await response.text(), /Minimum expansion/);
	}
	for (const worldGeneration of [
		'{',
		JSON.stringify({ seed: -1 }),
		JSON.stringify({ filename: '../outside.zip' })
	]) {
		await action(
			`${serverPath}?/manage`,
			cookies.owner,
			{
				operation: 'createSave',
				name: 'invalid-world.zip',
				worldGeneration
			},
			400
		);
	}
	await action(`${serverPath}?/manage`, cookies.owner, {
		operation: 'createSave',
		name: 'new-world.zip',
		worldGeneration: JSON.stringify({
			seed: 12345,
			peacefulMode: true,
			evolution: { enabled: false }
		})
	});
	assert.equal((await saveOutcome()).state, 'done');
	const appliedMapGen = await readState(0, 'versions/stable/2.1.20/applied-map-gen.json');
	const appliedMapSettings = await readState(0, 'versions/stable/2.1.20/applied-map-settings.json');
	assert.equal(appliedMapGen.seed, 12345);
	assert.equal(appliedMapGen.peaceful_mode, true);
	assert.equal(appliedMapSettings.enemy_evolution.enabled, false);
	assert.equal(appliedMapSettings.enemy_evolution.time_factor, 0.000004);
	assert.equal(appliedMapSettings.pollution.enabled, true);
	assert.deepEqual(await readdir(join(machineDirs[0], 'saves')), ['new-world.zip']);
	await action(`${serverPath}?/manage`, cookies.owner, {
		operation: 'selectSave',
		name: 'new-world.zip'
	});
	await action(
		`${serverPath}?/manage`,
		cookies.owner,
		{ operation: 'deleteSave', name: 'new-world.zip' },
		409
	);

	await action(
		`${serverPath}?/manage`,
		cookies.owner,
		{ operation: 'renameSave', name: 'new-world.zip', newName: '../escape.zip' },
		400
	);
	await writeFile(join(machineDirs[0], 'saves/taken.zip'), 'existing save');
	await action(
		`${serverPath}?/manage`,
		cookies.owner,
		{ operation: 'renameSave', name: 'new-world.zip', newName: 'taken.zip' },
		409
	);
	assert.equal(await readFile(join(machineDirs[0], 'saves/taken.zip'), 'utf8'), 'existing save');
	await rm(join(machineDirs[0], 'saves/taken.zip'));
	const beforeRename = await readFile(join(machineDirs[0], 'saves/new-world.zip'));
	await action(`${serverPath}?/manage`, cookies.owner, {
		operation: 'renameSave',
		name: 'new-world.zip',
		newName: 'renamed-world.zip'
	});
	assert.deepEqual(await readFile(join(machineDirs[0], 'saves/renamed-world.zip')), beforeRename);
	assert.equal((await readState(0, 'facmandu.json')).save, 'renamed-world.zip');
	assert.equal((await readState(0, 'facmandu.json')).resumeAutosave, false);
	await action(`${serverPath}?/manage`, cookies.owner, { operation: 'resumeSave' });
	assert.equal((await readState(0, 'facmandu.json')).save, 'renamed-world.zip');
	assert.equal((await readState(0, 'facmandu.json')).resumeAutosave, true);
	await writeFile(
		join(directory, 'bin/systemctl'),
		'#!/bin/sh\nprintf "ActiveState=active\\nSubState=running\\n"\n',
		{ mode: 0o755 }
	);
	await action(
		`${serverPath}?/manage`,
		cookies.owner,
		{ operation: 'renameSave', name: 'renamed-world.zip', newName: 'running.zip' },
		409
	);
	await writeFile(
		join(directory, 'bin/systemctl'),
		'#!/bin/sh\nprintf "ActiveState=inactive\\nSubState=dead\\n"\n',
		{ mode: 0o755 }
	);
	await action(
		`${serverPath}?/manage`,
		cookies.stranger,
		{ operation: 'renameSave', name: 'renamed-world.zip', newName: 'stolen.zip' },
		403
	);
	await action(`${serverPath}?/manage`, cookies.owner, {
		operation: 'renameSave',
		name: 'renamed-world.zip',
		newName: 'new-world.zip'
	});
	passed(
		'save renaming preserves the selected world and rejects collisions, paths, and unauthorized users'
	);
	await writeFile(engine, `${createFixture}exit 1\n`);
	await action(`${serverPath}?/manage`, cookies.owner, {
		operation: 'createSave',
		name: 'broken-world.zip'
	});
	assert.equal((await saveOutcome()).state, 'error');
	assert.deepEqual(await readdir(join(machineDirs[0], 'saves')), ['new-world.zip']);
	assert.deepEqual(await readdir(join(machineDirs[0], 'downloads')), []);
	assert.deepEqual(
		(await readdir(join(machineDirs[0], 'map-generation-cache'))).filter((entry) =>
			entry.startsWith('.run-')
		),
		[]
	);
	await action(`${serverPath}?/manage`, cookies.owner, { operation: 'selectSave', name: '' });
	await action(`${serverPath}?/manage`, cookies.owner, {
		operation: 'deleteSave',
		name: 'new-world.zip'
	});
	saveEventsAbort.abort();
	passed(
		'save creation reports background progress, protects the selected save, and never exposes a partial archive'
	);

	const dataPath = `${serverPath}/data?tab=mods&list=${listId}`;
	const view = await json(dataPath, { cookie: cookies.owner });
	assert.deepEqual(view.selectedPlan.problems, []);
	assert.equal(view.selectedPlan.changes.filter((change) => change.kind === 'install').length, 3);
	const crossServer = await request(`${secondPath}/mod-sync`, {
		cookie: cookies.owner,
		method: 'POST',
		body: { listId, hash: view.selectedPlan.hash }
	});
	assert.equal(crossServer.status, 409);
	const stale = await request(`${serverPath}/mod-sync`, {
		cookie: cookies.owner,
		method: 'POST',
		body: { listId, hash: '0'.repeat(64) }
	});
	assert.equal(stale.status, 409);
	await rm(join(cache, 'mods'), { recursive: true, force: true });
	const entered = new Promise((resolveEntered) => {
		downloadStarted = resolveEntered;
	});
	let releaseDownload;
	blockDownload = new Promise((resolveDownload) => {
		releaseDownload = resolveDownload;
	});
	await json(`${serverPath}/mod-sync`, {
		cookie: cookies.owner,
		method: 'POST',
		body: { listId, hash: view.selectedPlan.hash }
	});
	await entered;
	await action(`${serverPath}?/manage`, cookies.owner, { operation: 'start' }, 409);
	releaseDownload();
	blockDownload = undefined;
	const completed = await until(
		`${serverPath}/mod-sync`,
		cookies.owner,
		(value) => value.job.status !== 'running'
	);
	assert.equal(completed.job.status, 'done');
	assert.equal(completed.job.completed, 3);
	assert.equal(
		(
			await client.execute({
				sql: 'SELECT selected_modlist FROM native_server WHERE id = ?',
				args: [serverId]
			})
		).rows[0].selected_modlist,
		listId
	);
	const noChanges = await json(`${dataPath}&fresh=1`, { cookie: cookies.owner });
	assert.deepEqual(noChanges.selectedPlan.changes, []);
	assert.deepEqual((await readState(1, 'mods/mod-list.json')).mods, [
		{ name: 'base', enabled: true }
	]);
	passed(
		'review hashes, running-server protection, operation locks, exact installs and idempotent re-review'
	);
	const serverAssistantPath = `${secondPath}/assistant`;
	assert.equal((await request(serverAssistantPath, { cookie: cookies.stranger })).status, 403);
	const serverReply = await request(serverAssistantPath, {
		cookie: cookies.owner,
		method: 'POST',
		form: { prompt: 'Explain the installed server mods', model: 'gpt-6-astra', effort: 'medium' }
	});
	assert.equal(serverReply.status, 200);
	assert.match(await serverReply.text(), /Fixture contextual explanation/u);
	assert.equal((await json(serverAssistantPath, { cookie: cookies.owner })).turns.length, 1);
	const serverHistory = await json(`${serverAssistantPath}?models=0`, { cookie: cookies.owner });
	assert.equal(serverHistory.turns.length, 1);
	assert.equal('models' in serverHistory, false);
	const serverVoice = {
		chat: serverHistory.chat.id,
		serverId: secondPath.split('/').at(-1),
		sdp: 'v=0\r\nfixture-offer'
	};
	await action('/api/assistant/voice', cookies.stranger, serverVoice, 403);
	await action(
		'/api/assistant/voice',
		cookies.owner,
		{ ...serverVoice, chat: assistantCatalog.chat.id },
		404
	);
	const serverVoiceReply = await action('/api/assistant/voice', cookies.owner, serverVoice);
	assert.equal(await serverVoiceReply.text(), 'v=0\r\nfixture-voice-answer');

	assert.equal((await json(`${serverPath}/assistant`, { cookie: cookies.owner })).turns.length, 0);
	passed('server assistant access and per-instance conversation isolation');
	for (const [prompt, expectedTool] of [
		['fixture-server-saves: list saves while stopped', 'server_saves'],
		['fixture-server-settings: read settings while stopped', 'server_settings']
	]) {
		const reply = await request(`${serverPath}/assistant`, {
			cookie: cookies.owner,
			method: 'POST',
			form: { prompt, model: 'gpt-6-sol' }
		});
		assert.equal(reply.status, 200);
		await reply.text();
		const saved = await json(`${serverPath}/assistant`, { cookie: cookies.owner });
		const turn = saved.turns.find((item) => item.prompt === prompt);
		assert.equal(turn.state, 'done', JSON.stringify(turn));
		assert.ok(
			turn.results.some((item) => item.tool === expectedTool),
			JSON.stringify(turn.results)
		);
		const menu = codexMenus.find((item) => item.request.includes(prompt));
		assert.ok(menu.tools.includes(expectedTool));
		assert.ok(!menu.tools.includes('list_factory_watches'));
	}
	const settingsRoute = routingQueries.find((query) =>
		query.state.request.startsWith('fixture-server-settings')
	);
	assert.ok(
		settingsRoute.state.recent.some((turn) => turn.prompt.startsWith('fixture-server-saves'))
	);
	assert.equal(settingsRoute.questions.watches.type, 'noul');
	const loadReply = await request(`${serverPath}/assistant`, {
		cookie: cookies.owner,
		method: 'POST',
		form: { prompt: 'fixture-load-tools: inspect watches', model: 'gpt-6-sol' }
	});
	assert.equal(loadReply.status, 200);
	await loadReply.text();
	const expandedMenu = codexMenus.filter((menu) => menu.request.includes('fixture-load-tools'));
	assert.ok(expandedMenu.length >= 2, JSON.stringify(expandedMenu));
	assert.ok(!expandedMenu[0].tools.includes('list_factory_watches'));
	assert.ok(expandedMenu.at(-1).tools.includes('list_factory_watches'));
	const nextReply = await request(`${serverPath}/assistant`, {
		cookie: cookies.owner,
		method: 'POST',
		form: { prompt: 'fixture-next-submission: inspect server', model: 'gpt-6-sol' }
	});
	assert.equal(nextReply.status, 200);
	await nextReply.text();
	const nextMenu = codexMenus.find((menu) => menu.request.includes('fixture-next-submission'));
	assert.ok(
		!nextMenu.tools.includes('list_factory_watches'),
		'Expanded groups end with the submission'
	);
	const reviewReply = await request(`${serverPath}/assistant`, {
		cookie: cookies.owner,
		method: 'POST',
		form: { prompt: 'fixture-server-mod-plan: review this list', model: 'gpt-6-sol' }
	});
	assert.equal(reviewReply.status, 200);
	await reviewReply.text();
	const reviewConversation = await json(`${serverPath}/assistant`, { cookie: cookies.owner });
	const reviewTurn = reviewConversation.turns.find((turn) =>
		turn.prompt.startsWith('fixture-server-mod-plan')
	);
	const review = reviewTurn.results.find((item) => item.tool === 'prepare_server_mod_list');
	assert.ok(review?.result.hash, JSON.stringify(reviewTurn));
	await action(
		`${serverPath}/assistant`,
		cookies.owner,
		{
			operation: 'apply-modlist',
			turn: reviewTurn.id,
			hash: 'forged-hash'
		},
		404
	);
	await action(
		serverAssistantPath,
		cookies.owner,
		{
			operation: 'apply-modlist',
			turn: reviewTurn.id,
			hash: review.result.hash
		},
		404
	);
	await action(
		`${serverPath}/assistant`,
		cookies.stranger,
		{
			operation: 'apply-modlist',
			turn: reviewTurn.id,
			hash: review.result.hash
		},
		403
	);
	passed('Jev chat context and tool groups, dynamic expansion, and stopped server reads');
	const gameSockets = new Set();
	const gameReplies = [];
	const gameWaiters = new Map();
	const gameRcon = createTcpServer((socket) => {
		gameSockets.add(socket);
		socket.on('close', () => gameSockets.delete(socket));
		let buffer = Buffer.alloc(0);
		const reply = (id, type, value) => {
			const data = Buffer.from(value);
			const packet = Buffer.alloc(data.length + 14);
			packet.writeInt32LE(data.length + 10, 0);
			packet.writeInt32LE(id, 4);
			packet.writeInt32LE(type, 8);
			data.copy(packet, 12);
			socket.write(packet);
		};
		socket.on('data', (chunk) => {
			buffer = Buffer.concat([buffer, chunk]);
			while (buffer.length >= 4 && buffer.length >= buffer.readInt32LE(0) + 4) {
				const length = buffer.readInt32LE(0);
				const id = buffer.readInt32LE(4);
				const type = buffer.readInt32LE(8);
				const command = buffer.toString('utf8', 12, length + 2);
				buffer = buffer.subarray(length + 4);
				if (type === 3) reply(id, 2, '');
				else if (command.includes('facmandu-ready')) reply(id, 0, 'facmandu-ready');
				else if (command.includes('rcon.print(helpers.table_to_json')) {
					const player = /game\.get_player\("([^"]+)"\)/u.exec(command)?.[1];
					assert.ok(player, command);
					reply(
						id,
						0,
						JSON.stringify({
							name: player,
							force: 'player',
							surface: 'nauvis',
							position: { x: 12, y: 34 },
							admin: false,
							connected: true
						})
					);
				} else if (command.includes('p.print(')) {
					gameReplies.push(command);
					const player = /game\.get_player\("([^"]+)"\)/u.exec(command)?.[1];
					gameWaiters.get(player)?.resolve(command);
					gameWaiters.delete(player);
					reply(id, 0, '');
				} else throw new Error(`Unexpected in-game RCON command: ${command}`);
			}
		});
	});
	const nextGameReply = (player) => {
		const waiter = Promise.withResolvers();
		gameWaiters.set(player, waiter);
		const timeout = setTimeout(
			() => waiter.reject(new Error(`No game reply for ${player}: ${logs}`)),
			10_000
		);
		return waiter.promise.finally(() => clearTimeout(timeout));
	};
	await new Promise((done) => gameRcon.listen(Number(firstPorts.rcon_port), '127.0.0.1', done));
	try {
		const gameLog = join(machineDirs[0], 'logs/server.log');
		const gameSettings = {
			operation: 'gameAssistant',
			enabled: 'on',
			model: 'gpt-6-luna',
			effort: 'medium',
			actions: 'off',
			players: ''
		};
		await appendFile(gameLog, '100.000 [CHAT] OldPlayer: @assistant fixture-game-history\n');
		await action(`${serverPath}?/manage`, cookies.owner, gameSettings);
		assert.equal(
			(
				await client.execute(
					"SELECT COUNT(*) AS count FROM server_assistant_turn WHERE prompt = 'fixture-game-history'"
				)
			).rows[0].count,
			0
		);
		const aliceReply = nextGameReply('Alice');
		await appendFile(
			gameLog,
			'101.000 [CHAT] Alice: @assistant fixture-game-alice: where is iron?\n'
		);
		assert.match(
			await aliceReply,
			/Assistant: Iron nearby: \[item=iron-plate\] \[gps=12,34,nauvis\]/u
		);
		const gameHistory = await json(`${serverPath}/assistant`, { cookie: cookies.owner });
		const aliceChat = gameHistory.chats.find((chat) => chat.gamePlayer === 'Alice');
		assert.ok(aliceChat, JSON.stringify(gameHistory.chats));
		const aliceTurns = await json(`${serverPath}/assistant?chat=${aliceChat.id}`, {
			cookie: cookies.owner
		});
		assert.equal(aliceTurns.turns[0].prompt, 'fixture-game-alice: where is iron?');
		assert.equal(aliceTurns.turns[0].state, 'done');
		assert.equal(aliceTurns.turns[0].model, 'gpt-6-luna');
		const route = routingQueries.find((query) =>
			query.state.request.includes('fixture-game-alice')
		);
		assert.match(route.state.request, /"name":"Alice"/u);
		assert.match(route.state.request, /"force":"player"/u);
		assert.match(route.state.request, /"surface":"nauvis"/u);
		const gameMenu = codexMenus.find((menu) => menu.request.includes('fixture-game-alice'));
		assert.match(gameMenu.request, /Alice/u);
		assert.ok(gameMenu.tools.includes('factory_lookup'));
		for (const forbidden of [
			'server_logs',
			'server_saves',
			'server_control',
			'list_factory_watches',
			'update_server_settings'
		])
			assert.ok(!gameMenu.tools.includes(forbidden), `${forbidden}: ${JSON.stringify(gameMenu)}`);
		await action(
			`${serverPath}/assistant`,
			cookies.owner,
			{ chat: aliceChat.id, prompt: 'web injection', model: 'gpt-6-luna' },
			403
		);
		await action(
			'/api/assistant/voice',
			cookies.owner,
			{ chat: aliceChat.id, serverId, sdp: 'v=0\r\nfixture-offer' },
			403
		);
		const bobReply = nextGameReply('Bob');
		await appendFile(
			gameLog,
			'102.000 [CHAT] Alice: @assistant fixture-game-spam\n102.001 [CHAT] Bob: @assistant fixture-game-bob\n'
		);
		await bobReply;
		const chats = (await json(`${serverPath}/assistant`, { cookie: cookies.owner })).chats;
		const bobChat = chats.find((chat) => chat.gamePlayer === 'Bob');
		assert.ok(bobChat);
		assert.notEqual(aliceChat.id, bobChat.id);
		assert.equal(
			(await json(`${serverPath}/assistant?chat=${bobChat.id}`, { cookie: cookies.owner })).turns[0]
				.prompt,
			'fixture-game-bob'
		);
		assert.equal(
			(
				await client.execute(
					"SELECT COUNT(*) AS count FROM server_assistant_turn WHERE prompt = 'fixture-game-spam'"
				)
			).rows[0].count,
			0
		);
		await stop();
		await start();
		await action(`${serverPath}?/manage`, cookies.owner, gameSettings);
		const charlieReply = nextGameReply('Charlie');
		await appendFile(gameLog, '103.000 [CHAT] Charlie: @assistant fixture-game-charlie\n');
		await charlieReply;
		const newChatReply = nextGameReply('Bob');
		await appendFile(gameLog, '104.000 [CHAT] Bob: @assistant new chat\n');
		assert.match(await newChatReply, /Assistant: Started a new chat\./u);
		const bobChats = (
			await json(`${serverPath}/assistant`, { cookie: cookies.owner })
		).chats.filter((chat) => chat.gamePlayer === 'Bob');
		assert.equal(bobChats.length, 2);
		assert.equal(
			(await json(`${serverPath}/assistant?chat=${bobChats[0].id}`, { cookie: cookies.owner }))
				.turns.length,
			0
		);
		assert.equal(
			(await json(`${serverPath}/assistant?chat=${bobChat.id}`, { cookie: cookies.owner })).turns[0]
				.prompt,
			'fixture-game-bob'
		);
		const questionReply = nextGameReply('Eve');
		await appendFile(
			gameLog,
			'105.000 [CHAT] Eve: @assistant fixture-game-question-action: could you queue Automation?\n'
		);
		await questionReply;
		assert.ok(codexMenus.some((menu) => menu.request.includes('fixture-game-question-action')));
		assert.ok(assistantToolOutputs.some((output) => output.callId === 'call_game_question_action'));
		assert.equal(
			gameReplies.length,
			5,
			'Only player replies reached RCON; no factory write was sent'
		);
		assert.equal(
			(
				await client.execute(
					"SELECT COUNT(*) AS count FROM server_assistant_turn WHERE prompt LIKE 'fixture-game-%'"
				)
			).rows[0].count,
			4
		);
		assert.equal(gameReplies.length, 5);
		await action(`${serverPath}?/manage`, cookies.owner, { ...gameSettings, enabled: 'off' });
		passed(
			'in-game assistant starts at EOF, scopes player chats and tools, rejects web writes and unauthorized actions, bounds spam, supports new chat and does not replay after restart'
		);
	} finally {
		for (const socket of gameSockets) socket.destroy();
		await new Promise((done) => gameRcon.close(done));
	}
	// Warm archives remain usable after an account removes its portal credentials.
	await client.execute(
		"UPDATE user SET factorio_username = NULL, factorio_token = NULL WHERE id = 'owner'"
	);
	const cachedMod = await request(`/api/modlists/${listId}/download/root-mod/latest`, {
		cookie: cookies.owner
	});
	assert.equal(cachedMod.status, 200);
	assert.equal(cachedMod.headers.get('x-factorio-mod-version'), '1.0.0');
	assert.equal(await cachedMod.text(), archive.toString());
	const exports = await Promise.all(
		Array.from({ length: 6 }, () =>
			json(`/api/modlists/${listId}/export`, { cookie: cookies.owner, method: 'POST' })
		)
	);
	assert.equal(new Set(exports.map((value) => value.id)).size, 1);
	const exportId = exports[0].id;
	const exported = await until(
		`/api/modlists/${listId}/export?job=${exportId}`,
		cookies.owner,
		(value) => value.state !== 'running'
	);
	assert.equal(exported.state, 'done');
	const download = await request(`/api/modlists/${listId}/export?download=${exportId}`, {
		cookie: cookies.owner
	});
	assert.equal(download.status, 200);
	const archivePath = join(directory, 'bundle.tar.gz');
	await writeFile(archivePath, Buffer.from(await download.arrayBuffer()));
	const members = (await command('tar', ['-tzf', archivePath])).trim().split('\n');
	assert.deepEqual(
		members.sort(),
		[
			'mod-list.json',
			...['root-mod', 'dependency', longName].map((name) => `${name}_1.0.0.zip`)
		].sort()
	);
	const modList = JSON.parse(await command('tar', ['-xOzf', archivePath, 'mod-list.json']));
	assert.equal(modList.mods.filter((mod) => mod.name === 'base').length, 1);
	assert.ok(
		modList.mods.filter((mod) => mod.name !== 'base').every((mod) => mod.version === '1.0.0')
	);
	assert.equal(
		await command('tar', ['-xOzf', archivePath, `${longName}_1.0.0.zip`]),
		archive.toString()
	);
	assert.equal(
		[...calls]
			.filter(([key]) => key.startsWith('/portal/download'))
			.reduce((sum, [, count]) => sum + count, 0),
		3
	);
	passed(
		'concurrent exports share one artifact, preserve exact pins and long names, and reuse verified archives without credentials'
	);

	const choiceImport = await action(
		'/modlists/new',
		cookies.owner,
		{
			name: 'Release choices',
			factorioVersion: '2.1',
			json: JSON.stringify({
				mods: [
					{ name: 'choice', enabled: true, version: '1.0.0' },
					{ name: 'choice-dependency', enabled: true, version: '1.0.0' }
				]
			})
		},
		303
	);
	const choicePath = choiceImport.headers.get('location');
	const choiceListId = choicePath.split('/').at(-1);
	await until(
		`/api/modlists/${choiceListId}/repair`,
		cookies.owner,
		(value) => value?.state === 'done'
	);
	const choiceModId = (
		await client.execute({
			sql: 'SELECT id FROM mod WHERE modlist_id = ? AND name = ?',
			args: [choiceListId, 'choice']
		})
	).rows[0].id;
	await action(
		`${choicePath}?/setModVersion`,
		cookies.stranger,
		{ modId: choiceModId, version: '2.0.0' },
		403
	);
	await action(
		`${listPath}?/setModVersion`,
		cookies.owner,
		{ modId: choiceModId, version: '2.0.0' },
		404
	);
	await action(
		`${choicePath}?/setModVersion`,
		cookies.owner,
		{ modId: choiceModId, version: '99.0.0' },
		400
	);
	await action(
		`${choicePath}?/setModVersion`,
		cookies.owner,
		{ modId: choiceModId, version: '3.0.0' },
		400
	);
	await action(`${choicePath}?/setModVersion`, cookies.owner, {
		modId: choiceModId,
		version: '2.0.0'
	});
	const versionRepair = await until(
		`/api/modlists/${choiceListId}/repair`,
		cookies.owner,
		(value) => value?.state === 'done'
	);
	assert.deepEqual(versionRepair.issues, []);
	assert.ok(versionRepair.changes.includes('choice-dependency: 1.0.0 → 2.0.0'));
	assert.equal(versionRepair.networkRequests, 0);
	const choiceRows = (
		await client.execute({
			sql: 'SELECT name, version FROM mod WHERE modlist_id = ?',
			args: [choiceListId]
		})
	).rows;
	assert.ok(choiceRows.every((row) => row.version === '2.0.0'));
	await action(`${choicePath}?/setModVersion`, cookies.owner, {
		modId: choiceModId,
		version: '1.0.0'
	});
	await until(
		`/api/modlists/${choiceListId}/repair`,
		cookies.owner,
		(value) => value?.state === 'done'
	);
	assert.equal(
		(await client.execute({ sql: 'SELECT version FROM mod WHERE id = ?', args: [choiceModId] }))
			.rows[0].version,
		'1.0.0'
	);
	passed(
		'release selection validates permissions and compatibility, repairs dependencies transparently, and supports downgrades'
	);

	const bulkImport = await action(
		'/modlists/new',
		cookies.owner,
		{
			name: 'Bulk metadata',
			factorioVersion: '2.1',
			json: JSON.stringify({
				mods: Array.from({ length: 25 }, (_, index) => ({
					name: `bulk-${index}`,
					enabled: index % 2 === 0,
					version: '1.0.0'
				}))
			})
		},
		303
	);
	const bulkPath = bulkImport.headers.get('location');
	const bulkId = bulkPath.split('/').at(-1);
	const bulkRepair = await until(
		`/api/modlists/${bulkId}/repair`,
		cookies.owner,
		(value) => value?.state === 'done'
	);
	assert.deepEqual(bulkRepair.issues, []);
	assert.equal(bulkRepair.metadataUpdated, 25);
	assert.equal(bulkRepair.networkRequests, 0);
	const bulkRows = (
		await client.execute({
			sql: 'SELECT name, enabled, version, title FROM mod WHERE modlist_id = ?',
			args: [bulkId]
		})
	).rows;
	assert.equal(bulkRows.length, 25);
	assert.ok(
		bulkRows.every(
			(row) =>
				row.version === '1.0.0' &&
				row.title === `Fixture ${row.name}` &&
				row.enabled === (Number(row.name.split('-')[1]) % 2 === 0 ? 1 : 0)
		)
	);
	const duplicate = await action('/modlists?/duplicate', cookies.owner, { modlistId: bulkId }, 303);
	const duplicateId = duplicate.headers.get('location').split('/').at(-1);
	const copiedRows = (
		await client.execute({
			sql: 'SELECT name, enabled, version, title FROM mod WHERE modlist_id = ? ORDER BY name',
			args: [duplicateId]
		})
	).rows;
	assert.deepEqual(
		copiedRows,
		bulkRows.toSorted((a, b) => a.name.localeCompare(b.name))
	);
	passed(
		'bulk metadata repair and list copies span write batches while preserving every enabled flag and selected version'
	);

	const routingCalls = calls.get('/typesafe/v1/systemone') ?? 0;
	const curationPath = `/api/modlists/${listId}/recommendations`;
	assert.equal(
		(
			await request(curationPath, {
				cookie: cookies.stranger,
				method: 'POST',
				body: { names: ['companion'] }
			})
		).status,
		403
	);
	await action(`${listPath}?/shareAdd`, cookies.owner, { username: 'viewer' });
	const curation = await json(curationPath, {
		cookie: cookies.viewer,
		method: 'POST',
		body: { names: ['companion', 'unverified-candidate'] }
	});
	assert.equal(curation.scores.companion.score, 6.25);
	assert.equal(curation.scores.companion.confidence, 0.6);
	assert.equal(curation.scores.companion.dimensions.length, 3);
	assert.deepEqual(Object.keys(curation.scores), ['companion']);
	assert.equal(curation.source, 'network');
	const cachedCuration = await json(curationPath, {
		cookie: cookies.owner,
		method: 'POST',
		body: { names: ['companion'] }
	});
	assert.deepEqual(cachedCuration.scores, curation.scores);
	assert.equal(cachedCuration.source, 'cache');
	assert.equal(calls.get('/typesafe/v1/systemone'), routingCalls + 1);
	const rankingFailure = await request(curationPath, {
		cookie: cookies.owner,
		method: 'POST',
		body: { names: ['missing-ranking'] }
	});
	assert.equal(rankingFailure.status, 502);
	assert.match(rankingFailure.headers.get('content-type'), /application\/json/);
	assert.equal(
		(await rankingFailure.json()).message,
		'Ranking is unavailable. You can still browse and add mods.'
	);
	assert.equal(calls.get('/typesafe/v1/systemone'), routingCalls + 2);
	incompleteRankings = false;
	await client.execute(
		"UPDATE portal_cache SET retry_after = 0 WHERE key LIKE 'typesafe:%' AND status != 200"
	);
	const recoveredRanking = await json(curationPath, {
		cookie: cookies.owner,
		method: 'POST',
		body: { names: ['missing-ranking'] }
	});
	assert.deepEqual(recoveredRanking.scores['missing-ranking'], curation.scores.companion);
	assert.equal(calls.get('/typesafe/v1/systemone'), routingCalls + 3);
	passed(
		'TypeSafe receives only verified candidates and public mod descriptions, validates rankings, and caches matching requests'
	);

	const remoteCalls = [...calls]
		.filter(([key]) => key.startsWith('/portal/'))
		.reduce((sum, [, count]) => sum + count, 0);
	await client.execute({
		sql: 'UPDATE native_server_job SET body = ? WHERE server_id = ?',
		args: [
			JSON.stringify({
				...completed.job,
				status: 'running',
				current: 'fixture interrupted operation'
			}),
			serverId
		]
	});
	const modsBeforeRestart = await readState(0, 'mods/mod-list.json');
	const modelRequestsBeforeRestart = calls.get('/codex/backend-api/codex/responses');
	await client.execute(
		"UPDATE assistant_turn SET state = 'running', answer = '' WHERE prompt = 'fixture-plan: add agent-addon'"
	);
	await stop();
	await start();
	const recoveredConversation = await until(assistantPath, cookies.owner, (value) =>
		value.turns.every((turn) => turn.state !== 'running')
	);
	assert.ok(
		recoveredConversation.turns.some((turn) =>
			turn.answer.includes('Fixture contextual explanation')
		)
	);
	assert.equal(calls.get('/codex/backend-api/codex/responses'), modelRequestsBeforeRestart);
	assert.equal(recoveredConversation.model, 'gpt-6-sol');
	assert.equal(
		recoveredConversation.turns.find((turn) => turn.prompt.startsWith('fixture-cards')).mods[0]
			.name,
		'agent-addon'
	);
	assert.equal(calls.get('/codex/backend-api/codex/models'), 1);
	passed(
		'interrupted HTTP replies and cached model choices recover without repeating model requests'
	);
	await request('/login');
	assert.equal(
		(await client.execute("SELECT is_admin FROM user WHERE username = 'luan'")).rows[0].is_admin,
		0
	);
	const recovered = await json(`${serverPath}/mod-sync`, { cookie: cookies.owner });
	assert.equal(recovered.job.status, 'failed');
	assert.match(recovered.job.error, /restart/u);
	assert.deepEqual(await readState(0, 'mods/mod-list.json'), modsBeforeRestart);
	portalOffline = true;
	assert.deepEqual(
		(
			await json(curationPath, {
				cookie: cookies.owner,
				method: 'POST',
				body: { names: ['companion'] }
			})
		).scores,
		curation.scores
	);
	assert.equal(calls.get('/typesafe/v1/systemone'), routingCalls + 3);
	await client.execute({
		sql: 'UPDATE mod SET summary = ?, dependencies = ? WHERE modlist_id = ?',
		args: [
			'Production chains. '.repeat(300),
			JSON.stringify(['base >= 2.1', '? companion']),
			bulkId
		]
	});
	const largeRankingPath = `/api/modlists/${bulkId}/recommendations`;
	const largeRanking = await json(largeRankingPath, {
		cookie: cookies.owner,
		method: 'POST',
		body: { names: ['companion'] }
	});
	assert.deepEqual(largeRanking.scores, curation.scores);
	assert.equal(calls.get('/typesafe/v1/systemone'), routingCalls + 5);
	const cachedLargeRanking = await json(largeRankingPath, {
		cookie: cookies.owner,
		method: 'POST',
		body: { names: ['companion'] }
	});
	assert.equal(cachedLargeRanking.source, 'cache');
	assert.deepEqual(cachedLargeRanking.scores, largeRanking.scores);
	assert.equal(calls.get('/typesafe/v1/systemone'), routingCalls + 5);
	passed('oversized ranking requests retry with less prose and reuse the cached result');
	const portalCallsBeforeFeedback = [...calls].filter(([key]) => key.startsWith('/portal/'));
	const feedbackPath = `/api/modlists/${listId}/recommendations`;
	await json(feedbackPath, {
		cookie: cookies.owner,
		method: 'PUT',
		body: { names: ['cold-mod'], dismissed: true }
	});
	const withFeedback = await json(curationPath, {
		cookie: cookies.owner,
		method: 'POST',
		body: { names: ['companion'], dismissed: [] }
	});
	assert.ok(withFeedback.scores.companion.score < curation.scores.companion.score);
	assert.equal(calls.get('/typesafe/v1/systemone'), routingCalls + 6);
	const repeatFeedback = await json(curationPath, {
		cookie: cookies.owner,
		method: 'POST',
		body: { names: ['companion'], dismissed: ['cold-mod', 'cold-mod'] }
	});
	assert.equal(repeatFeedback.source, 'cache');
	assert.deepEqual(repeatFeedback.scores, withFeedback.scores);
	await json(feedbackPath, {
		cookie: cookies.owner,
		method: 'PUT',
		body: { names: ['cold-mod'], dismissed: false }
	});
	const restoredFeedback = await json(curationPath, {
		cookie: cookies.owner,
		method: 'POST',
		body: { names: ['companion'], dismissed: ['cold-mod'] }
	});
	assert.equal(restoredFeedback.source, 'cache');
	assert.deepEqual(restoredFeedback.scores, curation.scores);
	const unknownFeedback = await json(curationPath, {
		cookie: cookies.owner,
		method: 'POST',
		body: { names: ['companion'], dismissed: ['not-a-known-mod', 'root-mod'] }
	});
	assert.deepEqual(unknownFeedback.scores, curation.scores);
	assert.equal(calls.get('/typesafe/v1/systemone'), routingCalls + 6);
	assert.deepEqual(
		[...calls].filter(([key]) => key.startsWith('/portal/')),
		portalCallsBeforeFeedback
	);
	assert.equal((await request(feedbackPath, { cookie: cookies.stranger })).status, 403);
	assert.equal(
		(
			await request(feedbackPath, {
				method: 'PUT',
				cookie: cookies.stranger,
				body: { names: ['cold-mod'], dismissed: true }
			})
		).status,
		403
	);
	assert.equal(
		(
			await request(feedbackPath, {
				method: 'PUT',
				cookie: cookies.owner,
				body: { names: ['cold-mod'], dismissed: true }
			})
		).status,
		200
	);
	assert.deepEqual((await json(feedbackPath, { cookie: cookies.owner })).dismissed, ['cold-mod']);
	assert.deepEqual((await json(feedbackPath, { cookie: cookies.viewer })).dismissed, []);
	await stop();
	await start();
	assert.deepEqual((await json(feedbackPath, { cookie: cookies.owner })).dismissed, ['cold-mod']);
	assert.equal(
		(
			await request(feedbackPath, {
				method: 'PUT',
				cookie: cookies.owner,
				body: { names: ['cold-mod'], dismissed: false }
			})
		).status,
		200
	);
	assert.deepEqual((await json(feedbackPath, { cookie: cookies.owner })).dismissed, []);

	passed(
		'dismissals affect rankings, persist across restart, stay private per account, and restore without portal requests'
	);
	const restored = await json(`/api/modlists/${listId}/export`, {
		cookie: cookies.owner,
		method: 'POST'
	});
	assert.equal(restored.id, exportId);
	assert.equal(restored.state, 'done');
	await json(`${serverPath}/bookmarks`, { cookie: cookies.owner });
	await json(`${serverPath}/data?tab=settings`, { cookie: cookies.owner });
	await json(`${serverPath}/releases`, { cookie: cookies.owner });
	assert.equal(
		[...calls]
			.filter(([key]) => key.startsWith('/portal/'))
			.reduce((sum, [, count]) => sum + count, 0),
		remoteCalls
	);
	passed('bookmarks, releases and exports survive app restart without remote API calls');

	await client.execute(
		"UPDATE portal_cache SET fetched_at = 0 WHERE key = 'factorio:latest-releases'"
	);
	await client.execute(`CREATE TRIGGER reject_cache_cooldown BEFORE INSERT ON portal_cache
		WHEN NEW.key = 'factorio:latest-releases'
		BEGIN SELECT RAISE(ABORT, 'fixture cooldown write outage'); END`);
	const offline = await json(`${serverPath}/releases`, { cookie: cookies.owner });
	assert.equal(offline.data.stable.headless, '2.1.20');
	assert.match(offline.warning, /cached/u);
	await json(`${serverPath}/releases`, { cookie: cookies.owner });
	assert.equal(calls.get('/portal/api/latest-releases'), 2);
	await client.execute('DROP TRIGGER reject_cache_cooldown');
	passed(
		'expired cached releases and retry cooldowns remain usable through portal and database write outages'
	);
	for (let attempt = 0; attempt < 30; attempt++) {
		await action('/login', '', { username: 'missing-user', password: 'wrong-password' }, 400);
	}
	const throttled = await action(
		'/login',
		'',
		{ username: 'owner', password: 'fixture-password' },
		429
	);
	assert.ok(Number(throttled.headers.get('retry-after')) > 0);
	await action(
		'/register',
		'',
		{
			username: 'limited-user',
			password: 'fixture-password',
			confirm: 'fixture-password',
			invite: 'invalid'
		},
		429
	);
	assert.equal((await request(`${serverPath}/data`, { cookie: cookies.owner })).status, 200);
	passed(
		'login and registration share a bounded attempt budget without blocking authenticated controls'
	);

	const originalChat = (await json(assistantPath, { cookie: cookies.owner })).chat.id;
	const newChatResponse = await action(assistantPath, cookies.owner, { operation: 'new-chat' });
	const freshChat = await newChatResponse.json();
	const freshPath = `${assistantPath}?chat=${freshChat.id}`;
	assert.equal((await json(freshPath, { cookie: cookies.owner })).turns.length, 0);
	assert.equal(
		(await json(`${assistantPath}?chat=${originalChat}`, { cookie: cookies.owner })).turns.length,
		recoveredConversation.turns.length
	);
	assert.equal((await request(freshPath, { cookie: cookies.viewer })).status, 404);
	assert.equal(
		(
			await request(freshPath, {
				cookie: cookies.owner,
				method: 'POST',
				form: { chat: 'missing', operation: 'cancel' }
			})
		).status,
		404
	);
	const freshReply = await request(assistantPath, {
		cookie: cookies.owner,
		method: 'POST',
		form: { chat: freshChat.id, prompt: 'fixture-fresh-chat', model: 'gpt-6-sol', effort: 'medium' }
	});
	assert.match(await freshReply.text(), /Fixture contextual explanation/);
	const savedFresh = await json(freshPath, { cookie: cookies.owner });
	assert.equal(savedFresh.turns.length, 1);
	assert.equal(savedFresh.chat.title, 'fixture-fresh-chat');
	assert.ok(savedFresh.chats.some((chat) => chat.id === originalChat));
	const serverOriginal = (await json(serverAssistantPath, { cookie: cookies.owner })).chat.id;
	const serverNew = await (
		await action(serverAssistantPath, cookies.owner, { operation: 'new-chat' })
	).json();
	assert.equal(
		(await json(`${serverAssistantPath}?chat=${serverNew.id}`, { cookie: cookies.owner })).turns
			.length,
		0
	);
	assert.equal(
		(await json(`${serverAssistantPath}?chat=${serverOriginal}`, { cookie: cookies.owner })).turns
			.length,
		1
	);
	assert.equal(
		(await request(`${serverAssistantPath}?chat=${freshChat.id}`, { cookie: cookies.owner }))
			.status,
		404
	);
	passed('fresh chats isolate model context, preserve history, and reject other users or targets');
	for (let index = 0; index < 35; index++)
		await client.execute({
			sql: 'INSERT INTO server_assistant_turn(id,user_id,server_id,chat_id,prompt,answer,state,created_at) VALUES (?,?,?,?,?,?,?,?)',
			args: [
				`page-${index}`,
				'owner',
				secondPath.split('/').at(-1),
				serverNew.id,
				`Message ${index}`,
				'Saved reply',
				'done',
				1000 + index
			]
		});
	const recentPage = await json(`${serverAssistantPath}?chat=${serverNew.id}`, {
		cookie: cookies.owner
	});
	const earlierPage = await json(`${serverAssistantPath}?chat=${serverNew.id}&offset=30`, {
		cookie: cookies.owner
	});
	assert.equal(recentPage.hasMore, true);
	assert.equal(earlierPage.hasMore, false);
	assert.equal(
		new Set([...recentPage.turns, ...earlierPage.turns].map((turn) => turn.id)).size,
		35
	);

	const longReply = await request(assistantPath, {
		cookie: cookies.owner,
		method: 'POST',
		form: {
			chat: freshChat.id,
			prompt: 'fixture-long-context',
			model: 'gpt-6-sol',
			effort: 'medium'
		}
	});
	assert.equal(longReply.status, 200);
	await longReply.text();
	const compactReply = await request(assistantPath, {
		cookie: cookies.owner,
		method: 'POST',
		form: {
			chat: freshChat.id,
			prompt: 'Continue from the previous context',
			model: 'gpt-6-sol',
			effort: 'medium'
		}
	});
	const compactText = await compactReply.text();
	assert.match(compactText, /Summarizing earlier context/);
	assert.match(compactText, /"compacted":true/);
	const compactedChat = await json(freshPath, { cookie: cookies.owner });
	assert.ok(compactedChat.chat.compactedAt);
	assert.equal(compactedChat.turns.length, 3, 'Compaction preserves visible history');
	passed(
		'Flue compacts the main conversation and persists its marker without deleting chat history'
	);
	portalOffline = false;
	for (const [name, dependency] of [
		['review-alpha', 'review-helper'],
		['review-beta', 'review-helper'],
		['direct-alpha', 'direct-helper'],
		['direct-beta', 'direct-helper']
	])
		metadata.set(name, catalog(name, '1.0.0', ['base >= 2.1', `${dependency} >= 1.0.0`]));
	metadata.set('review-helper', catalog('review-helper', '1.0.0'));
	metadata.set('direct-helper', catalog('direct-helper', '1.0.0'));
	const changesChat = await (
		await action(assistantPath, cookies.owner, { operation: 'new-chat' })
	).json();
	const changesPath = `${assistantPath}?chat=${changesChat.id}`;
	const askChanges = async (prompt) => {
		const response = await request(assistantPath, {
			cookie: cookies.owner,
			method: 'POST',
			form: { chat: changesChat.id, prompt, model: 'gpt-6-sol', effort: 'medium' }
		});
		assert.equal(response.status, 200);
		const text = await response.text();
		assert.match(text, /"done":true/u, text);
	};
	await askChanges('fixture-preview-recommendations: which mods could help?');
	assert.deepEqual((await json(changesPath, { cookie: cookies.owner })).plans, []);
	assert.equal(
		(
			await client.execute({
				sql: "SELECT count(*) as count FROM mod WHERE modlist_id = ? AND name IN ('review-alpha','review-beta')",
				args: [listId]
			})
		).rows[0].count,
		0
	);
	await askChanges('fixture-combined-review: review adding review-alpha and review-beta together');
	const prepared = await json(changesPath, { cookie: cookies.owner });
	assert.equal(prepared.plans.length, 1, JSON.stringify(prepared.plans));
	const combined = prepared.plans[0];
	assert.ok(
		prepared.turns
			.find((turn) => turn.prompt.startsWith('fixture-combined-review'))
			.plans.some((plan) => plan.id === combined.id)
	);
	assert.deepEqual(combined.details.map((detail) => detail.name).toSorted(), [
		'review-alpha',
		'review-beta',
		'review-helper'
	]);
	assert.equal(combined.details.filter((detail) => detail.name === 'review-helper').length, 1);
	assert.equal(combined.details.find((detail) => detail.name === 'review-helper').dependency, true);
	assert.deepEqual(
		combined.details.find((detail) => detail.name === 'review-helper').requiredBy.toSorted(),
		['Fixture review-alpha', 'Fixture review-beta']
	);
	assert.ok(
		combined.changes.some(
			(change) =>
				change.includes('review-helper') &&
				change.includes('required by Fixture review-alpha, Fixture review-beta')
		)
	);
	await action(`${listPath}?/updateModlistName`, cookies.owner, {
		name: 'Changed before combined review'
	});
	assert.equal((await json(changesPath, { cookie: cookies.owner })).plans[0].stale, true);
	await action(
		assistantPath,
		cookies.owner,
		{ operation: 'apply', chat: changesChat.id, plan: combined.id },
		409
	);
	const refreshed = await (
		await action(assistantPath, cookies.owner, {
			operation: 'refresh',
			chat: changesChat.id,
			plan: combined.id
		})
	).json();
	assert.notEqual(refreshed.id, combined.id);
	assert.deepEqual(
		refreshed.details.map((detail) => detail.name).toSorted(),
		combined.details.map((detail) => detail.name).toSorted()
	);
	assert.ok(
		(await json(changesPath, { cookie: cookies.owner })).turns
			.find((turn) => turn.prompt.startsWith('fixture-combined-review'))
			.plans.some((plan) => plan.id === refreshed.id)
	);
	await action(
		assistantPath,
		cookies.viewer,
		{ operation: 'apply', chat: changesChat.id, plan: refreshed.id },
		404
	);
	await action(
		`/api/modlists/${choiceListId}/assistant`,
		cookies.owner,
		{ operation: 'apply', plan: refreshed.id },
		409
	);
	await action(assistantPath, cookies.owner, {
		operation: 'apply',
		chat: changesChat.id,
		plan: refreshed.id
	});
	await action(assistantPath, cookies.owner, {
		operation: 'apply',
		chat: changesChat.id,
		plan: refreshed.id
	});
	const reviewedRows = (
		await client.execute({
			sql: "SELECT name, enabled, auto_dependency FROM mod WHERE modlist_id = ? AND name IN ('review-alpha','review-beta','review-helper') ORDER BY name",
			args: [listId]
		})
	).rows;
	assert.deepEqual(
		reviewedRows.map((row) => row.name),
		['review-alpha', 'review-beta', 'review-helper']
	);
	assert.ok(reviewedRows.every((row) => row.enabled === 1));
	assert.equal(reviewedRows.find((row) => row.name === 'review-helper').auto_dependency, 1);
	await askChanges('fixture-direct-apply: add direct-alpha and direct-beta now');
	const direct = await json(changesPath, { cookie: cookies.owner });
	const directTurn = direct.turns.find((turn) => turn.prompt.startsWith('fixture-direct-apply'));
	assert.equal(directTurn.plans.filter((plan) => plan.applied).length, 1);
	const directReceipt = directTurn.plans.find((plan) => plan.applied);
	assert.equal(
		direct.plans.filter(
			(plan) => plan.applied && plan.details.some((detail) => detail.name === 'direct-alpha')
		).length,
		1
	);
	const directRows = (
		await client.execute({
			sql: "SELECT name, enabled, auto_dependency FROM mod WHERE modlist_id = ? AND name IN ('direct-alpha','direct-beta','direct-helper') ORDER BY name",
			args: [listId]
		})
	).rows;
	assert.deepEqual(
		directRows.map((row) => row.name),
		['direct-alpha', 'direct-beta', 'direct-helper']
	);
	assert.equal(directRows.find((row) => row.name === 'direct-helper').auto_dependency, 1);
	await askChanges('fixture-later-message: what changed?');
	const laterConversation = await json(changesPath, { cookie: cookies.owner });
	assert.ok(
		laterConversation.turns
			.find((turn) => turn.id === directTurn.id)
			.plans.some((plan) => plan.id === directReceipt.id && plan.applied)
	);
	assert.deepEqual(
		laterConversation.turns.find((turn) => turn.prompt.startsWith('fixture-later-message')).plans,
		[]
	);
	metadata.set('manual-receipt', catalog('manual-receipt', '1.0.0'));
	const laterTurn = laterConversation.turns.find((turn) =>
		turn.prompt.startsWith('fixture-later-message')
	);
	const manualPlan = await (
		await action(assistantPath, cookies.owner, {
			operation: 'prepare',
			chat: changesChat.id,
			turn: laterTurn.id,
			names: JSON.stringify(['manual-receipt'])
		})
	).json();
	assert.ok(
		(await json(changesPath, { cookie: cookies.owner })).turns
			.find((turn) => turn.id === laterTurn.id)
			.plans.some((plan) => plan.id === manualPlan.id)
	);
	await action(
		assistantPath,
		cookies.viewer,
		{
			operation: 'prepare',
			chat: changesChat.id,
			turn: laterTurn.id,
			name: 'manual-receipt'
		},
		404
	);
	await stop();
	await start();
	assert.ok(
		(await json(changesPath, { cookie: cookies.owner })).turns
			.find((turn) => turn.id === directTurn.id)
			.plans.some((plan) => plan.id === directReceipt.id && plan.applied)
	);
	assert.equal((await request(changesPath, { cookie: cookies.viewer })).status, 404);
	assert.equal(
		(
			await request(`/api/modlists/${choiceListId}/assistant?chat=${changesChat.id}`, {
				cookie: cookies.owner
			})
		).status,
		404
	);
	assert.ok(
		!(await json(`${assistantPath}?chat=${originalChat}`, { cookie: cookies.owner })).plans.some(
			(plan) => plan.id === directReceipt.id
		)
	);
	for (let index = 0; index < 31; index++)
		await client.execute({
			sql: 'INSERT INTO assistant_turn(id,user_id,list_id,chat_id,prompt,answer,state,created_at) VALUES (?,?,?,?,?,?,?,?)',
			args: [
				`receipt-page-${index}`,
				'owner',
				listId,
				changesChat.id,
				`Later ${index}`,
				'Saved reply',
				'done',
				Date.now() + index
			]
		});
	const receiptSnapshot = (
		await client.execute({
			sql: 'SELECT snapshot FROM modlist_plan WHERE id = ?',
			args: [directReceipt.id]
		})
	).rows[0].snapshot;
	for (let index = 0; index < 11; index++)
		await client.execute({
			sql: 'INSERT INTO modlist_plan(id,user_id,list_id,chat_id,snapshot,body,created_at,applied) VALUES (?,?,?,?,?,?,?,1)',
			args: [
				`receipt-plan-${index}`,
				'owner',
				listId,
				changesChat.id,
				receiptSnapshot,
				JSON.stringify({
					mods: [],
					changes: ['Saved receipt'],
					details: [],
					requestedChanges: [],
					requestId: `receipt-page-${index}`
				}),
				Math.floor(Date.now() / 1000) + index + 1
			]
		});
	const recentReceipts = await json(changesPath, { cookie: cookies.owner });
	assert.equal(recentReceipts.hasMore, true);
	assert.ok(!recentReceipts.turns.some((turn) => turn.id === directTurn.id));
	assert.ok(
		!recentReceipts.plans.some((plan) => plan.id === directReceipt.id),
		'The legacy top-level window has moved past the receipt'
	);
	const olderReceipts = await json(`${changesPath}&offset=30`, { cookie: cookies.owner });
	assert.ok(
		olderReceipts.turns
			.find((turn) => turn.id === directTurn.id)
			.plans.some((plan) => plan.id === directReceipt.id && plan.applied)
	);
	passed(
		'combined mod review refreshes stale snapshots; explicit apply is atomic, deduplicated, scoped and idempotent'
	);
	metadata.set(
		'legacy-alpha',
		catalog('legacy-alpha', '1.0.0', ['base >= 2.1', 'legacy-helper >= 1.0.0'])
	);
	metadata.set(
		'legacy-beta',
		catalog('legacy-beta', '1.0.0', ['base >= 2.1', 'legacy-helper >= 1.0.0'])
	);
	metadata.set('legacy-helper', catalog('legacy-helper', '1.0.0'));
	const legacyChat = await (
		await action(assistantPath, cookies.owner, { operation: 'new-chat' })
	).json();
	const legacyPath = `${assistantPath}?chat=${legacyChat.id}`;
	await client.execute({
		sql: 'INSERT INTO assistant_turn(id,user_id,list_id,chat_id,prompt,answer,mods,state,created_at) VALUES (?,?,?,?,?,?,?,?,?)',
		args: [
			'legacy-card-turn',
			'owner',
			listId,
			legacyChat.id,
			'Which of these older mods should I add?',
			'Review both cards.',
			JSON.stringify([{ name: 'legacy-alpha' }, { name: 'legacy-beta' }]),
			'done',
			Date.now() - 5000
		]
	});
	const legacyPlans = [];
	for (const name of ['legacy-alpha', 'legacy-beta'])
		legacyPlans.push(
			await (
				await action(assistantPath, cookies.owner, {
					operation: 'prepare',
					chat: legacyChat.id,
					name
				})
			).json()
		);
	for (const plan of legacyPlans) {
		const row = (
			await client.execute({
				sql: 'SELECT body FROM modlist_plan WHERE id = ?',
				args: [plan.id]
			})
		).rows[0];
		const body = JSON.parse(row.body);
		// Recreate the old receipt text along with its old schema fields.
		body.changes = body.changes.map((change) =>
			change.replace(/ \(required by [^)]+\)/u, ' (required dependency)')
		);
		delete body.requestedChanges;
		delete body.details;
		delete body.requestId;
		await client.execute({
			sql: 'UPDATE modlist_plan SET body = ? WHERE id = ?',
			args: [JSON.stringify(body), plan.id]
		});
	}
	const legacyCatalog = await json(legacyPath, { cookie: cookies.owner });
	const inferredLegacy = legacyCatalog.turns.find((turn) => turn.id === 'legacy-card-turn').plans;
	assert.equal(inferredLegacy.length, 1, 'Older per-mod reviews share one visible pending receipt');
	assert.ok(legacyPlans.some((plan) => plan.id === inferredLegacy[0].id));
	assert.equal(inferredLegacy[0].turnId, 'legacy-card-turn');
	assert.deepEqual(
		new Set(legacyCatalog.combineablePlanIds),
		new Set(legacyPlans.map((plan) => plan.id))
	);
	const combinedLegacy = await (
		await action(assistantPath, cookies.owner, {
			operation: 'combine',
			chat: legacyChat.id,
			plans: JSON.stringify(legacyPlans.map((plan) => plan.id))
		})
	).json();
	assert.deepEqual((await json(legacyPath, { cookie: cookies.owner })).combineablePlanIds, []);
	assert.ok(
		(await json(legacyPath, { cookie: cookies.owner })).turns
			.find((turn) => turn.id === 'legacy-card-turn')
			.plans.some((plan) => plan.id === combinedLegacy.id)
	);
	assert.deepEqual(combinedLegacy.details.map((detail) => detail.name).toSorted(), [
		'legacy-alpha',
		'legacy-beta',
		'legacy-helper'
	]);
	assert.equal(
		combinedLegacy.details.filter((detail) => detail.name === 'legacy-helper').length,
		1
	);
	await action(assistantPath, cookies.owner, {
		operation: 'apply',
		chat: legacyChat.id,
		plan: combinedLegacy.id
	});
	await action(assistantPath, cookies.owner, {
		operation: 'apply',
		chat: legacyChat.id,
		plan: combinedLegacy.id
	});
	assert.deepEqual(
		(
			await client.execute({
				sql: "SELECT name FROM mod WHERE modlist_id = ? AND name IN ('legacy-alpha','legacy-beta','legacy-helper') ORDER BY name",
				args: [listId]
			})
		).rows.map((row) => row.name),
		['legacy-alpha', 'legacy-beta', 'legacy-helper']
	);
	passed('separate legacy reviews combine into one dependency-safe plan and apply once');
	metadata.set('unrelated-secret', catalog('unrelated-secret', '1.0.0'));
	const sharedImport = await action(
		'/modlists/new',
		cookies.viewer,
		{
			name: 'Viewer shared list',
			factorioVersion: '2.1',
			json: JSON.stringify({ mods: [{ name: 'root-mod', enabled: true, version: '1.0.0' }] })
		},
		303
	);
	const sharedPath = sharedImport.headers.get('location');
	fixtureSharedListId = sharedPath.split('/').at(-1);
	await until(
		`/api/modlists/${fixtureSharedListId}/repair`,
		cookies.viewer,
		(value) => value?.state === 'done'
	);
	await action(`${sharedPath}?/shareAdd`, cookies.viewer, { username: 'owner' });
	const unrelatedImport = await action(
		'/modlists/new',
		cookies.stranger,
		{
			name: 'Unrelated public secret',
			factorioVersion: '2.1',
			json: JSON.stringify({
				mods: [{ name: 'unrelated-secret', enabled: true, version: '1.0.0' }]
			})
		},
		303
	);
	const unrelatedPath = unrelatedImport.headers.get('location');
	fixtureUnrelatedListId = unrelatedPath.split('/').at(-1);
	await until(
		`/api/modlists/${fixtureUnrelatedListId}/repair`,
		cookies.stranger,
		(value) => value?.state === 'done'
	);
	await action(`${unrelatedPath}?/sharePublic`, cookies.stranger, { enabled: 'true' });
	assert.equal((await request(unrelatedPath, { cookie: cookies.owner })).status, 200);
	for (const prompt of [
		'fixture-browse-lists: show my other lists',
		'fixture-inspect-shared: inspect the shared list',
		'fixture-inspect-unrelated: inspect unrelated public list',
		'fixture-compare-lists: common enabled mods'
	])
		await askChanges(prompt);
	const toolOutput = (callId) =>
		JSON.stringify(assistantToolOutputs.find((item) => item.callId === callId)?.output ?? '');
	assert.ok(toolOutput('call_browse_lists').includes(fixtureSharedListId));
	assert.ok(!toolOutput('call_browse_lists').includes(fixtureUnrelatedListId));
	assert.ok(toolOutput('call_inspect_shared').includes('Viewer shared list'));
	assert.match(toolOutput('call_inspect_unrelated'), /not found or not shared/u);
	assert.ok(!toolOutput('call_inspect_unrelated').includes('Unrelated public secret'));
	assert.ok(toolOutput('call_compare_lists').includes(fixtureSharedListId));
	assert.ok(!toolOutput('call_compare_lists').includes(fixtureUnrelatedListId));
	assert.equal(
		(
			await client.execute({
				sql: "SELECT count(*) as count FROM mod WHERE modlist_id = ? AND name IN ('direct-alpha','direct-beta','direct-helper')",
				args: [fixtureSharedListId]
			})
		).rows[0].count,
		0,
		'Assistant writes stayed on its current list'
	);
	passed(
		'cross-list assistant reads owned and shared lists without exposing unrelated public lists or changing them'
	);
	const staleCompat = catalog('fresh-compat', '0.7.4');
	staleCompat.releases[0].info_json.factorio_version = '2.0';
	const freshCompat = catalog('fresh-compat', '0.8.0');
	metadata.set('fresh-compat', freshCompat);
	await client.execute({
		sql: 'INSERT INTO portal_cache(key,body,status,fetched_at,retry_after) VALUES (?,?,200,?,0)',
		args: ['mod:fresh-compat', JSON.stringify(staleCompat), Date.now()]
	});
	const compatCalls = calls.get('/portal/api/mods/fresh-compat/full') ?? 0;
	const freshPlan = await (
		await action(assistantPath, cookies.owner, {
			operation: 'prepare',
			chat: changesChat.id,
			name: 'fresh-compat'
		})
	).json();
	assert.equal(calls.get('/portal/api/mods/fresh-compat/full'), compatCalls + 1);
	assert.equal(freshPlan.details.find((detail) => detail.name === 'fresh-compat').version, '0.8.0');
	assert.equal(
		(
			await client.execute({
				sql: "SELECT count(*) as count FROM mod WHERE modlist_id = ? AND name = 'fresh-compat'",
				args: [listId]
			})
		).rows[0].count,
		0
	);
	passed('an incompatible warm portal catalog refreshes before a Factorio 2.1 mod review');
	const provisionZip = Buffer.from(
		zipSync({
			'provision-mod_1.0.0/info.json': strToU8(
				JSON.stringify({
					name: 'provision-mod',
					version: '1.0.0',
					factorio_version: '2.1',
					dependencies: ['base >= 2.1']
				})
			)
		})
	);
	const provisionSha = createHash('sha1').update(provisionZip).digest('hex');
	const provisionCatalog = catalog('provision-mod', '1.0.0');
	provisionCatalog.releases[0].sha1 = provisionSha;
	metadata.set('provision-mod', provisionCatalog);
	await client.execute({
		sql: 'INSERT INTO portal_cache(key,body,status,fetched_at,retry_after) VALUES (?,?,200,?,0)',
		args: ['mod:provision-mod', JSON.stringify(provisionCatalog), Date.now()]
	});
	await writeFile(join(cache, 'mods', `provision-mod_1.0.0_${provisionSha}.zip`), provisionZip);
	const provisionImport = await action(
		'/modlists/new',
		cookies.owner,
		{
			name: 'Provision source',
			factorioVersion: '2.1',
			json: JSON.stringify({ mods: [{ name: 'provision-mod', enabled: true, version: '1.0.0' }] })
		},
		303
	);
	const provisionListId = provisionImport.headers.get('location').split('/').at(-1);
	await client.execute(
		"UPDATE user SET factorio_username = 'fixture', factorio_token = 'fixture-token' WHERE id = 'owner'"
	);
	await until(
		`/api/modlists/${provisionListId}/repair`,
		cookies.owner,
		(value) => value?.state === 'done'
	);
	const provisionPath = `/api/modlists/${provisionListId}/assistant`;
	const provisionChat = await (
		await action(provisionPath, cookies.owner, { operation: 'new-chat' })
	).json();
	const provisionHistory = `${provisionPath}?chat=${provisionChat.id}`;
	setupDownloadOffline = true;
	const provisionReply = await request(provisionPath, {
		cookie: cookies.owner,
		method: 'POST',
		form: {
			chat: provisionChat.id,
			prompt: 'fixture-provision-create: create a server with this list now',
			model: 'gpt-6-sol'
		}
	});
	assert.equal(provisionReply.status, 200, await provisionReply.clone().text());
	assert.match(await provisionReply.text(), /"results"/u);
	const provisionTurn = (await json(provisionHistory, { cookie: cookies.owner })).turns.find(
		(turn) => turn.prompt.startsWith('fixture-provision-create')
	);
	const setupReceipts = provisionTurn.results.filter(
		(item) => item.tool === 'create_server_from_list'
	);
	assert.equal(setupReceipts.length, 2, JSON.stringify(provisionTurn.results));
	const setupId = setupReceipts[0].result.serverId;
	assert.ok(setupId);
	assert.equal(setupReceipts[1].result.serverId, setupId);
	assert.equal(
		(
			await client.execute({
				sql: 'SELECT count(*) as count FROM native_server_provision_job WHERE server_id = ?',
				args: [setupId]
			})
		).rows[0].count,
		1
	);
	assert.ok(
		codexMenus.some(
			(menu) =>
				menu.request.includes('fixture-provision-create') &&
				menu.tools.includes('create_server_from_list') &&
				menu.tools.includes('inspect_server_setup')
		)
	);
	assert.ok(
		!codexMenus
			.find((menu) => menu.request.includes('fixture-provision-create'))
			.tools.includes('prepare_changes')
	);
	const setupQuery = `${provisionHistory}&setup=${setupId}`;
	const failedSetup = await until(setupQuery, cookies.owner, (value) => value.status === 'failed');
	assert.match(failedSetup.error, /Factorio download returned HTTP 503/u);
	assert.equal((await request(setupQuery, { cookie: cookies.viewer })).status, 403);
	const otherProvisionChat = await (
		await action(provisionPath, cookies.owner, { operation: 'new-chat' })
	).json();
	assert.equal(
		(
			await request(`${provisionPath}?chat=${otherProvisionChat.id}&setup=${setupId}`, {
				cookie: cookies.owner
			})
		).status,
		404
	);
	assert.equal(
		(
			await request(`/api/modlists/${listId}/assistant?chat=${changesChat.id}&setup=${setupId}`, {
				cookie: cookies.owner
			})
		).status,
		404
	);
	await action(
		provisionPath,
		cookies.owner,
		{
			operation: 'retry-server-setup',
			chat: otherProvisionChat.id,
			setup: setupId
		},
		404
	);
	await action(
		provisionPath,
		cookies.viewer,
		{
			operation: 'retry-server-setup',
			chat: provisionChat.id,
			setup: setupId
		},
		403
	);
	setupDownloadOffline = false;
	const retried = await (
		await action(provisionPath, cookies.owner, {
			operation: 'retry-server-setup',
			chat: provisionChat.id,
			setup: setupId
		})
	).json();
	assert.equal(retried.serverId, setupId);
	const readySetup = await until(setupQuery, cookies.owner, (value) => value.status === 'done');
	assert.equal(readySetup.stage, 'ready');
	assert.equal(readySetup.enabledMods, 1);
	assert.deepEqual(
		(
			await action(provisionPath, cookies.owner, {
				operation: 'retry-server-setup',
				chat: provisionChat.id,
				setup: setupId
			})
		).status,
		200
	);
	const storedSetup = (await json(provisionHistory, { cookie: cookies.owner })).turns
		.find((turn) => turn.id === provisionTurn.id)
		.results.find((item) => item.tool === 'create_server_from_list').result;
	assert.equal(storedSetup.status, 'done', 'Saved assistant results reflect the live setup job');
	const setupServer = (
		await client.execute({
			sql: 'SELECT directory FROM native_server WHERE id = ?',
			args: [setupId]
		})
	).rows[0];
	assert.ok(setupServer);
	const setupModList = JSON.parse(
		await readFile(join(setupServer.directory, 'mods/mod-list.json'), 'utf8')
	);
	assert.ok(setupModList.mods.some((mod) => mod.name === 'provision-mod' && mod.enabled));
	assert.deepEqual(
		await readFile(join(setupServer.directory, 'mods/provision-mod_1.0.0.zip')),
		provisionZip
	);
	assert.ok((await readFile(join(setupServer.directory, 'saves/world.zip'))).length > 0);
	await stop();
	await start();
	assert.equal((await json(setupQuery, { cookie: cookies.owner })).status, 'done');
	await client.execute({
		sql: "UPDATE assistant_turn SET state = 'error', results = '[]' WHERE id = ?",
		args: [provisionTurn.id]
	});
	const recoveredSetup = (await json(provisionHistory, { cookie: cookies.owner })).turns
		.find((turn) => turn.id === provisionTurn.id)
		.results.find((item) => item.tool === 'create_server_from_list');
	assert.equal(recoveredSetup.result.serverId, setupId);
	assert.equal(recoveredSetup.result.status, 'done');
	assert.equal((await json(setupQuery, { cookie: cookies.owner })).status, 'done');
	passed(
		'modlist assistant creates one scoped server, retries failed setup, and recovers a missing result after restart'
	);
	metadata.set(
		'recommend-base',
		catalog('recommend-base', '1.0.0', ['base >= 2.1', '? blueprint-shotgun'])
	);
	metadata.set('blueprint-shotgun', catalog('blueprint-shotgun', '1.0.0'));
	for (const name of ['recommend-base', 'blueprint-shotgun'])
		await client.execute({
			sql: 'INSERT INTO portal_cache(key,body,status,fetched_at,retry_after) VALUES (?,?,200,?,0)',
			args: [`mod:${name}`, JSON.stringify(metadata.get(name)), Date.now()]
		});
	const recommendationImport = await action(
		'/modlists/new',
		cookies.owner,
		{
			name: 'Recommendation source',
			factorioVersion: '2.1',
			json: JSON.stringify({ mods: [{ name: 'recommend-base', enabled: true, version: '1.0.0' }] })
		},
		303
	);
	const recommendationListId = recommendationImport.headers.get('location').split('/').at(-1);
	await until(
		`/api/modlists/${recommendationListId}/repair`,
		cookies.owner,
		(value) => value?.state === 'done'
	);
	const recommendationPath = `/api/modlists/${recommendationListId}/recommendations`;
	const recommendationAssistantPath = `/api/modlists/${recommendationListId}/assistant`;
	const panelRanking = await json(recommendationPath, {
		cookie: cookies.owner,
		method: 'POST',
		body: { names: ['blueprint-shotgun'], dismissed: [] }
	});
	assert.ok(panelRanking.scores['blueprint-shotgun']);
	const askRecommendation = async (prompt) => {
		const response = await request(recommendationAssistantPath, {
			cookie: cookies.owner,
			method: 'POST',
			form: { prompt, model: 'gpt-6-sol' }
		});
		assert.equal(response.status, 200);
		assert.match(await response.text(), /"done":true/u);
	};
	await askRecommendation('fixture-ranked-recommendations: what should I add?');
	const rankedOutput = JSON.parse(
		assistantToolOutputs.findLast((item) => item.callId === 'call_ranked_recommendations').output
	);
	assert.deepEqual(
		rankedOutput.candidates.map((item) => item.name),
		['blueprint-shotgun']
	);
	assert.deepEqual(rankedOutput.candidates[0].rating, panelRanking.scores['blueprint-shotgun']);
	await askRecommendation('fixture-dismiss-recommendation: dismiss Blueprint Shotgun');
	assert.ok(
		codexMenus.some(
			(menu) =>
				menu.request.includes('fixture-dismiss-recommendation') &&
				menu.tools.includes('dismiss_recommendations')
		)
	);
	assert.deepEqual((await json(recommendationPath, { cookie: cookies.owner })).dismissed, [
		'blueprint-shotgun'
	]);
	assert.equal(
		(
			await client.execute({
				sql: "SELECT count(*) as count FROM mod WHERE modlist_id = ? AND name = 'blueprint-shotgun'",
				args: [recommendationListId]
			})
		).rows[0].count,
		0
	);
	await askRecommendation('fixture-ranked-recommendations: what should I add now?');
	const afterDismissal = JSON.parse(
		assistantToolOutputs.findLast((item) => item.callId === 'call_ranked_recommendations').output
	);
	assert.deepEqual(afterDismissal.candidates, []);
	await askRecommendation(
		'fixture-restore-and-rank: restore Blueprint Shotgun, then rank suggestions'
	);
	assert.deepEqual((await json(recommendationPath, { cookie: cookies.owner })).dismissed, []);
	const afterRestore = JSON.parse(
		assistantToolOutputs.findLast((item) => item.callId === 'call_restore_and_rank_read').output
	);
	assert.deepEqual(
		afterRestore.candidates.map((item) => item.name),
		['blueprint-shotgun']
	);
	const compoundCalls = codexMenus.filter((menu) =>
		menu.request.includes('fixture-restore-and-rank')
	);
	assert.ok(compoundCalls.length >= 3);
	assert.ok(compoundCalls.every((menu) => menu.parallelToolCalls === false));
	assert.deepEqual(
		[
			...new Set(
				assistantToolOutputs
					.filter((item) => item.callId.startsWith('call_restore_and_rank_'))
					.map((item) => item.callId)
			)
		],
		['call_restore_and_rank_restore', 'call_restore_and_rank_read']
	);
	passed(
		'assistant and panel share ranked recommendations; restored preferences are ranked after the write'
	);
	await askChanges('fixture-lock-mod: lock root-mod as essential now');
	assert.equal(
		(
			await client.execute({
				sql: "SELECT essential FROM mod WHERE modlist_id = ? AND name = 'root-mod'",
				args: [listId]
			})
		).rows[0].essential,
		1
	);
	await askChanges('fixture-disable-locked: disable root-mod now');
	const lockedState = (
		await client.execute({
			sql: "SELECT essential,enabled FROM mod WHERE modlist_id = ? AND name = 'root-mod'",
			args: [listId]
		})
	).rows[0];
	assert.equal(lockedState.essential, 1);
	assert.equal(lockedState.enabled, 1);
	await askChanges('fixture-unlock-disable: unlock and disable root-mod now');
	const unlockedState = (
		await client.execute({
			sql: "SELECT essential,enabled FROM mod WHERE modlist_id = ? AND name = 'root-mod'",
			args: [listId]
		})
	).rows[0];
	assert.equal(unlockedState.essential, 0);
	assert.equal(unlockedState.enabled, 0);
	passed(
		'assistant locks an essential mod, rejects disabling it, then unlocks and disables atomically'
	);
	const askChoice = async (prompt) => {
		const response = await request(`/api/modlists/${choiceListId}/assistant`, {
			cookie: cookies.owner,
			method: 'POST',
			form: { prompt, model: 'gpt-6-sol' }
		});
		assert.equal(response.status, 200);
		assert.match(await response.text(), /"done":true/u);
	};
	await askChoice('fixture-select-release: select choice 2.0.0 now');
	assert.deepEqual(
		(
			await client.execute({
				sql: "SELECT name,version FROM mod WHERE modlist_id = ? AND name IN ('choice','choice-dependency') ORDER BY name",
				args: [choiceListId]
			})
		).rows.map((row) => [row.name, row.version]),
		[
			['choice', '2.0.0'],
			['choice-dependency', '2.0.0']
		]
	);
	await askChoice('fixture-select-incompatible: select choice 3.0.0 now');
	assert.equal(
		(
			await client.execute({
				sql: "SELECT version FROM mod WHERE modlist_id = ? AND name = 'choice'",
				args: [choiceListId]
			})
		).rows[0].version,
		'2.0.0'
	);
	await askChoice('fixture-icebox-absent: put cold-mod in icebox now');
	const iceboxedAbsent = (
		await client.execute({
			sql: "SELECT enabled,icebox FROM mod WHERE modlist_id = ? AND name = 'cold-mod'",
			args: [choiceListId]
		})
	).rows[0];
	assert.equal(iceboxedAbsent.enabled, 0);
	assert.equal(iceboxedAbsent.icebox, 1);
	passed(
		'assistant selects a compatible release, rejects an incompatible one, and iceboxes an absent mod'
	);
	metadata.set(
		'bundle-dependent',
		catalog('bundle-dependent', '1.0.0', ['base >= 2.1', 'quality'])
	);
	await client.execute({
		sql: 'INSERT INTO portal_cache(key,body,status,fetched_at,retry_after) VALUES (?,?,200,?,0)',
		args: ['mod:bundle-dependent', JSON.stringify(metadata.get('bundle-dependent')), Date.now()]
	});
	const bundledImport = await action(
		'/modlists/new',
		cookies.owner,
		{
			name: 'Bundled actions',
			factorioVersion: '2.1',
			json: JSON.stringify({
				mods: [
					{ name: 'quality', enabled: true },
					{ name: 'bundle-dependent', enabled: true, version: '1.0.0' }
				]
			})
		},
		303
	);
	const bundledListId = bundledImport.headers.get('location').split('/').at(-1);
	await until(
		`/api/modlists/${bundledListId}/repair`,
		cookies.owner,
		(value) => value?.state === 'done'
	);
	const askBundled = async (prompt) => {
		const response = await request(`/api/modlists/${bundledListId}/assistant`, {
			cookie: cookies.owner,
			method: 'POST',
			form: { prompt, model: 'gpt-6-sol' }
		});
		assert.equal(response.status, 200);
		assert.match(await response.text(), /"done":true/u);
	};
	await askBundled('fixture-bundled-lock: lock quality now');
	assert.equal(
		(
			await client.execute({
				sql: "SELECT essential FROM mod WHERE modlist_id = ? AND name = 'quality'",
				args: [bundledListId]
			})
		).rows[0].essential,
		1
	);
	await askBundled('fixture-bundled-unlock: unlock quality now');
	assert.equal(
		(
			await client.execute({
				sql: "SELECT essential FROM mod WHERE modlist_id = ? AND name = 'quality'",
				args: [bundledListId]
			})
		).rows[0].essential,
		0
	);
	await askBundled('fixture-bundled-disable: disable quality now');
	assert.equal(
		(
			await client.execute({
				sql: "SELECT enabled FROM mod WHERE modlist_id = ? AND name = 'quality'",
				args: [bundledListId]
			})
		).rows[0].enabled,
		1
	);
	passed(
		'assistant locks and unlocks bundled mods while required dependencies block disabling them'
	);
	console.info(`${checks} HTTP workflow checks passed.`);
} catch (cause) {
	console.error(logs);
	throw cause;
} finally {
	blockReleases?.resolve();
	await stop();
	client?.close();
	fixture.closeAllConnections();
	await new Promise((done) => fixture.close(done));
	await rm(directory, { recursive: true, force: true });
}
