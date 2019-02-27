// Third-party libs
const axios = require('axios');
const https = require('https');
const Kubernetes = require('kubernetes-client');
const K8sClient = Kubernetes.Client;
const K8sConfig = Kubernetes.config;

// Local libs
const APIMap = require('./apimap');
const Utils = require('./utils');

// Default namespace is used when a request for a namespaced resource is made but no namespace is provided
let defaultNamespace = 'default';

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

	if (!cluster) {
		return undefined;
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

	if (!user) {
		return undefined;
	}

	return {
		cluster,
		context,
		user
	};
};

/**
 * Creates a Kubernetes client which can be used to communicate with the
 * Kubernetes master API
 *
 * @param {Object} kubeconfig Cluster's kubeconfig object
 * @param {String} apiVersion Specify that the client should be for a particular application group
 *                            and version. Useful avoid having to check for different API versions and
 *                            customizing the called route for each version.
 * @return {Object} Promise
 */
module.exports.getKubernetesClient = async (kubeconfig, apiVersion) => {
	const kubeconfigCopy = JSON.parse(JSON.stringify(kubeconfig));

	const configObj = K8sConfig.fromKubeconfig(kubeconfigCopy);
	const client = new K8sClient({config: configObj});

	try {
		await client.loadSpec();
	} catch(err) {
		// Try and add the status code as it's not provided
		// Regex matches a colon, any number of spaces, and then 3 numbers before the end of the message
		const rx = /(:[ ]*)([0-9]{3}$)/;
		const errMsg = err.message;

		const rxResults = rx.exec(errMsg);

		if (rxResults) {
			try {
				const statusCode = parseInt(rxResults[2]);
				err.statusCode = statusCode;
			} catch (err) {
				err.statusCode = 500;
			}
		} else {
			err.statusCode = 500;
		}

		throw err;
	}

	if (apiVersion && typeof(apiVersion) === 'string') {
		const verSplit = apiVersion.split('/');
		if (verSplit.length === 1) {
			return client.api[verSplit[0]];
		}
		else if (verSplit.length === 2) {
			return client.apis[verSplit[0]][verSplit[1]];
		} else {
			return null;
		}
	}

	return client;
};

/**
 * Changes the default namespace to the one specified.
 *
 * @param {String} newDefault Namespace in the cluster to use by default
 * @returns {void}
 */
module.exports.changeDefaultNamespace = function(newDefault) {
	if (newDefault && typeof(newDefault) === 'string') defaultNamespace = newDefault;
};

/**
 * Hits the version endpoint and retrieves metadata about the kubemaster.
 *
 * @param {Object} kubeconfig Kubeconfig object for the cluster
 * @returns Promise
 */
module.exports.getVersion = function (kubeconfig) {
	if (!kubeconfig || typeof(kubeconfig) !== 'object') {
		const err = new Error('\'kubeconfig\' parameter must be an object');
		err.status = 400;
		throw err;
	}

	const currentContext = this.extractCurrentContext(kubeconfig);
	const ip = currentContext.cluster.cluster.server;
	const url = `${ip}${ip[ip.length - 1] !== '/' ? '/' : ''}version`;

	const certBuf = Buffer.from(currentContext.cluster.cluster['certificate-authority-data'], 'base64');
	const options = {
		httpsAgent: new https.Agent({
			ca: certBuf.toString('utf-8')
		})
	};

	return axios.get(url, options)
		.then((resp) => {
			return resp.data;
		})
		.catch((err) => {
			throw Utils.axiosHandler(err);
		});
};

/**
 * Gets a k8s lib request chain for the given resource type and name in the given namespace.
 *
 * @param {Object} kubeconfig Cluster's kubeconfig file
 * @param {String} namespace (Optional) Namespace the resource is in, can be falsy to use the default
 *                           namespace or 'all' to target all namespaces. Leave falsy if the
 *                           resource is not namespaced at all.
 * @param {String} resourceType Type of the resource, can be singular or plural
 * @param {String} resourceName (Optional) Non-falsy to specify a specific resource name
 * @returns K8s lib request chain ready for making request
 */
module.exports.buildChain = async (kubeconfig, namespace, resourceType, resourceName) => {
	resourceType = resourceType.toLowerCase();

	// Cluster version defines which API group we'll use
	const verResp = await this.getVersion(kubeconfig);
	const clusterVer = Utils.prettifyVersion(verResp.gitVersion, 2);

	// Get the API group for the resource
	let apiGroupInfo = APIMap.getGroupInfo(clusterVer, resourceType);
	if (!apiGroupInfo) {
		await APIMap.buildAPIMap(kubeconfig);
	}
	apiGroupInfo = APIMap.getGroupInfo(clusterVer, resourceType);
	if (!apiGroupInfo) {
		const err = new Error(`Could not get API group info for resource '${resourceType}' in cluster with k8s version '${clusterVer}'`);
		err.statusCode = 500;
		throw err;
	}

	// Get the client to communicate with the cluster
	const client = await this.getKubernetesClient(kubeconfig, apiGroupInfo.version);

	// Chain is built progressively to allow for flexible namespacing and resource naming
	let reqChain = client;

	if (apiGroupInfo.namespaced && namespace !== 'all') {
		if (!namespace || typeof(namespace) !== 'string') namespace = defaultNamespace;
		reqChain = reqChain.namespaces(namespace);
	}

	reqChain = reqChain[resourceType];

	if (resourceName && typeof(resourceName) === 'string') {
		reqChain = reqChain(resourceName);
	}

	return reqChain;
};

