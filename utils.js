/**
 * Get context and cluster from current context.
 *
 * @param {Object} kubeconfigFile Cluster's kubeconfig file
 * @returns {Object} Object contains:
 *                   {
 *                       context: { ... },
 *                       cluster: { ... }
 *                   }
 */
module.exports.extractCurrentContext = (kubeconfigFile) => {
	if (!kubeconfigFile || typeof(kubeconfigFile) !== 'object') return undefined;

	const currentContextName = kubeconfigFile['current-context'];
	if (!currentContextName) {
		return undefined;
	}

	const contexts = kubeconfigFile.contexts;
	let context;
	if (Array.isArray(contexts) && contexts.length > 0) {
		for (const c of contexts) {
			if (c.name === currentContextName) {
				context = c;
				break;
			}
		}
	}

	if (!context) {
		return undefined;
	}

	const clusterName = context.context.cluster;

	let cluster;
	const clusters = kubeconfigFile.clusters;
	if (Array.isArray(clusters) && clusters.length > 0) {
		for (const c of clusters) {
			if (c.name === clusterName) {
				cluster = c;
				break;

			}
		}
	}

	const userName = context.context.user;

	let user;
	const users = kubeconfigFile.users;
	if (Array.isArray(users) && users.length > 0) {
		for (const u of users) {
			if (u.name === userName) {
				user = u;
				break;
			}
		}
	}

	return {
		cluster,
		context,
		user
	};
};

/**
 * Extracts the Kubernetes version up to the third digit, removing any leading
 * 'v'.
 *
 * @param {String} verStr String containing version number
 * @param {Number} precision Precision to get version up to
 * @returns {String} Precise version string
 */
module.exports.prettifyVersion = (verStr, precision) => {
	if (!precision) precision = 3;

	const versionArr = verStr.split('.');
	if (versionArr[0][0] === 'v') versionArr[0] = versionArr[0].substr(1);

	let pretty = '';
	for (let i = 0; i < precision && i < versionArr.length; ++i) {
		pretty += (i > 0 ? '.' : '') + versionArr[i];
	}

	return pretty;
};
