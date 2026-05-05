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

Running multiple MeshCentral instances against one database out-of-the-box had nine
issues — three structural (1-3), three cryptographic (4-6) where global secrets in
the main collection let one tenant forge tokens valid in another, and three runtime-
exposure (7-9) where unscoped GetAllType pulls and the plugin subsystem leaked
cross-tenant data into in-memory caches and admin UIs.

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

### 4. `LoginCookieEncryptionKey` shared across tenants

`meshcentral.js:2175` and the on-demand login-token endpoints
(`getLoginToken`, `showLoginTokenKey`) read/write the doc
`{ _id: 'LoginCookieEncryptionKey', key: <hex> }`. With multiple pods on one DB the
first pod to start generates the key; every other pod reads and uses it. Login
cookies (`encodeCookie({ u: userid, ... }, key)`) are then signable by any tenant
admin against any tenant's userid — cross-tenant cookie forgery.

### 5. `InvitationLinkEncryptionKey` shared across tenants

Same shape as #4: `meshcentral.js:2185` writes a single global
`{ _id: 'InvitationLinkEncryptionKey' }`. Invitation tokens (delivered via URL — not
gated by browser SameSite/Domain rules like cookies are) become forgeable across
tenants.

### 6. `dbconfig.amtWsEventSecret` shared across tenants

`meshcentral.js:1753` reads/writes `{ _id: 'dbconfig' }`, which holds
`amtWsEventSecret` — a 256-bit HMAC key used to derive AMT WSMAN event credentials
(`webserver.js:5816`). Sharing it lets one tenant generate valid AMT event
credentials for any node in any other tenant.

### 7. Runtime user/mesh/ugrp caches loaded across all tenants

At startup `webserver.js:291` calls `obj.db.GetAllType('user', ...)` (and the same
for `mesh`, `ugrp`) and stores every returned document in `obj.users`, `obj.meshes`,
`obj.userGroups`. The ChangeStream filter from #2 keeps those caches from receiving
foreign-domain *updates*, but the initial load is unfiltered: each pod pre-populates
its in-memory state with every other tenant's identities. Memory grows O(N tenants)
per pod, and any code path that later does `obj.users[someId]` without re-checking
`u.domain` becomes a cross-tenant leak.

### 8. SetupDatabase cleanup writes back fixes for foreign-domain docs

The cleanup pass at `db.js:390-441` calls `GetAllType` for `ugrp`, `user`, `mesh`
during `SetupDatabase` to: build a global `validIdentifiers` set, fix mistyped
timestamps (`obj.Set(user)`), and prune stale links (`obj.Set(mesh)`). With shared
collections every pod processes every other tenant's docs at startup. Multiple pods
race on writes to the same documents, and one tenant's view of "valid identifiers"
ends up shaping cleanup decisions on another tenant's data.

### 9. Plugin subsystem dumps cross-tenant data and uses unscoped collections

`meshuser.js:4783-4813` (`getpluginpermissionlist`) sends every `user`, `ugrp`,
`mesh`, `node` from the database to the requesting site admin — used by the plugin
permission UI. The `plugins` and `pluginpermissions` collections themselves carry no
`domain` field. Any tenant admin opening the plugin UI sees other tenants' identities;
any tenant installing or configuring a plugin affects the whole shared cluster.

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

### `db.js` — `tenantScopedDocId` helper for shared global-state docs

**File:** `db.js`

Generalises the suffix-with-domain pattern from #1 so it can be reused by other call
sites in `meshcentral.js`. Returns `baseId` unchanged outside `OPENFRAME_MODE` or with
no derived tenant, preserving vanilla single-tenant behavior.

```js
function tenantScopedDocId(baseId, domains) {
    if (process.env.OPENFRAME_MODE !== 'true') return baseId;
    var d = deriveTenantDomain(domains);
    return d ? (baseId + '_' + d) : baseId;
}
module.exports.tenantScopedDocId = tenantScopedDocId;
```

