# Multi-Tenant Shared MongoDB

This document describes the changes made to support running multiple MeshCentral pods
against a single shared MongoDB database, where each pod serves a distinct tenant domain.

## Architecture

```
Pod (tenant-1)          Pod (tenant-2)          Pod (tenant-3)
  meshcentral.js          meshcentral.js          meshcentral.js
  MESH_DOMAIN=tenant-1    MESH_DOMAIN=tenant-2    MESH_DOMAIN=tenant-3
        |                       |                       |
        └───────────────────────┴───────────────────────┘
                                │
                         MongoDB (single)
                         database: meshcentral
                         ┌─────────────────┐
                         │  meshcentral    │  ← main collection (nodes, users, meshes)
                         │  events         │
                         │  power          │
                         │  smbios         │
                         │  serverstats    │
                         └─────────────────┘
```

Each pod is deployed independently (separate Helm release, separate config, separate process).
All pods share **one MongoDB instance and one database**. Data isolation relies on the
`domain` field that MeshCentral already embeds in every document.

## Why `domain` is sufficient for isolation

MeshCentral was originally designed as a multi-domain server (virtual hosting within one
process). The `domain` field is embedded in:

- Every `_id`: `user/{domain}/{name}`, `node/{domain}/{hash}`, `mesh/{domain}/{hash}`
- Every document as a top-level `domain` field
- All user-facing list queries (`GetAllTypeNoTypeField`, `GetAllTypeNoTypeFieldMeshFiltered`,
  `GetEvents*`, etc.) already accept `domain` as a required filter parameter

This means user-facing API endpoints are already tenant-isolated by design.

## Problems with the vanilla codebase (before changes)

Running multiple MeshCentral instances against one database out-of-the-box had three issues:

### 1. `DatabaseIdentifier` and `SchemaVersion` conflicts

At startup each server reads/writes two global documents in the main collection:

```
{ _id: 'DatabaseIdentifier', value: '<uuid>' }
{ _id: 'SchemaVersion',      value: 2        }
```

With multiple pods these documents are shared. Pod A overwrites the identifier written
by Pod B; on the next startup Pod B reads a foreign identifier and may log spurious
peering warnings.

### 2. MongoDB ChangeStream processes foreign domain events

When `--mongodbchangestream` is enabled, each pod watches the main collection for
changes and reacts to `node`, `mesh`, `user`, and `ugrp` mutations. Without domain
filtering every pod reacts to every other tenant's changes, causing redundant in-memory
updates and incorrect event dispatches.

### 3. `power` collection missing `domain` field

Power events (device on/off/sleep) were stored without a `domain` field:

```js
{ time, nodeid, power, oldPower }
```

MeshCentral's `removeDomain(domainName)` helper calls
`powerfile.deleteMany({ domain: domainName })`. Without the field, deleting a tenant
never cleaned up its power events.

## Changes made

### `db.js` — domain-scoped startup identifiers

**File:** `db.js`  
**Function:** `SetupDatabase(func)`

The `primaryDomain` is now derived from the `MESH_DOMAIN` environment variable when
`OPENFRAME_MODE=true`. If the variable is not set the code falls back to the original
global keys, maintaining full backward compatibility.

```js
// Before
obj.Get('DatabaseIdentifier', function (err, docs) { ... });
obj.Set({ _id: 'DatabaseIdentifier', value: obj.identifier });

obj.Get('SchemaVersion', function (err, docs) { ... });
obj.Set({ _id: 'SchemaVersion', value: 2 });

// After
var primaryDomain = (process.env.OPENFRAME_MODE === 'true') ? (process.env.MESH_DOMAIN || '') : '';
var dbIdentifierKey = primaryDomain ? ('DatabaseIdentifier_' + primaryDomain) : 'DatabaseIdentifier';
var dbSchemaKey     = primaryDomain ? ('SchemaVersion_'      + primaryDomain) : 'SchemaVersion';

obj.Get(dbIdentifierKey, function (err, docs) { ... });
obj.Set({ _id: dbIdentifierKey, value: obj.identifier });

obj.Get(dbSchemaKey, function (err, docs) { ... });
obj.Set({ _id: dbSchemaKey, value: 2 });
```

Result: each pod maintains its own `DatabaseIdentifier_tenant-1` / `SchemaVersion_tenant-1`
document with no cross-pod interference.

### `db.js` — ChangeStream domain filter

**File:** `db.js`  
**Section:** MongoDB ChangeStream setup (inside `parent.args.mongodbchangestream` block)

```js
// Before
obj.fileChangeStream = obj.file.watch([...], { fullDocument: 'updateLookup' });
obj.fileChangeStream.on('change', function (change) {
    if (change.operationType == 'update' || ...) {
        switch (change.fullDocument.type) { ... }  // processes ALL tenants
    }
});

// After
const changeStreamServerDomains = (process.env.OPENFRAME_MODE === 'true' && process.env.MESH_DOMAIN)
    ? [process.env.MESH_DOMAIN, '']
    : Object.keys(parent.config.domains);

obj.fileChangeStream.on('change', function (change) {
    if (change.operationType == 'update' || change.operationType == 'replace') {
        if (change.fullDocument && changeStreamServerDomains.indexOf(change.fullDocument.domain) === -1) return;
        ...
    } else if (change.operationType == 'insert') {
        if (change.fullDocument && changeStreamServerDomains.indexOf(change.fullDocument.domain) === -1) return;
        ...
    } else if (change.operationType == 'delete') {
        var splitId = change.documentKey._id.split('/');
        if (changeStreamServerDomains.indexOf(splitId[1]) === -1) return;  // domain is 2nd segment of _id
        ...
    }
});
```

