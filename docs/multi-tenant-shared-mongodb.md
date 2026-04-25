# Multi-Tenant Shared MongoDB

This document describes the changes made to support running multiple MeshCentral pods
against a single shared MongoDB database, where each pod serves a distinct tenant domain.

## Architecture

```
Pod (tenant-1)              Pod (tenant-2)              Pod (tenant-3)
  meshcentral.js              meshcentral.js              meshcentral.js
  config.domains:             config.domains:             config.domains:
    "":     {...}               "":     {...}               "":     {...}
    tenant-1: { dns: ... }      tenant-2: { dns: ... }      tenant-3: { dns: ... }
        |                           |                           |
        └───────────────────────────┴───────────────────────────┘
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

Each pod is deployed independently (separate Helm release, separate config, separate
process). All pods share **one MongoDB instance and one database**. Data isolation
relies on the `domain` field that MeshCentral already embeds in every document.

The tenant served by a given pod is **derived from `config.domains`** — there is no
separate `MESH_DOMAIN` environment variable. The single non-empty, non-share key in
`config.domains` is treated as the tenant. Same predicate as `meshcentral.js:1999`.

## Why `domain` is sufficient for isolation

MeshCentral was originally designed as a multi-domain server (virtual hosting within
one process). The `domain` field is embedded in:

- Every `_id`: `user/{domain}/{name}`, `node/{domain}/{hash}`, `mesh/{domain}/{hash}`
- Every document as a top-level `domain` field
- All user-facing list queries (`GetAllTypeNoTypeField`,
  `GetAllTypeNoTypeFieldMeshFiltered`, `GetEvents*`, etc.) accept `domain` as a
  required filter parameter

This means user-facing API endpoints are already tenant-isolated by design.

## Problems with the vanilla codebase (before changes)

Running multiple MeshCentral instances against one database out-of-the-box had three
issues:

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

### `db.js` — `deriveTenantDomain` helper + domain-scoped startup identifiers

**File:** `db.js`

A single module-level helper resolves the tenant for this pod from the loaded config.
Exported so `plugins/migrate.js` reuses it.

```js
function deriveTenantDomain(domains) {
    if (!domains) return '';
    for (const k in domains) { if (k !== '' && domains[k].share == null) return k; }
    return '';
}
module.exports.deriveTenantDomain = deriveTenantDomain;
```

The predicate matches `meshcentral.js:1999`'s rule for "real tenant" domains
(non-default, non-share). Legacy single-tenant installs (only the default `""` domain,
optionally with a `share`-only `openframe_public`) return `''` and behave exactly like
vanilla MeshCentral.

**Function:** `SetupDatabase(func)`

```js
// Before — required a separate MESH_DOMAIN env var
var primaryDomain = (process.env.OPENFRAME_MODE === 'true') ? (process.env.MESH_DOMAIN || '') : '';

// After — derived from config.domains
var primaryDomain = (process.env.OPENFRAME_MODE === 'true') ? deriveTenantDomain(parent.config.domains) : '';

var dbIdentifierKey = primaryDomain ? ('DatabaseIdentifier_' + primaryDomain) : 'DatabaseIdentifier';
var dbSchemaKey     = primaryDomain ? ('SchemaVersion_'      + primaryDomain) : 'SchemaVersion';
```

Each pod maintains its own `DatabaseIdentifier_tenant-1` / `SchemaVersion_tenant-1`
document with no cross-pod interference. Note: per-domain identifier keys are
incompatible with multi-server peering (which checks the global `db.identifier` at
`multiserver.js:205`). Peering is off in this chart, so this is informational only.

### `db.js` — ChangeStream domain filter

**Section:** MongoDB ChangeStream setup (inside `parent.args.mongodbchangestream`
block)

```js
// Before
const changeStreamServerDomains = (process.env.OPENFRAME_MODE === 'true' && process.env.MESH_DOMAIN)
    ? [process.env.MESH_DOMAIN, '']
    : Object.keys(parent.config.domains);