### `meshcentral.js` — domain-scoped `LoginCookieEncryptionKey`

**File:** `meshcentral.js` — three call sites: startup load (~line 2175), on-demand
generation in `getLoginToken` (~line 3855), and `showLoginTokenKey` (~line 3873).

```js
// Before
obj.db.Get('LoginCookieEncryptionKey', function (err, docs) { ... });
obj.db.Set({ _id: 'LoginCookieEncryptionKey', key: ..., time: Date.now() });

// After
const loginCookieKeyId = require('./db.js').tenantScopedDocId('LoginCookieEncryptionKey', obj.config && obj.config.domains);
obj.db.Get(loginCookieKeyId, function (err, docs) { ... });
obj.db.Set({ _id: loginCookieKeyId, key: ..., time: Date.now() });
```

Each pod ends up with its own `LoginCookieEncryptionKey_<domain>` doc. A login cookie
encoded by tenant-A's pod cannot be verified or forged using tenant-B's key.

### `meshcentral.js` — domain-scoped `InvitationLinkEncryptionKey`

Identical pattern at `meshcentral.js:~2185`. Each pod issues invitation tokens with
its own key; tokens from one tenant are unintelligible to another.

### `meshcentral.js` — domain-scoped `dbconfig`

**File:** `meshcentral.js:~1753`

```js
// Before
obj.db.Get('dbconfig', function (err, dbconfig) {
    if (...) { obj.dbconfig = dbconfig[0]; } else { obj.dbconfig = { _id: 'dbconfig', version: 1 }; }
    if (obj.dbconfig.amtWsEventSecret == null) { ... obj.db.Set(obj.dbconfig); }
});

// After
const dbconfigId = require('./db.js').tenantScopedDocId('dbconfig', obj.config && obj.config.domains);
obj.db.Get(dbconfigId, function (err, dbconfig) {
    if (...) { obj.dbconfig = dbconfig[0]; } else { obj.dbconfig = { _id: dbconfigId, version: 1 }; }
    ...
});
```

`amtWsEventSecret` is now per-tenant; AMT WSMAN event credentials derived from it
cannot be forged across tenants.

### `db.js` — `filterDocsToTenantDomain` + scoped SetupDatabase cleanup

**File:** `db.js`

Sibling helper to `tenantScopedDocId` for the dual problem: dropping foreign-domain
documents from a result array. Off OPENFRAME_MODE or with no derived tenant, returns
the input unchanged.

```js
function filterDocsToTenantDomain(docs, domains) {
    if (process.env.OPENFRAME_MODE !== 'true' || !Array.isArray(docs)) return docs;
    var d = deriveTenantDomain(domains);
    if (!d) return docs;
    return docs.filter(function (x) { return x && (x.domain === d || x.domain === '' || x.domain == null); });
}
module.exports.filterDocsToTenantDomain = filterDocsToTenantDomain;
```