Result: each pod only reacts to ChangeStream events belonging to its own domain (and the
default `""` domain as a safety fallback).

### `meshcentral.js` — `domain` field in power events

**File:** `meshcentral.js`  
**Three call sites** where `storePowerEvent` is called with a real node id:

```js
// Before (single-server path)
const record = { time: new Date(connectTime), nodeid: nodeid, power: powerState };

// After
const record = { time: new Date(connectTime), nodeid: nodeid, power: powerState, domain: nodeid.split('/')[1] };
```

```js
// Before (multi-server path)
var record = { time: new Date(connectTime), nodeid: nodeid, power: powerState, server: obj.multiServer.serverid };

// After
var record = { time: new Date(connectTime), nodeid: nodeid, power: powerState, domain: nodeid.split('/')[1], server: obj.multiServer.serverid };
```

```js
// Before (disconnect path)
obj.db.storePowerEvent({ time: new Date(), nodeid: nodeid, power: powerState, oldPower: oldPowerState }, ...);

// After
obj.db.storePowerEvent({ time: new Date(), nodeid: nodeid, power: powerState, domain: nodeid.split('/')[1], oldPower: oldPowerState }, ...);
```

The domain is derived from `nodeid` which always has the format `node/{domain}/{hash}`.
Server-level power events (`nodeid: '*'`) are left without a domain — they are
infrastructure-level markers and not tenant-specific.

### `plugins/migrate.js` — domain-aware init + optimized mesh lookup

**File:** `plugins/migrate.js`

1. **`MESH_DOMAIN` env var** — the migration script now reads the tenant domain from the
   environment instead of hard-coding `""`:

   ```js
   // Before
   var domain = '';  // default domain

   // After
   var MESH_DOMAIN = process.env.MESH_DOMAIN || '';
   ...
   var domain = MESH_DOMAIN;
   ```

   This ensures that the admin user and device group are created under the correct tenant
   domain, so their `_id` values (`user/tenant-1/admin`, `mesh/tenant-1/...`) are
   isolated from other tenants.

2. **Domain-filtered mesh lookup** — replaced the global `GetAllType` call with the
   already-domain-scoped `GetAllTypeNoTypeField`:

   ```js
   // Before — fetches meshes from ALL tenants, filters in JS
   db.GetAllType('mesh', function (dbErr, docs) {
       for (...) { if (m.domain === domain && ...) { ... } }
   });

   // After — MongoDB query already scoped to this tenant's domain
   db.GetAllTypeNoTypeField('mesh', domain, function (dbErr, docs) {
       for (...) { if (m.name === MESH_DEVICE_GROUP && !m.deleted) { ... } }
   });
   ```

### Helm chart — `MESH_DOMAIN` propagation

**Files:** `charts/meshcentral/values.yaml`, `charts/meshcentral/templates/configmap.yaml`

A new top-level value `meshDomain` was added to `values.yaml`:

```yaml
# -- Tenant domain name for this MeshCentral instance.
# Each pod should have a unique value when sharing a single MongoDB database.
# Corresponds to the key in config.domains. Leave empty for default domain.
meshDomain: ""
```

The value is exposed as the `MESH_DOMAIN` environment variable in the ConfigMap template:

```yaml
data:
  MESH_DOMAIN: {{ .Values.meshDomain | default "" | quote }}
```

## Deployment

### Per-tenant Helm values

Each tenant is deployed as a separate Helm release with a unique `meshDomain`:

```yaml
# values-tenant-1.yaml
meshDomain: "tenant-1"
config:
  settings:
    mongodb: "mongodb://mongo-host:27017"
    mongodbname: "meshcentral"
```

```bash
helm upgrade --install mesh-tenant-1 ./charts/meshcentral -f values-tenant-1.yaml
helm upgrade --install mesh-tenant-2 ./charts/meshcentral -f values-tenant-2.yaml
```

### MeshCentral `config.json` per pod

The `config.json` must declare the named domain so MeshCentral serves it correctly.
The default domain `""` should have `newAccounts: false` to prevent accidental
registrations on the shared default namespace:

```json
{
  "settings": {
    "mongodb": "mongodb://mongo-host:27017",
    "mongodbname": "meshcentral"
  },
  "domains": {
    "": { "newAccounts": false },
    "tenant-1": {
      "dns": "tenant-1.yourplatform.com",
      "newAccounts": false
    }
  }
}
```

## Behavior summary

| Condition | Behavior |
|-----------|----------|
| `OPENFRAME_MODE` not set or `false` | Vanilla MeshCentral — no changes active |
| `OPENFRAME_MODE=true`, `MESH_DOMAIN` empty | OpenFrame mode, default domain `""`, backward-compatible |
| `OPENFRAME_MODE=true`, `MESH_DOMAIN=tenant-1` | Full isolation: scoped identifiers, ChangeStream filtered, migrate creates data under `tenant-1` |

## MongoDB collection overview

| Collection | `domain` field | Notes |
|------------|---------------|-------|
| `meshcentral` (main) | Yes — on all entities | `_id` also encodes domain |
| `events` | Yes — on most events | All list queries filter by domain |
| `power` | **Added by this patch** | Required for correct `removeDomain` cleanup |
| `smbios` | Yes | One document per node (upsert) |
| `serverstats` | No | Server-wide infrastructure metric; not tenant-specific |

## Scalability

MongoDB handles thousands of collections per database without issue, but the number of
**databases** per instance has a practical limit of a few hundred before performance
degrades (WiredTiger overhead per database).

This solution uses **one database with shared collections**, which scales to tens of
thousands of tenants. The limiting factor becomes index size and working-set memory,
not the number of databases.