// After
const tenantDomain = deriveTenantDomain(parent.config.domains);
const changeStreamServerDomains = (process.env.OPENFRAME_MODE === 'true' && tenantDomain)
    ? [tenantDomain, '']
    : Object.keys(parent.config.domains);
```

Each pod only reacts to ChangeStream events belonging to its own domain (and the
default `""` domain as a safety fallback) plus inserts/updates/deletes are filtered by
checking `change.fullDocument.domain` (or `_id`'s second segment for deletes).

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

### `plugins/migrate.js` — config-derived tenant + optimized mesh lookup

**File:** `plugins/migrate.js`

1. **Tenant derivation** — the migration script reads the tenant from the loaded
   `config.json`, not from an env var:

   ```js
   // Before
   var MESH_DOMAIN = process.env.MESH_DOMAIN || '';
   ...
   var domain = MESH_DOMAIN;

   // After
   var domain = dbModule.deriveTenantDomain(config.domains);
   ```

   The admin user and device group are created under the derived tenant, so their
   `_id` values (`user/tenant-1/admin`, `mesh/tenant-1/...`) are isolated from other
   tenants. Single-tenant installs derive `''` and behave as before.

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

### Helm chart — single source of truth in `config.domains`

**Files:** `charts/meshcentral/values.yaml`,
`charts/meshcentral/templates/configmap.yaml`

Both `meshDomain` (top-level value) and `MESH_DOMAIN` (configmap env var) were removed.
The chart's `config.domains` map is the only place a tenant is declared.

```yaml
config:
  domains:
    "":
      title: MeshCentral
      title2: MeshCentral
      minify: true
      NewAccounts: false
      allowedOrigin: true
    openframe_public:
      share: /opt/mesh/public
```

Per-tenant releases set `allowedOrigin` on their own domain entry (see deployment
example below).

## Deployment

### Per-tenant Helm values

Each tenant is its own Helm release. The release adds the tenant key to
`config.domains`:

```yaml
# values-tenant-1.yaml
config:
  settings:
    mongodb: "mongodb://mongo-host:27017"
    mongodbname: "meshcentral"
  domains:
    tenant-1:
      dns: tenant-1.yourplatform.com
      title: "Tenant 1"
      NewAccounts: false
      allowedOrigin: true
```

```bash
helm upgrade --install mesh-tenant-1 ./charts/meshcentral -f values-tenant-1.yaml
helm upgrade --install mesh-tenant-2 ./charts/meshcentral -f values-tenant-2.yaml
```

The same `config.domains.tenant-1` block drives:

- `migrate.js` — creates `user/tenant-1/<MESH_USER>` and `mesh/tenant-1/<hash>`
- `db.js` — writes `DatabaseIdentifier_tenant-1` / `SchemaVersion_tenant-1`,
  filters ChangeStream to `["tenant-1", ""]`
- `webserver.js:866-875` `getDomain()` — routes `tenant-1.yourplatform.com` requests
  to this domain config

Drift between the runtime tenant and the routing layer is structurally impossible —
they read from the same `config.domains` entry.

### Default domain `""` and signup

The default `""` domain has `NewAccounts: false` to seal it. Tenant domains should
also keep `NewAccounts: false` after the first admin is bootstrapped — note that
`webserver.js:1610`/`:1670` always allows the **first** signup on any domain, which
becomes site admin (`siteadmin = 4294967295`). This is the non-`migrate.js` path; the
chart uses `migrate.js` for non-interactive admin creation.

## Behavior summary

| Condition | Behavior |
|---|---|
| `OPENFRAME_MODE` not set or `false` | Vanilla MeshCentral — derivation logic disabled |
| `OPENFRAME_MODE=true`, `config.domains` has only `""` (and optionally `share` hosts) | OpenFrame mode, derives `''` → vanilla DB keys, ChangeStream over all keys |
| `OPENFRAME_MODE=true`, `config.domains` adds `tenant-1: { dns: ... }` | Full isolation: scoped identifiers (`*_tenant-1`), ChangeStream filtered to `["tenant-1", ""]`, migrate creates data under `tenant-1` |

## MongoDB collection overview

| Collection | `domain` field | Notes |
|---|---|---|
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
