// Third-party modules
const axios = require('axios');
const https = require('https');

// Local libs
const Utils = require('./utils');
const Client = require('./client');

// Holds API maps for each version of a kubernetes cluster encountered
const apiMaps = {};

/**
 * Takes the cluster version, an API resources response from the cluster, and the
 * preferred version of the API endpoint whose resources are being mapped.
 *
 * @param {String} clusterVer Version of the Kubernetes cluster, e.g. 1.7 or 1.8
 * @param {Object} resourcesResp Response from the cluster of a /apis/[group]/[version] request
 * @param {String} preferredGroupVer Preferred version of the group, e.g. apps/v1beta1
 */
function mapGroupResources (clusterVer, resourcesResp, preferredGroupVer) {
	const groupVer = resourcesResp.groupVersion;
	const extractVerRegex = /^([^/]+\/)?(v[0-9]+([a-z]+[0-9]+)?)$/;
	const ver = extractVerRegex.exec(groupVer)[2];
	const resources = resourcesResp.resources;

	if (!apiMaps[clusterVer]) apiMaps[clusterVer] = {};

	for (const resource of resources) {
		const name = resource.name;

		// Only process the original resource, no sub-routes
		if (name.indexOf('/') !== -1) continue;

		// Get the current mapped group version
		let currGroupVer, currVer;
		if (apiMaps[clusterVer][name]) {
			currGroupVer = apiMaps[clusterVer][name].version;
			currVer = extractVerRegex.exec(currGroupVer)[2];
		}

		// If the current mapped matches the preferred version, just keep that
		if (currGroupVer && preferredGroupVer && currGroupVer === preferredGroupVer) continue;

		// If there isn't any current mapped group version or the new group version is greater
		// than the current one, set the current group version
		else if (!currGroupVer || (currGroupVer && compareAPIVersions(currVer, ver) < 0)) {
			apiMaps[clusterVer][name] = {
				version: groupVer,
				namespaced: resource.namespaced
			};
		}
	}

	return apiMaps[clusterVer];
}

/**
 * Classic compare function but takes Kubernetes API version, e.g. v1beta1 and v1alpha2.
 *
 * @param {String} ver1 Kubernetes version to compare to
 * @param {String} ver2 Kubernetes version to compare with
 * @returns < 0 if ver1 is a lower version than ver2, === 0 if ver1 is equal to ver2,
 *          and > 0 if ver 1 is a greater version than ver2
 */
function compareAPIVersions (ver1, ver2) {
	const verRegex = /([a-z]+)([0-9]+)([a-z]+)?([0-9]+)?/;
	const ver1Extraction = verRegex.exec(ver1);
	const ver2Extraction = verRegex.exec(ver2);

	const ver1Major = ver1Extraction[2];
	const ver1MinorStr = ver1Extraction[3];
	const ver1Minor = ver1Extraction[4];
	const ver2Major = ver2Extraction[2];
	const ver2MinorStr = ver2Extraction[3];
	const ver2Minor = ver2Extraction[4];

	if (ver1Major > ver2Major) return 1;
	else if (ver1Major < ver2Major) return -1;

	if (ver1MinorStr === 'beta' && ver2MinorStr === 'alpha') return 1;
	else if (ver1MinorStr === 'alpha' && ver2MinorStr === 'beta') return -1;

	if (ver1Minor > ver2Minor) return 1;
	else if (ver1Minor < ver2Minor) return -1;

	return 0;
}

/**
 * Given a cluster version (e.g. '1.7', '1.8') and a resource type (e.g. 'pod', 'deployment'),
 * returns the API group to use for that resource, or all the resources if only the version
 * is provided.
 *
 * @param {String} clusterVersion Version of the cluster to determine an API group of
 * @param {String} resourceType (Optional )Type of the resource whose API group is being determined
 * @returns {Object} Contains info about the API group, such as its version string and whether
 *                   or not it's namespaced; returns all the resource info objects in the
 *                   cluster if only the cluster version is provided.
 */
module.exports.getGroupInfo = function (clusterVersion, resourceType) {
	if (!clusterVersion || typeof(clusterVersion) !== 'string') return undefined;
	if (!resourceType || typeof(resourceType) !== 'string') return undefined;

	resourceType = resourceType.toLowerCase();

	if (apiMaps && typeof(apiMaps) === 'object') {
		if (apiMaps[clusterVersion] && typeof(apiMaps[clusterVersion]) === 'object') {
			let apiGroupInfo = apiMaps[clusterVersion][resourceType];

			// Try making the string plural
			if (!apiGroupInfo) {
				apiGroupInfo = apiMaps[clusterVersion][resourceType + 's'];
			}

			// Give up and send the whole thing
			if (!apiGroupInfo) {
				apiGroupInfo = apiMaps[clusterVersion];
			}

			return apiGroupInfo;
		}
	}

	return undefined;
};

/**
 * Maps cluster resources to cluster API endpoints.
 *
 * @param {Object} kubeconfig Kubeconfig representing the cluster
 * @returns Promise that ALWAYS resolves with two parameters: (errs, map). The reason
 *          the promise always resolves is that way we can attempt to map as may APIs
 *          as possible while still handling and returning errors caused by trying to
 *          map some other part of the API.
 */
module.exports.buildAPIMap = function (kubeconfig) {
	if (!kubeconfig || typeof(kubeconfig) !== 'object') {
		const err = new Error('Invalid \'kubeconfig\' object given');
		err.status = 400;
		return Promise.reject(err);
	}

	const groupReqs = [];
	const errs = [];

	let clusterVer, serverBaseURL, httpsAgent;
	return Client.getVersion(kubeconfig)
		.then((version) => {
			clusterVer = Utils.prettifyVersion(version.gitVersion, 2);
			const contextContainer = Client.extractCurrentContext(kubeconfig);
			const clusterDescription = contextContainer.cluster;
			serverBaseURL = Utils.removeTrailingSlash(clusterDescription.cluster.server);
			const certBuf = Buffer.from(clusterDescription.cluster['certificate-authority-data'], 'base64');
			httpsAgent = new https.Agent({
				ca: certBuf.toString('utf-8')
			});

			// Add the 'core' API group
			const coreGroupReq = axios.get(`${serverBaseURL}/api/v1`, {httpsAgent}).then((resp) => {
				return mapGroupResources(clusterVer, resp.data);
			}).catch((err) => {
				errs.push(Utils.axiosHandler(err));
			});

			groupReqs.push(coreGroupReq);

			// Add all other API groups
			return axios.get(`${serverBaseURL}/apis`, {httpsAgent});
		}).then((resp) => {
			return resp.data.groups;
		}).then((apiGroups) => {
			for (const group of apiGroups) {
				const preferredGroupVer = group.preferredVersion.groupVersion;

				for (const version of group.versions) {
					const groupReq = axios.get(`${serverBaseURL}/apis/${version.groupVersion}`, {httpsAgent}).then((resp) => {
						return mapGroupResources(clusterVer, resp.data, preferredGroupVer);
					}).catch((err) => {
						errs.push(Utils.axiosHandler(err));
					});

					groupReqs.push(groupReq);
				}
			}

			return Promise.all(groupReqs);
		}).catch((err) => {
			throw Utils.axiosHandler(err);
		}).then(() => {
			if (errs.length > 0) throw errs;
			else return apiMaps[clusterVer];
		});
};