/**
 * Gets the desired resource from the cluster.
 *
 * @param {Object} cluster Cluster object from cluster manager
 * @param {String} namespace (Optional) Namespace the resource is in, can be falsy to use the default
 *                           namespace or 'all' to target all namespaces. Leave falsy if the
 *                           resource is not namespaced at all.
 * @param {String} resourceType Type of the resource to retrieve, can be singular or plural
 * @param {String} resourceName (Optional) Non-falsy to specify a specific resource to get
 * @param {String} options (Optional) Pass options to get command
 * @returns Promise
 */
module.exports.get = async (kubeconfig, namespace, resourceType, resourceName, options) => {
	const reqChain = await this.buildChain(kubeconfig, namespace, resourceType, resourceName);
	return reqChain.get(options);
};

/**
 * Gets the desired logs from the cluster pod container.
 *
 * @param {Object} kubeconfig Cluster object from cluster manager
 * @param {String} namespace (Optional) Namespace the resource is in, can be falsy to use the default
 *                           namespace or 'all' to target all namespaces. Leave falsy if the
 *                           resource is not namespaced at all.
 * @param {String} resourceName (Optional) Non-falsy to specify a specific resource to get
 * @param {String} options (Optional) Pass options to get command
 * @returns Promise
 */
module.exports.logs = async (kubeconfig, namespace, resourceName, options) => {
	const reqChain = await this.buildChain(kubeconfig, namespace, 'pod', resourceName, options);
	return reqChain.log.get(options);
};

/**
 * Deletes the given resource from the cluster.
 *
 * @param {Object} kubeconfig Cluster's kubeconfig object
 * @param {String} namespace (Optional) Namespace the resource is in, can be falsy to use the default
 *                           namespace or 'all' to target all namespaces. Leave falsy if the
 *                           resource is not namespaced at all.
 * @param {String} resourceType Type of the resource to retrieve, can be singular or plural
 * @param {String} resourceName (Optional) Non-falsy to specify a specific resource to get
 * @param {String} options (Optional) Pass options to get command
 * @returns Promise
 */
module.exports.delete = async (kubeconfig, namespace, resourceType, resourceName, options) => {
	const reqChain = await this.buildChain(kubeconfig, namespace, resourceType, resourceName);
	return reqChain.delete(options);
};

/**
 * Updates or creates the given resource in the cluster.
 *
 * @param {Object} kubeconfig Cluster's kubeconfig object
 * @param {Object} resourceSpec Kubernetes specification file for the resource
 * @returns Promise
 */
module.exports.updateOrCreate = async (kubeconfig, resourceSpec) => {
	const namespace = resourceSpec.metadata.namespace;
	const resourceType = resourceSpec.kind.toLowerCase();
	const reqChain = await this.buildChain(kubeconfig, namespace, resourceType);
	return reqChain(resourceSpec.metadata.name).patch({
		headers: {
			'content-type': 'application/merge-patch+json'
		},
		body: resourceSpec
	}).catch((err) => {
		if (err && typeof(err) === 'object' && err.code === 404) {
			return reqChain.post({body: resourceSpec});
		} else {
			throw err;
		}
	});
};

module.exports.buildDockerSecret = (secretName, namespace, repositoryURL, dockerUsername, dockerPassword) => {
	const secretJSON = {
		kind: 'Secret',
		metadata: {},
		data: {},
		type: 'kubernetes.io/dockerconfigjson'
	};

	const rawAuthToken = `${dockerUsername}:${dockerPassword}`;
	const b64AuthToken = new Buffer(rawAuthToken).toString('base64');
	const authObj = {
		auths: {}
	};
	authObj.auths[repositoryURL] = {
		auth: b64AuthToken
	};

	const rawAuthString = JSON.stringify(authObj);
	const b64AuthString = new Buffer(rawAuthString).toString('base64');

	secretJSON.metadata.name = secretName;
	secretJSON.metadata.namespace = namespace || 'default';
	secretJSON.data['.dockerconfigjson'] = b64AuthString;

	return secretJSON;
};

module.exports.buildGenericSecret = (secretName, namespace, secret) => {
	const secretJSON = {
		kind: 'Secret',
		metadata: {
			name: secretName,
			namespace
		},
		data: secret,
		type: 'Opaque'
	};

	return secretJSON;
};

module.exports.buildTLSSecret = (secretName, namespace, tlsKey, tlsCert) => {
	const secretJSON = {
		kind: 'Secret',
		metadata: {
			name: secretName,
			namespace: namespace || defaultNamespace
		},
		type: 'kubernetes.io/tls',
		data: {
			'tls.crt': tlsCert,
			'tls.key': tlsKey
		}
	};

	return secretJSON;
};