Applied to the three `GetAllType` calls in `SetupDatabase` (`db.js:390, 400, 441` —
`ugrp`, `user`, `mesh`). The cleanup writes (`obj.Set(user)`, `obj.Set(mesh)`) now
only touch this pod's tenant. The default `''` domain is included in the allow list
to keep vanilla rows visible — same predicate as the ChangeStream filter (#2).

### `webserver.js` — tenant-scoped startup caches

**File:** `webserver.js:291, 307, 312`

```js
// Before (vanilla)
obj.db.GetAllType('user', function (err, docs) {
    obj.common.unEscapeAllLinksFieldName(docs);
    for (i in docs) { obj.users[docs[i]._id] = docs[i]; ... }
    ...
});

// After
obj.db.GetAllType('user', function (err, docs) {
    docs = require('./db.js').filterDocsToTenantDomain(docs, parent.config.domains);
    obj.common.unEscapeAllLinksFieldName(docs);
    for (i in docs) { obj.users[docs[i]._id] = docs[i]; ... }
    ...
});
```

`obj.users`, `obj.meshes`, `obj.userGroups` now contain only this pod's tenant
documents (plus default-domain rows). Verified on a two-pod spike: with `alice` in
tenant-a, `bob` in tenant-b, and a directly-injected foreign `user/tenant-c/...`,
each pod's load function returned only its own tenant's users.

### `db.js` — `pluginsActive` forced off in OPENFRAME_MODE

**File:** `db.js:106`

```js
// Before
obj.pluginsActive = (parent.config && parent.config.settings && parent.config.settings.plugins != null && ...);

// After
obj.pluginsActive = (process.env.OPENFRAME_MODE !== 'true') &&
                    (parent.config && parent.config.settings && parent.config.settings.plugins != null && ...);
```

Plugins are not used in the OpenFrame integration. Disabling `pluginsActive` skips
creation of the unscoped `plugins`/`pluginpermissions` collections and disables the
`getpluginpermissionlist` code path that dumps cross-tenant identities.

### `meshuser.js` — `serverUserCommandAmtStats` filtered by caller's domain

**File:** `meshuser.js:7726`

```js
// After
parent.parent.db.GetAllType('node', function (err, docs) {
    if ((process.env.OPENFRAME_MODE === 'true') && Array.isArray(docs)) {
        docs = docs.filter(function (n) { return n && n.domain === domain.id; });
    }
    ...
});
```

The `amtstats` server-console command (siteadmin-only) used to aggregate Intel AMT
device counts across every domain in the shared collection. The filter narrows the
aggregate to the caller's session domain.

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
| `OPENFRAME_MODE=true`, `config.domains` adds `tenant-1: { dns: ... }` | Full isolation: scoped identifiers and crypto material (`DatabaseIdentifier_tenant-1`, `SchemaVersion_tenant-1`, `LoginCookieEncryptionKey_tenant-1`, `InvitationLinkEncryptionKey_tenant-1`, `dbconfig_tenant-1`), ChangeStream filtered to `["tenant-1", ""]`, migrate creates data under `tenant-1` |

## MongoDB collection overview

| Collection | `domain` field | Notes |
|---|---|---|
| `meshcentral` (main) | Yes — on all entities | `_id` also encodes domain |
| `events` | Yes — on most events | All list queries filter by domain |
| `power` | **Added by this patch** | Required for correct `removeDomain` cleanup |
| `smbios` | Yes | One document per node (upsert) |
| `serverstats` | No | Server-wide infrastructure metric; not tenant-specific. Stats from all pods commingle in this collection — fine for capacity-planning aggregates, not suitable for per-tenant SLA reporting (use Prometheus per-pod for that). |

### Global state docs in the main collection (per-tenant copies in OPENFRAME_MODE)

These six `_id`s in the `meshcentral` collection have no `domain` field. In OPENFRAME_MODE
each is suffixed with the tenant domain (`<id>_<domain>`) so every pod sharing one
database has its own copy and cannot read or overwrite another tenant's:

| Doc | Holds | Why isolation matters |
|---|---|---|
| `DatabaseIdentifier` | UUID for this DB | Stable peering identity |
| `SchemaVersion` | Schema version int | Per-pod migration state |
| `LoginCookieEncryptionKey` | 80-byte cookie HMAC key | Forge any tenant's login cookie |
| `InvitationLinkEncryptionKey` | 80-byte invitation HMAC key | Forge any tenant's invitation token (URLs, no SameSite protection) |
| `dbconfig.amtWsEventSecret` | 32-byte HMAC key | Forge any tenant's AMT WSMAN event credentials |

## Scalability

MongoDB handles thousands of collections per database without issue, but the number of
**databases** per instance has a practical limit of a few hundred before performance
degrades (WiredTiger overhead per database).

This solution uses **one database with shared collections**, which scales to tens of
thousands of tenants. The limiting factor becomes index size and working-set memory,
not the number of databases.
