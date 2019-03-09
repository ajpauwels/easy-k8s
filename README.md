# easy-k8s

As the name implies, this library tries to simplify the process of interfacing a nodejs app with a Kubernetes cluster.

All it needs are a Kubeconfig in order to perform the following operations:
- Get resource(s)
- Get container logs
- Update or create resource
- Delete resource

Any operations not included in this list can be accomplished by simply grabbing an open-ended
request chain from the library for the resource that you want and completing it.

It simply builds on top of GoDaddy's excellent [kubernetes-client](https://github.com/godaddy/kubernetes-client "kubernetes-client") to abstract out the hassle of building request chains and worrying about supporting different cluster versions.

Namely, the library will automatically map resource names (e.g. 'deployment') to a preferred resource version (e.g. 'apps/v1') for every cluster version (e.g. '1.13') that it encounters. This mapping is cached for later use.

# usage

## Get a resource
```javascript
const K8s = require('easy-k8s');

// Load a kubeconfig, either from a file or pulled from some other data store
const kubeconfig = { ... };

const podSpec = await K8s.get(kubeconfig, 'mynamespace', 'pod', 'my-pod');
const allPodSpecs = await K8s.get(kubeconfig, 'all', 'pod');
```

## Get container logs
```javascript
const K8s = require('easy-k8s');

// Load a kubeconfig, either from a file or pulled from some other data store
const kubeconfig = { ... };
const podSpec = await K8s.logs(kubeconfig, 'mynamespace', 'my-pod');
```

## Update or create a resource
```javascript
const K8s = require('easy-k8s');

// Load a kubeconfig, either from a file or pulled from some other data store
const kubeconfig = { ... };

// Build a spec for a resource
const newDeploymentSpec = { ... };

// When updating, the newDeploymentSpec does not have to be a full spec, it
// can simply contain the fields that need to be added or overwritten
const podSpec = await K8s.updateOrCreate(kubeconfig, newDeploymentSpec);
```

## Delete a resource
```javascript
const K8s = require('easy-k8s');

// Load a kubeconfig, either from a file or pulled from some other data store
const kubeconfig = { ... };

const podSpec = await K8s.delete(kubeconfig, 'mynamespace', 'pod', 'my-pod');
```

## Pass through HTTP request parameters in a request

All requests accept a final `options` parameter containing variables that will be passed through
into the HTTP request.

```javascript
const K8s = require('easy-k8s');

// Load a kubeconfig, either from a file or pulled from some other data store
const kubeconfig = { ... };

const podSpec = await K8s.get(kubeconfig, 'mynamespace', 'pod', 'my-pod', {
    foo: 'bar'
});
```

## Retrieve an open-ended request chain to perform custom operations

You can retrieve a request chain that is either completely untouched and simply connected to your
cluster, all the way to one that has the resource type, version, namespace, and name pre-loaded
into it.

```javascript
const K8s = require('easy-k8s');

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
- `K8s.extractCurrentContext(kubeconfig)`: Returns an object with the `{ context, cluster, user }`
  for the `current-context` in that kubeconfig.
- `K8s.getVersion(kubeconfig)`: Returns the version object for the cluster.
- `K8s.buildDockerSecret(secretName, namespace, repositoryURL, dockerUsername, dockerPassword)`: 
   Returns a Docker secret spec for the given Docker registry.
- `K8s.buildOpaqueSecret(secretName, namespace, secret)`: Returns an opaque secret spec containing
  the given secret data.
- `K8s.buildTLSSecret(secretName, namespace, tlsKey, tlsCert)`: Returns a TLS secret spec for the
  given TLS key and cert.
