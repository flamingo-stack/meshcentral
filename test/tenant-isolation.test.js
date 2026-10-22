/**
 * Tenant isolation tests for the OpenFrame fork.
 *
 * Every tenant server shares ONE MongoDB database and is separated only by the `domain` field, so
 * upstream's "one server owns the whole database" queries reach across tenants here. These tests
 * pin the behaviours that were changed for that: each one seeds two tenant domains into a single
 * database, drives db.js as tenant A, and asserts that tenant B is untouched.
 *
 * They run against a real MongoDB replica set rather than a mock: what is being tested is the shape
 * of the queries themselves, so a mock would only assert that the code calls the mock.
 *
 * Run with test/run-tests.sh (starts the datastore and executes this inside the meshcentral image).
 */

'use strict';

const test = require('node:test');
const assert = require('node:assert');
const path = require('path');

const MESH_DIR = process.env.MC_SRC || path.join(__dirname, '..');
const MONGO_URL = process.env.MC_TEST_MONGO_URL || 'mongodb://localhost:27017/meshcentral_test?replicaSet=rs0';

const A = 'aaaa1111-1111-1111-1111-111111111111';
const B = 'bbbb2222-2222-2222-2222-222222222222';

// --- Helpers ---------------------------------------------------------------

function config(domain) {
    // Mirrors the deployed shape: the default domain, the tenant's own, and the static share domain
    // that deriveTenantDomain() must skip.
    const domains = { '': { title: 'MeshCentral' }, openframe_public: { share: '/opt/mesh/public' } };
    domains[domain] = { title: domain };
    return { settings: { mongodb: MONGO_URL, mongodbname: dbName(), mongodbcol: 'meshcentral' }, domains: domains };
}

function dbName() {
    const m = /\/([^/?]+)(\?|$)/.exec(MONGO_URL);
    return m ? m[1] : 'meshcentral_test';
}

/** A minimal MeshCentral "parent", the same shim plugins/migrate.js uses to drive db.js standalone. */
function parentShim(domain) {
    const cfg = config(domain);
    return {
        datapath: '/tmp/meshcentral-test-data',
        args: { mongodb: cfg.settings.mongodb, mongodbname: cfg.settings.mongodbname, mongodbcol: cfg.settings.mongodbcol },
        config: cfg,
        crypto: require('crypto'), fs: require('fs'), path: require('path'),
        common: require(path.join(MESH_DIR, 'common.js')),
        debug: function () { }, DispatchEvent: function () { },
        GetConnectivityState: function () { return null; },
        webserver: { meshes: {}, users: {}, CreateNodeDispatchTargets: function () { return []; } },
        userGroups: {}
    };
}

/** Open db.js as a tenant server for `domain`. `env` is applied before setup, since the write guard
 *  binds itself at setup time. */
function openDb(domain, env) {
    const previous = {};
    const applied = Object.assign({ OPENFRAME_MODE: 'true', OPENFRAME_TENANT_ISOLATION: 'true' }, env || {});
    for (const k in applied) { previous[k] = process.env[k]; process.env[k] = applied[k]; }

    const parent = parentShim(domain);
    return new Promise((resolve) => {
        const db = require(path.join(MESH_DIR, 'db.js')).CreateDB(parent, function () {
            db.SetupDatabase(function () {
                for (const k in previous) { if (previous[k] === undefined) { delete process.env[k]; } else { process.env[k] = previous[k]; } }
                resolve({ db, parent });
            });
        });
    });
}

function seedDocs() {
    const old = Date.now() - (400 * 86400000); // far past any expireDevs setting
    const perDomain = (d) => ([
        { _id: 'user/' + d + '/admin', type: 'user', name: 'admin', domain: d, siteadmin: 0xFFFFFFFF, links: {} },
        { _id: 'mesh/' + d + '/GRP', type: 'mesh', name: 'OpenFrame', domain: d, mtype: 2, expireDevs: 30, links: {} },
        { _id: 'node/' + d + '/DEV', type: 'node', name: 'device', domain: d, meshid: 'mesh/' + d + '/GRP' },
        { _id: 'ifnode/' + d + '/DEV', domain: d, netif: {} },
        { _id: 'lcnode/' + d + '/DEV', type: 'lastconnect', domain: d, meshid: 'mesh/' + d + '/GRP', time: old },
        { _id: 'ugrp/' + d + '/G1', type: 'ugrp', name: 'group', domain: d, links: {} },
        // An orphan: its device group does not exist. Upstream cleanup() deleted these DB-wide.
        { _id: 'node/' + d + '/ORPHAN', type: 'node', name: 'orphan', domain: d, meshid: 'mesh/' + d + '/GONE' }
    ]);
    return perDomain(A).concat(perDomain(B));
}

