import { error } from '@sveltejs/kit';
import { zipSync } from 'fflate';
import control from '../../../../factorio-mod/facmandu-assistant/control.lua?raw';
import info from '../../../../factorio-mod/facmandu-assistant/info.json';
import readme from '../../../../factorio-mod/facmandu-assistant/README.md?raw';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = ({ locals }) => {
	if (!locals.user) error(401, 'Sign in first');
	const folder = `${info.name}_${info.version}`;
	const encode = new TextEncoder();
	const files = Object.fromEntries(
		Object.entries({
			'info.json': JSON.stringify(info),
			'control.lua': control,
			'README.md': readme
		}).map(([name, source]) => [`${folder}/${name}`, encode.encode(source)])
	);
	return new Response(new Uint8Array(zipSync(files)), {
		headers: {
			'Content-Type': 'application/zip',
			'Content-Disposition': `attachment; filename="${folder}.zip"`,
			'Cache-Control': 'private, no-store'
		}
	});
};
