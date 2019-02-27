/**
 * Converts an axios error into a standard error
 * with status code and a message. Also attaches any
 * data passed as a response as error metadata field.
 *
 * @param {Object} axiosErr Error given by an axios call
 * @returns {Object} Standard Error object with additional
 *                   'statusCode' and 'metadata' fields
 */
module.exports.axiosHandler = (axiosErr) => {
	const res = axiosErr.response;

	if (res) {
		const statusCode = res.status;
		const message = res.statusText;

		const err = new Error(message);
		err.statusCode = statusCode;
		err.metadata = res.data;
		return err;
	} else {
		const err = new Error(axiosErr.message);
		err.stack = axiosErr.stack;
		err.statusCode = 500;

		return err;
	}
};

/**
 * If there's a trailing slash at the end of the URL, it is removed.
 * Otherwise, the string is returned untouched.
 *
 * @param {String} url URL to remove the trailing slash from
 * @returns {String} URL with the removed slash
 */
module.exports.removeTrailingSlash = function (url) {
	if (url[url.length - 1] === '/') url.substr(0, url.length - 1);

	return url;
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