async function freshDatabase() {
    const { MongoClient } = require('mongodb');
    const client = await MongoClient.connect(MONGO_URL);
    const db = client.db(dbName());
    for (const c of ['meshcentral', 'serverstats', 'events', 'power', 'smbios']) {
        await db.collection(c).deleteMany({});
    }
    await db.collection('meshcentral').insertMany(seedDocs());
    return { client, db };
}

function ids(docs) { return docs.map((d) => d._id).sort(); }

// --- Tests -----------------------------------------------------------------

test('GetAllTypeForDomain returns only this tenant and keeps the type field', async () => {
    const { client, db: raw } = await freshDatabase();
    const { db } = await openDb(A);
    try {
        const users = await new Promise((res) => db.GetAllTypeForDomain('user', A, (err, docs) => res(docs)));
        assert.deepStrictEqual(ids(users), ['user/' + A + '/admin']);

        // The type field must survive: these documents are held in the boot cache and written back
        // later, and a document saved without `type` stops being returned by every type query.
        assert.strictEqual(users[0].type, 'user');

        // Guard against the projection trap by round-tripping the object the way the server does.
        // (SetUser takes no callback in MeshCentral, so the write is awaited through Set.)
        await new Promise((res) => db.Set(users[0], res));
        const after = await raw.collection('meshcentral').findOne({ _id: 'user/' + A + '/admin' });
        assert.strictEqual(after.type, 'user');
    } finally { await client.close(); }
});

test('cleanup() does not delete documents whose device group is missing', async () => {
    // Upstream ended cleanup() with deleteMany({meshid: {$nin: meshlist}}) over the whole database.
    // On a shared database that deletes other tenants' devices, and an empty meshlist (a transient
    // read error) matches everything. The statement is gone; nothing may be deleted here.
    const { client, db: raw } = await freshDatabase();
    const { db } = await openDb(A);
    try {
        // Counted per domain rather than globally: SetupDatabase fires off its own
        // DatabaseIdentifier / SchemaVersion writes without waiting, which would race a total.
        const countA = () => raw.collection('meshcentral').countDocuments({ domain: A });
        const countB = () => raw.collection('meshcentral').countDocuments({ domain: B });
        const beforeA = await countA(), beforeB = await countB();
        await new Promise((res) => db.cleanup(res));
        assert.strictEqual(await countA(), beforeA);
        assert.strictEqual(await countB(), beforeB);
        assert.strictEqual(await raw.collection('meshcentral').countDocuments({ _id: 'node/' + B + '/ORPHAN' }), 1);
        assert.strictEqual(await raw.collection('meshcentral').countDocuments({ _id: 'node/' + A + '/ORPHAN' }), 1);
    } finally { await client.close(); }
});

test('removeInactiveDevices only removes devices of this tenant', async () => {
    const { client, db: raw } = await freshDatabase();
    const { db, parent } = await openDb(A);
    try {
        // The boot cache still holds both tenants here on purpose: that is the state the function
        // used to read foreign domains from.
        const meshes = await new Promise((res) => db.GetAllType('mesh', (err, docs) => res(docs)));
        for (const m of meshes) { parent.webserver.meshes[m._id] = m; }

        await new Promise((res) => { db.removeInactiveDevices(false, function () { }); setTimeout(res, 2000); });

        assert.strictEqual(await raw.collection('meshcentral').countDocuments({ _id: 'node/' + A + '/DEV' }), 0, "own tenant's inactive device should be removed");
        assert.strictEqual(await raw.collection('meshcentral').countDocuments({ _id: 'node/' + B + '/DEV' }), 1, "other tenant's device must be untouched");
        assert.strictEqual(await raw.collection('meshcentral').countDocuments({ _id: 'lcnode/' + B + '/DEV' }), 1);
    } finally { await client.close(); }
});

