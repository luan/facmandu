import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { strToU8, zipSync } from 'fflate';
import { resolveModSettingLocale } from '../src/lib/server/mod-settings-locale';
import type { SettingDef } from '../src/lib/server/mod-settings-lua';

const base: SettingDef = {
	name: 'my-mod-choice',
	type: 'string-setting',
	kind: 'string',
	settingType: 'startup',
	default: 'red',
	allowed: ['red', 'blue'],
	order: ''
};

test('resolves setting names, rich descriptions, choices, parameters and prototype names from zip locale', async () => {
	const root = await mkdtemp(join(tmpdir(), 'facmandu-locale-'));
	try {
		await writeFile(
			join(root, 'my-mod_1.2.3.zip'),
			zipSync({
				'my-mod_1.2.3/locale/en/a.cfg': strToU8(
					[
						'[mod-setting-name]',
						'my-mod-choice=Choose a color',
						'[mod-setting-description]',
						'my-mod-choice=Use __ITEM__copper-plate__\\n[item=copper-plate] __1__',
						'[string-mod-setting]',
						'my-mod-choice-red=Bright red',
						'[item-name]',
						'copper-plate=Copper plate',
						'[test]',
						'prefix=Tint __1__'
					].join('\n')
				),
				'my-mod_1.2.3/locale/de/ignored.cfg': strToU8('[mod-setting-name]\nmy-mod-choice=Farbe'),
				'my-mod_1.2.3/graphics/large.bin': new Uint8Array(1024 * 1024)
			})
		);
		const defs = [
			{
				...base,
				localisedName: ['test.prefix', ['item-name.copper-plate']],
				localisedDescription: [
					'?',
					['missing.key'],
					['', ['mod-setting-description.my-mod-choice', 'now']]
				]
			}
		];
		const [resolved] = await resolveModSettingLocale(root, 'my-mod', '1.2.3', defs);
		assert.equal(resolved?.label, 'Tint Copper plate');
		assert.equal(resolved?.description, 'Use Copper plate\n[item=copper-plate] now');
		assert.deepEqual(resolved?.allowedLabels, { red: 'Bright red', blue: 'Blue' });
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

test('reads unpacked English cfg and gives readable fallback for missing keys', async () => {
	const root = await mkdtemp(join(tmpdir(), 'facmandu-locale-'));
	try {
		const directory = join(root, 'my-mod', 'locale', 'en');
		await mkdir(directory, { recursive: true });
		await writeFile(
			join(directory, 'names.cfg'),
			'[mod-setting-name]\nmy-mod-choice= Select a color\n; comment\n'
		);
		const result = await resolveModSettingLocale(root, 'my-mod', 'unpacked', [
			base,
			{
				...base,
				name: 'my-mod-other',
				localisedName: ['missing.key'],
				localisedDescription: ['?', ['missing.description'], 'Fallback tooltip']
			}
		]);
		assert.equal(result[0]?.label, ' Select a color');
		assert.equal(result[1]?.label, 'My mod other');
		assert.equal(result[1]?.description, 'Fallback tooltip');
		assert.equal(result[1]?.allowedLabels?.red, 'Red');
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

test('uses an unpacked directory when the selected archive is absent', async () => {
	const root = await mkdtemp(join(tmpdir(), 'facmandu-locale-'));
	try {
		const directory = join(root, 'my-mod', 'locale', 'en');
		await mkdir(directory, { recursive: true });
		await writeFile(
			join(directory, 'names.cfg'),
			'[mod-setting-name]\nmy-mod-choice=Installed directory\n'
		);
		const [resolved] = await resolveModSettingLocale(root, 'my-mod', '1.2.3', [base]);
		assert.equal(resolved?.label, 'Installed directory');
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

test('refreshes archive locale when the file changes and keeps special enum keys', async () => {
	const root = await mkdtemp(join(tmpdir(), 'facmandu-locale-'));
	try {
		const archive = join(root, 'my-mod_1.2.3.zip');
		const makeZip = (label: string) =>
			zipSync({
				'my-mod_1.2.3/locale/en/settings.cfg': strToU8(
					`[mod-setting-name]\nmy-mod-choice=${label}\n[string-mod-setting]\nmy-mod-choice-__proto__=[color=red]Special[/color]\n[mod-setting-description]\nmy-mod-choice=Use __CONTROL__open-technology-gui__ and __ALT_CONTROL__1__build__ __REMARK_COLOR_BEGIN__now__REMARK_COLOR_END__`
				)
			});
		await writeFile(archive, makeZip('First'));
		const defs = [{ ...base, allowed: ['__proto__'] }];
		assert.equal((await resolveModSettingLocale(root, 'my-mod', '1.2.3', defs))[0]?.label, 'First');
		await writeFile(archive, makeZip('After'));
		const later = new Date(Date.now() + 10_000);
		await utimes(archive, later, later);
		const [resolved] = await resolveModSettingLocale(root, 'my-mod', '1.2.3', defs);
		assert.equal(resolved?.label, 'After');
		assert.equal(Object.hasOwn(resolved?.allowedLabels ?? {}, '__proto__'), true);
		assert.equal(Reflect.get(resolved?.allowedLabels ?? {}, '__proto__'), 'Special');
		assert.equal(
			resolved?.description,
			'Use Open technology gui control and Build control (alternate 1) now'
		);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});
