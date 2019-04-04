const http = require('http');
const https = require('https');

const Utils = require('./utils');

module.exports.parseStatus = (res, sampleErr) => {
	if (res.statusCode < 200 || res.statusCode > 299) {
		const err = new Error(res.body.message);
		err.statusCode = res.statusCode;
		if (sampleErr) err.stack = sampleErr.stack;
		throw err;
	}
	return;
};

module.exports.clusterOptions = (kubeconfig, method, path) => {
	const ctx = Utils.extractCurrentContext(kubeconfig);
	const clusterDescription = ctx.cluster;
	const portRx = /(https?:)\/\/(.*):([0-9]+)\/?$/;
	const rxResults = portRx.exec(clusterDescription.cluster.server);
	const port = parseInt(rxResults[3]);
	const hostname = rxResults[2];
	const protocol = rxResults[1];
	if (!path) path = '/';
	if (!method) method = 'get';
	const baseOptions = {
		hostname,
		port,
		protocol,
		path,
		method
	};

	const caCert = clusterDescription.cluster['certificate-authority-data'];
	if (caCert && typeof(caCert) === 'string') {
		const certBuf = Buffer.from(caCert, 'base64');
		baseOptions.agent = new https.Agent({
			ca: certBuf.toString('utf-8')
		});
	}

	const user = ctx.user;
	if (user.user.username && user.user.password) {
		baseOptions.auth = `${user.user.username}:${user.user.password}`;
	}

	return baseOptions;
};

module.exports.cluster = (kubeconfig, method, path) => {
	const options = module.exports.clusterOptions(kubeconfig, method, path);
	return module.exports.generic(options);
};

module.exports.generic = (options, noParse) => {
	return new Promise((resolv, reject) => {
		const req = http.request(options, (res) => {
			const body = [];
			res.on('data', (d) => {
				return body.push(d);
			});
			res.on('end', () => {
				const bodyStr = body.join('');
				const respData = noParse ? bodyStr : JSON.parse(bodyStr);

				return resolv({
					statusCode: res.statusCode,
					body: respData,
					res,
					req
				});
			});
		});

		req.on('error', (err) => {
			if (!err.statusCode) err.statusCode = 500;
			return reject(err);
		});

		req.end();
	});
};