test('writes into another tenant are blocked, own-domain writes pass', async () => {
    const { client, db: raw } = await freshDatabase();
    const { db } = await openDb(A);
    try {
        const foreign = await new Promise((res) => db.Set({ _id: 'user/' + B + '/admin', type: 'user', domain: B, name: 'overwritten' }, (err) => res(err)));
        assert.ok(foreign instanceof Error, 'a cross-tenant Set must fail its callback rather than hang');
        assert.strictEqual((await raw.collection('meshcentral').findOne({ _id: 'user/' + B + '/admin' })).name, 'admin');

        const own = await new Promise((res) => db.Set({ _id: 'user/' + A + '/second', type: 'user', domain: A, name: 'second' }, (err) => res(err)));
        assert.ok(!own, 'own-domain writes must not be affected');
        assert.strictEqual(await raw.collection('meshcentral').countDocuments({ _id: 'user/' + A + '/second' }), 1);

        // Remove resolves the domain from the id, which carries it even for prefixed keys.
        await new Promise((res) => db.Remove('lcnode/' + B + '/DEV', res));
        assert.strictEqual(await raw.collection('meshcentral').countDocuments({ _id: 'lcnode/' + B + '/DEV' }), 1);
    } finally { await client.close(); }
});

test('the write guard can be turned off for rollback', async () => {
    const { client, db: raw } = await freshDatabase();
    const { db } = await openDb(A, { OPENFRAME_CROSS_TENANT_WRITES: 'allow' });
    try {
        await new Promise((res) => db.Set({ _id: 'user/' + B + '/admin', type: 'user', domain: B, name: 'overwritten' }, res));
        assert.strictEqual((await raw.collection('meshcentral').findOne({ _id: 'user/' + B + '/admin' })).name, 'overwritten');
    } finally { await client.close(); }
});

test('server stats are read per tenant, with legacy rows still visible', async () => {
    const { client, db: raw } = await freshDatabase();
    const { db } = await openDb(A);
    try {
        const now = new Date();
        await raw.collection('serverstats').insertMany([
            { time: now, domain: A, conn: { ca: 1 } },
            { time: now, domain: B, conn: { ca: 2 } },
            { time: now, conn: { ca: 3 } } // written before the domain field existed
        ]);
        const rows = await new Promise((res) => db.GetServerStats(24, (err, docs) => res(docs)));
        const seen = rows.map((r) => r.conn.ca).sort();
        assert.deepStrictEqual(seen, [1, 3], 'own rows plus legacy rows, never another tenant');
    } finally { await client.close(); }
});

test('config files are stored per tenant and fall back to the shared legacy key', async () => {
    const { client, db: raw } = await freshDatabase();
    const { db } = await openDb(A);
    try {
        await new Promise((res) => db.setConfigFile('agentserver-cert-public.crt', Buffer.from('CERT'), res));
        assert.strictEqual(await raw.collection('meshcentral').countDocuments({ _id: 'cfile/' + A + '/agentserver-cert-public.crt' }), 1);

        // A file that only exists under the legacy shared key must still resolve: that fallback is
        // what keeps certificates (and therefore the ServerID agents pin) identical through the
        // migration, instead of every pod minting a new one.
        await raw.collection('meshcentral').insertOne({ _id: 'cfile/legacy.crt', type: 'cfile', data: Buffer.from('LEGACY').toString('base64') });
        const legacy = await new Promise((res) => db.getConfigFile('legacy.crt', (err, docs) => res(docs)));
        assert.strictEqual(legacy.length, 1);
        assert.strictEqual(legacy[0]._id, 'cfile/legacy.crt');

        // Another tenant's file must not be listed.
        await raw.collection('meshcentral').insertOne({ _id: 'cfile/' + B + '/secret.crt', type: 'cfile', data: 'x' });
        const listed = await new Promise((res) => db.listConfigFiles((err, docs) => res(docs)));
        assert.deepStrictEqual(ids(listed), ['cfile/' + A + '/agentserver-cert-public.crt']);
    } finally { await client.close(); }
});

test('deriveTenantDomain picks the tenant, ignoring the default and share domains', () => {
    const { deriveTenantDomain } = require(path.join(MESH_DIR, 'db.js'));
    assert.strictEqual(deriveTenantDomain(config(A).domains), A);
    // A legacy single-tenant install has only the default domain and must stay unscoped.
    assert.strictEqual(deriveTenantDomain({ '': { title: 'MeshCentral' } }), '');
    assert.strictEqual(deriveTenantDomain(null), '');
});

