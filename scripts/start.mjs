const configuredOrigin = process.env.ORIGIN;
const origin = configuredOrigin ? new URL(configuredOrigin) : null;
if (origin) {
	if (
		!['http:', 'https:'].includes(origin.protocol) ||
		origin.username ||
		origin.password ||
		origin.pathname !== '/' ||
		origin.search ||
		origin.hash
	) {
		throw new Error('ORIGIN must be an HTTP or HTTPS origin');
	}
	process.env.PROTOCOL_HEADER = 'x-facmandu-origin-protocol';
	process.env.HOST_HEADER = 'x-facmandu-origin-host';
	process.env.PORT_HEADER = '';
}

const { server } = await import('../build/index.js');
if (origin) {
	server.prependListener('request', (request) => {
		request.headers['x-facmandu-origin-protocol'] = origin.protocol.slice(0, -1);
		request.headers['x-facmandu-origin-host'] = origin.host;
	});
}

export { server };
