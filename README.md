# easy-k8s

As the name implies, this library tries to simplify the process of interfacing a nodejs app with a 
Kubernetes cluster.

All it needs are a Kubeconfig in order to perform the following operations:
- Get resource(s)
- Get container logs
- Update or create resource
- Delete resource

The library handles API discovery and resource versioning. It will always try to use the preferred API 
version for any resource based on the cluster's k8s version.

It simply builds on top of GoDaddy's excellent 
[kubernetes-client](https://github.com/godaddy/kubernetes-client "kubernetes-client") to abstract out the 
hassle of building the request chain for your resource, e.g. 
/apis/apps/v1/namespaces/mynamespace/deployments/my-deployment.

When it receives a kubeconfig, it will ping the cluster to know its version. From there, it checks to see
if it has encountered a cluster of that version before. If not, it will perform API mapping/versioning on
it. If it has, it will simply pull the map it has from its memory cache.

The API mapping component provides a map of resource names -> preferred API version (e.g. apps/v1, rbac.authorization.k8s.io/v1, v1 by itself for the core API set) and whether or not that resource is namespaced.

For example, the key in the map could be 'clusterroles', and the value at that key would be an object with
value:
```json
{
	"version": "rbac.authorization.k8s.io/v1",
	"namespaced": false
}
```

All of this is done automagically in the background by requesting all of this information from the cluster.

# usage

## Get a resource
`async function get(kubeconfig, namespace, resourceType, resourceName, options)`
- `kubeconfig`: Kubeconfig object with current-context pointing to context for correct cluster
- `namespace`: (Optional) Namespace the resource is in, can be falsy to use the default namespace or 'all'
               to target all namespaces. Leave falsy if the resource is not namespaced at all.
- `resourceType`: Type of the resource to retrieve, can be singular or plural
- `resourceName`: (Optional) Non-falsy to specify a specific resource to get
- `options`: (Optional) Pass options to get command

### Example
```javascript
const K8s = require('easy-k8s').Client;

// Load a kubeconfig, either from a file or pulled from some other data store
const kubeconfig = { ... };

const podSpec = await K8s.get(kubeconfig, 'mynamespace', 'pod', 'my-pod');
const allPodSpecs = await K8s.get(kubeconfig, 'all', 'pod');
```

## Get container logs
`async function(kubeconfig, namespace, resourceName, options)`
- `kubeconfig`: Kubeconfig object with current-context pointing to context for correct cluster
- `namespace`: (Optional) Namespace the resource is in, can be falsy to use the default namespace or 'all'
               to target all namespaces. Leave falsy if the resource is not namespaced at all.
- `resourceName`: (Optional) Non-falsy to specify a specific resource to get
- `options`: (Optional) Pass options to get command

### Example
```javascript
const K8s = require('easy-k8s').Client;

// Load a kubeconfig, either from a file or pulled from some other data store
const kubeconfig = { ... };
const podSpec = await K8s.logs(kubeconfig, 'mynamespace', 'my-pod');
```

## Update or create a resource
`async function(kubeconfig, resourceSpec)`
- `kubeconfig`: Kubeconfig object with current-context pointing to context for correct cluster
- `resourceSpec`: Kubernetes spec for a resource that is being created or updated. When the resource is
being updated, this does not have to be a complete reproduction of that resource spec with the changes
wanted. It can simply contain the fields that need to be changed or added. A merge patch is done with the
upstream resource.

### Example
```javascript
const K8s = require('easy-k8s').Client;

// Load a kubeconfig, either from a file or pulled from some other data store
const kubeconfig = { ... };

// Build a spec for a resource
const newDeploymentSpec = { ... };

// When updating, the newDeploymentSpec does not have to be a full spec, it
// can simply contain the fields that need to be added or overwritten
const podSpec = await K8s.updateOrCreate(kubeconfig, newDeploymentSpec);
```

## Delete a resource
`async function(kubeconfig, namespace, resourceType, resourceName, options)`
- `kubeconfig`: Kubeconfig object with current-context pointing to context for correct cluster
- `namespace`: (Optional) Namespace the resource is in, can be falsy to use the default namespace or 'all'
               to target all namespaces. Leave falsy if the resource is not namespaced at all.
- `resourceType`: Type of the resource to retrieve, can be singular or plural
- `resourceName`: (Optional) Non-falsy to specify a specific resource to get
- `options`: (Optional) Pass options to get command

### Example
```javascript
const K8s = require('easy-k8s').Client;

// Load a kubeconfig, either from a file or pulled from some other data store
const kubeconfig = { ... };

const podSpec = await K8s.delete(kubeconfig, 'mynamespace', 'pod', 'my-pod');
```

## Pass through HTTP request parameters in a request

All requests accept a final `options` parameter containing variables that will be passed through
into the HTTP request.

```javascript
const K8s = require('easy-k8s').Client;

// Load a kubeconfig, either from a file or pulled from some other data store
const kubeconfig = { ... };

const podSpec = await K8s.get(kubeconfig, 'mynamespace', 'pod', 'my-pod', {
    foo: 'bar'
});
```

## Retrieve an open-ended request chain to perform custom operations

The util functions listed above are meant to encompass the majority of the operations performed on a 
cluster. If you'd like to use the API discovery/versioning features of this lib with an operation not 
encompassed by the util functions, you can use the `buildChain(kubeconfig, namespace, resourceType, 
resourceName)` function. All parameters except for `kubeconfig` are optional. It will build out the chain/
API call to whichever level of detail you provide.

For example, if only the kubeconfig is provided, the resulting client will be bare, equivalent to just /.
You would then have to build the chain yourself, including the API type and version, namespace, and name
of the resource.

If just a namespace is provided, you'll get the same as the above as a namespace is only meaningful when
paired with `resourceType`.

If a namespace and a resource type are provided, the chain would be built to that level of details:
/apis/apps/v1/namespace/mynamespace/deployment
/api/v1/namespace/mynamespace/pod

If the namespace is omitted, it is also omitted from the chain (this is also valid for resources which are
not namespaced in the first place):
/apis/rbac.authorization.k8s.io/v1/roles
/apis/rbac.authorization.k8s.io/v1/clusterroles

Finally, if the resourceName is provided, it will add that to the final chain as well. Like the namespace
parameter, this parameter is only meaningful if `resourceType` is provided:
/api/v1/namespace/mynamespace/service/my-service

```javascript
const K8s = require('easy-k8s').Client;

// Load a kubeconfig, either from a file or pulled from some other data store
const kubeconfig = { ... };

// Fully-built chain ready to add a request verb at the end
const deploymentChain = K8s.buildChain(kubeconfig, 'mynamespace', 'deployment', 'my-deployment');
const deploymentSpec = await deploymentChain.get();

// Bare chain, this is just the Kubernetes client, so you can just do
const client = await K8s.getKubernetesClient(kubeconfig);
// This is functionally equivalent as the above line
const sameClient = await K8s.buildChain(kubeconfig);

const deploymentSpecFromClient = await client['apps']['v1'].namespace('mynamespace').deployment('my-deployment').get();
```

## Other util functions
- `Utils.extractCurrentContext(kubeconfig)`: Returns an object with the `{ context, cluster, user }`
  for the `current-context` in that kubeconfig.
- `Client.getVersion(kubeconfig)`: Returns the version object for the cluster.
- `Client.buildDockerSecret(secretName, namespace, repositoryURL, dockerUsername, dockerPassword)`: 
   Returns a Docker secret spec for the given Docker registry.
- `Client.buildOpaqueSecret(secretName, namespace, secret)`: Returns an opaque secret spec containing
  the given secret data.
- `Client.buildTLSSecret(secretName, namespace, tlsKey, tlsCert)`: Returns a TLS secret spec for the
  given TLS key and cert.