test('a domain name that comes from an empty variable is rejected, not collapsed to ""', () => {
    // config.json carries the tenant's domain as "${TENANT_ID}", substituted from the pod's
    // environment. Unset, it would substitute to "" — the default domain, which on a shared
    // database every tenant server reads — and the tenant would silently join it.
    const { unresolvedDomainPlaceholders } = require(path.join(MESH_DIR, 'common.js'));
    const config = '{"settings":{"mongodb":"mongodb://h/db?x=1${MC_MONGO_URI_OPTIONS}"},'
        + '"domains":{"":{"title":"MeshCentral"},"${TENANT_ID}":{"title":"${TENANT_ID}"}}}';

    assert.deepStrictEqual(unresolvedDomainPlaceholders(config, { TENANT_ID: A }), []);
    assert.deepStrictEqual(unresolvedDomainPlaceholders(config, {}), ['TENANT_ID']);

    // A placeholder in a VALUE may legitimately be empty — the Mongo URI options are.
    assert.deepStrictEqual(unresolvedDomainPlaceholders(config, { TENANT_ID: A, MC_MONGO_URI_OPTIONS: '' }), []);

    // A single-domain install with no placeholders is untouched.
    assert.deepStrictEqual(unresolvedDomainPlaceholders('{"domains":{"":{"title":"MeshCentral"}}}', {}), []);
});

test('getConfigFileRows returns this tenant files under their bare name', async () => {
    // The startup config sync writes each returned file into the data folder. A tenant-scoped id is
    // 'cfile/<domain>/<name>', so a caller parsing the id as 'cfile/<name>' would use the domain as
    // the file name: every certificate would land in one file, none would be restored, and the
    // server would mint a new ServerID on each start.
    const { client, db: raw } = await freshDatabase();
    await raw.collection('meshcentral').insertMany([
        { _id: 'cfile/' + A + '/agentserver-cert-public.crt', type: 'cfile', domain: A, data: 'QQ==' },
        { _id: 'cfile/' + A + '/root-cert-public.crt', type: 'cfile', domain: A, data: 'QQ==' },
        { _id: 'cfile/' + B + '/agentserver-cert-public.crt', type: 'cfile', domain: B, data: 'Qg==' },
        { _id: 'cfile/agentserver-cert-public.crt', type: 'cfile', data: 'TA==' }
    ]);
    const { db } = await openDb(A);
    try {
        const files = await new Promise((res) => db.getConfigFileRows((err, f) => res(f)));
        assert.deepStrictEqual(files.map((f) => f.name).sort(), ['agentserver-cert-public.crt', 'root-cert-public.crt']);
        for (const f of files) { assert.strictEqual(f.data, 'QQ=='); } // never tenant B, never the legacy row
    } finally { await client.close(); }
});

test('getConfigFileRows falls back to the legacy shared rows, not to another tenant', async () => {
    // First start of a tenant that has never pushed its own files: it must inherit the shared
    // certificates, otherwise MeshCentral generates fresh ones and every agent stops trusting it.
    const { client, db: raw } = await freshDatabase();
    await raw.collection('meshcentral').insertMany([
        { _id: 'cfile/agentserver-cert-public.crt', type: 'cfile', data: 'TA==' },
        { _id: 'cfile/' + B + '/agentserver-cert-public.crt', type: 'cfile', domain: B, data: 'Qg==' }
    ]);
    const { db } = await openDb(A);
    try {
        const files = await new Promise((res) => db.getConfigFileRows((err, f) => res(f)));
        assert.deepStrictEqual(files.map((f) => f.name), ['agentserver-cert-public.crt']);
        assert.strictEqual(files[0].data, 'TA==');
    } finally { await client.close(); }
});

test('setConfigFile writes under this tenant and getConfigFile prefers it over the legacy row', async () => {
    const { client, db: raw } = await freshDatabase();
    await raw.collection('meshcentral').insertOne({ _id: 'cfile/webserver-cert-public.crt', type: 'cfile', data: 'TA==' });
    const { db } = await openDb(A);
    try {
        const legacy = await new Promise((res) => db.getConfigFile('webserver-cert-public.crt', (err, d) => res(d)));
        assert.strictEqual(legacy[0].data, 'TA==');

        await new Promise((res) => db.setConfigFile('webserver-cert-public.crt', Buffer.from('A'), res));
        const scoped = await raw.collection('meshcentral').findOne({ _id: 'cfile/' + A + '/webserver-cert-public.crt' });
        assert.strictEqual(scoped.domain, A);

        const now = await new Promise((res) => db.getConfigFile('webserver-cert-public.crt', (err, d) => res(d)));
        assert.strictEqual(now[0]._id, 'cfile/' + A + '/webserver-cert-public.crt');

        // The legacy row must stay intact: other tenants still boot from it.
        const untouched = await raw.collection('meshcentral').findOne({ _id: 'cfile/webserver-cert-public.crt' });
        assert.strictEqual(untouched.data, 'TA==');
    } finally { await client.close(); }
});


// --- The flag itself ---------------------------------------------------------
//
// Everything above runs with OPENFRAME_TENANT_ISOLATION=true. These pin the other state: with the
// flag off the pod must behave exactly as production does today, so that this code can sit on
// master and ship inside the image without changing anything until an environment opts in.

test('with the flag off, reads are not scoped to a domain', async () => {
    const { client } = await freshDatabase();
    const { db } = await openDb(A, { OPENFRAME_TENANT_ISOLATION: 'false' });
    try {
        const users = await new Promise((res) => db.GetAllType('user', (err, docs) => res(docs)));
        assert.deepStrictEqual(ids(users), ['user/' + A + '/admin', 'user/' + B + '/admin']);
    } finally { await client.close(); }
});

test('with the flag off, a cross-tenant write is not blocked', async () => {
    // The guard is the part with teeth: off, writing into another tenant has to still work,
    // otherwise merging would change production behaviour before anyone enables anything.
    const { client, db: raw } = await freshDatabase();
    const { db } = await openDb(A, { OPENFRAME_TENANT_ISOLATION: 'false' });
    try {
        const id = 'user/' + B + '/admin';
        const doc = await raw.collection('meshcentral').findOne({ _id: id });
        doc.realname = 'written by tenant A';
        await new Promise((res) => db.Set(doc, res));
        const after = await raw.collection('meshcentral').findOne({ _id: id });
        assert.strictEqual(after.realname, 'written by tenant A');
    } finally { await client.close(); }
});

test('with the flag off, config files keep the legacy shared key', async () => {
    const { client, db: raw } = await freshDatabase();
    const { db } = await openDb(A, { OPENFRAME_TENANT_ISOLATION: 'false' });
    try {
        await new Promise((res) => db.setConfigFile('webserver-cert-public.crt', Buffer.from('A'), res));
        assert.ok(await raw.collection('meshcentral').findOne({ _id: 'cfile/webserver-cert-public.crt' }));
        assert.strictEqual(await raw.collection('meshcentral').countDocuments({ _id: { $regex: '^cfile/' + A + '/' } }), 0);
    } finally { await client.close(); }
});

test('OPENFRAME_MODE alone does not switch isolation on', async () => {
    // The two are deliberately separate: OPENFRAME_MODE is already true on every tenant pod, so on
    // its own it would mean "live in production the moment the image lands".
    const { tenantIsolationEnabled } = require(path.join(MESH_DIR, 'db.js'));
    const previous = { m: process.env.OPENFRAME_MODE, i: process.env.OPENFRAME_TENANT_ISOLATION };
    try {
        process.env.OPENFRAME_MODE = 'true';
        delete process.env.OPENFRAME_TENANT_ISOLATION;
        assert.strictEqual(tenantIsolationEnabled(), false);
        process.env.OPENFRAME_TENANT_ISOLATION = 'true';
        assert.strictEqual(tenantIsolationEnabled(), true);
        process.env.OPENFRAME_MODE = 'false';
        assert.strictEqual(tenantIsolationEnabled(), false);
    } finally {
        if (previous.m === undefined) { delete process.env.OPENFRAME_MODE; } else { process.env.OPENFRAME_MODE = previous.m; }
        if (previous.i === undefined) { delete process.env.OPENFRAME_TENANT_ISOLATION; } else { process.env.OPENFRAME_TENANT_ISOLATION = previous.i; }
    }
});
