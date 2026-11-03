/**
 * View-only watch sockets in the desktop multiplexor (OpenFrame fork).
 *
 * The shared gateway admits a watcher to a running remote-desktop session by setting the header
 * `x-openframe-viewer: 1` on its browser leg. These tests pin how the multiplexor serves such a peer:
 * no mesh login, view-only, unable to start or steer a session, following the agent's monitor
 * updates, and gone with the writer once the 30 s reconnect grace runs out.
 *
 * They drive meshdesktopmultiplex.js (and the plain relay's drop) with fake sockets; no datastore is
 * needed, so they run directly: node --test test/desktop-multiplex-viewers.test.js
 */

'use strict';

const test = require('node:test');
const assert = require('node:assert');
const path = require('path');

const MESH_DIR = process.env.MC_SRC || path.join(__dirname, '..');
const multiplex = require(path.join(MESH_DIR, 'meshdesktopmultiplex.js'));
const relay = require(path.join(MESH_DIR, 'meshrelay.js'));
const common = require(path.join(MESH_DIR, 'common.js'));

const NODE = 'node//device1';
const MESH = 'mesh//group1';
const TECH = { _id: 'user//tech', name: 'tech', access: 0 };
const DOMAIN = { id: '', sessionrecording: false };
const GRACE = 30000;

// --- Fakes -----------------------------------------------------------------

function makeParent() {
    const events = [];
    return {
        events: events,
        trafficStats: { desktopMultiplex: null, relayIn: {}, relayOut: {}, relayCount: {} },
        desktoprelays: {},
        relaySessionCount: 0,
        relaySessionErrorCount: 0,
        users: { [TECH._id]: TECH },
        meshes: { [MESH]: { name: 'group1' } },
        wsagents: {},
        userGroups: {},
        db: { Get: function (id, cb) { cb(null, [{ _id: id, meshid: MESH, name: 'box', icon: 1 }]); }, SetUser: function () { } },
        GetNodeRights: function () { return 0xFFFFFFFF; },
        CloneSafeUser: function (u) { return u; },
        common: common,
        parent: {
            debug: function () { },
            DispatchEvent: function (targets, source, event) { events.push(event); },
            AddEventDispatch: function () { },
            decodeCookie: function () { return { nouser: 1, nodeid: NODE }; },
            encodeCookie: function () { return 'rcookie'; },
            args: {},
            fs: require('fs'),
            path: path,
            recordpath: '/tmp/meshcentral-test-recordings',
            multiServer: null,
            GetRoutingServerIdNotSelf: function () { return null; },
            openframeRecordingSuspended: false
        }
    };
}

/** A websocket with the real one's deferred send callback and a close() that only flags itself. */
function fakeWs() {
    const ws = {
        closed: false,
        sent: [],
        handlers: {},
        _socket: { pause: function () { }, resume: function () { }, setKeepAlive: function () { }, bytesRead: 0, bytesWritten: 0, _parent: { end: function () { } } },
        send: function (data, cb) { ws.sent.push(data); if (cb) { setImmediate(cb); } },
        close: function () { ws.closed = true; },
        on: function (name, fn) { ws.handlers[name] = fn; }
    };
    return ws;
}

function fakeReq(opts) {
    const query = { nodeid: NODE, p: opts.p || '2', id: opts.id || 'req1' };
    if (opts.browser) { query.browser = '1'; }
    if (opts.agent) { query.rauth = 'rauth'; }
    const headers = {};
    if (opts.viewer) { headers['x-openframe-viewer'] = '1'; }
    return { query: query, headers: headers, clientIp: '10.0.0.1', session: {} };
}

/** Dials the multiplexor; the returned socket carries the relay object as ws.me. */
function dial(parent, opts) {
    const ws = fakeWs();
    multiplex.CreateMeshRelay(parent, ws, fakeReq(opts), DOMAIN, opts.user || null, undefined);
    return ws;
}

const host = function (parent, id) { return dial(parent, { browser: true, user: TECH, id: id }); };
const agent = function (parent, id) { return dial(parent, { agent: true, id: id }); };
const watcher = function (parent, id) { return dial(parent, { browser: true, viewer: true, id: id || 'req1.w.1' }); };

/** Lets queued viewer frames drain: each send callback may queue the next one. */
async function settle() { for (let i = 0; i < 10; i++) { await new Promise(function (r) { setImmediate(r); }); } }

/** Feeds a frame into the relay's message handler, the way the ws library would. */
function receive(ws, data) { ws.handlers.message.call(ws, data); }
function hangup(ws) { ws.handlers.close.call(ws); }

function cmd(command, payload) {
    const body = payload || Buffer.alloc(0);
    const buf = Buffer.alloc(4 + body.length);
    buf.writeUInt16BE(command, 0);
    buf.writeUInt16BE(buf.length, 2);
    body.copy(buf, 4);
    return buf;
}
function quality(type, compression, scaling, frameRate) {
    const b = Buffer.alloc(6);
    b[0] = type; b[1] = compression; b.writeUInt16BE(scaling, 2); b.writeUInt16BE(frameRate, 4);
    return cmd(5, b);
}
function screenSize(w, h) { const b = Buffer.alloc(4); b.writeUInt16BE(w, 0); b.writeUInt16BE(h, 2); return cmd(7, b); }
const displayList = function () { return cmd(11, Buffer.from([0, 2, 0, 1])); };
const displayInfo = function () { return cmd(82, Buffer.alloc(10, 7)); };

function session(parent) {
    const h = host(parent), a = agent(parent);
    const mux = parent.desktoprelays[NODE];
    assert.strictEqual(typeof mux, 'object');
    assert.ok(mux.startTime != null, 'session started');
    return { host: h, agent: a, mux: mux };
}

const sentCommands = function (ws) { return ws.sent.filter(function (d) { return Buffer.isBuffer(d); }).map(function (d) { return d.readUInt16BE(0); }); };

// --- Admission -------------------------------------------------------------

test('header on a non-desktop relay closes the socket', function () {
    for (const p of ['1', '5', '2']) {
        const parent = makeParent(), ws = fakeWs();
        relay.CreateMeshRelay(parent, ws, fakeReq({ p: p, viewer: true, browser: true }), DOMAIN, TECH, undefined);
        assert.strictEqual(ws.closed, true, 'p=' + p);
        assert.strictEqual(parent.relaySessionCount, 0);
    }
    const parent = makeParent(), ws = fakeWs();
    multiplex.CreateMeshRelay(parent, ws, fakeReq({ p: '1', viewer: true, browser: true }), DOMAIN, null, undefined);
    assert.strictEqual(ws.closed, true);
});

test('a plain relay upgrade without the header is handled as today', function () {
    const parent = makeParent(), ws = fakeWs();
    relay.CreateMeshRelay(parent, ws, fakeReq({ p: '1' }), DOMAIN, null, undefined);
    assert.strictEqual(ws.closed, true, 'no user, no cookie: dropped as today');
    assert.strictEqual(parent.relaySessionCount, 0);
});

test('header on a non-browser leg closes the socket', function () {
    const parent = makeParent();
    session(parent);
    const ws = dial(parent, { viewer: true, id: 'req1.w.1' });
    assert.strictEqual(ws.closed, true);
    assert.strictEqual(parent.desktoprelays[NODE].viewers.length, 1);
});

test('header with an empty browser query is closed too and never takes the agent slot', function () {
    const parent = makeParent();
    const h = host(parent);
    const mux = parent.desktoprelays[NODE];
    const ws = fakeWs();
    const req = fakeReq({ browser: true, viewer: true, id: 'req1.w.1' });
    req.query.browser = '';
    multiplex.CreateMeshRelay(parent, ws, req, DOMAIN, null, undefined);
    assert.strictEqual(ws.closed, true);
    assert.strictEqual(mux.agent, null, 'the agent slot stays free for the real tunnel');
    const a = agent(parent);
    assert.strictEqual(a.closed, false);
    assert.strictEqual(mux.agent, a.me);
    assert.strictEqual(h.closed, false);
});

test('watcher with no multiplexor is closed and leaves no pending marker', function () {
    const parent = makeParent();
    const ws = watcher(parent);
    assert.strictEqual(ws.closed, true);
    assert.strictEqual(parent.desktoprelays[NODE], undefined);
    assert.strictEqual(parent.relaySessionCount, 0);
});

test('watcher waits out a pending marker, then joins or is refused', function (t) {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const parent = makeParent();
    parent.desktoprelays[NODE] = 1;
    const w = watcher(parent);
    assert.strictEqual(w.closed, false);
    delete parent.desktoprelays[NODE];
    session(parent);
    t.mock.timers.tick(50);
    assert.strictEqual(w.closed, false);
    assert.ok(parent.desktoprelays[NODE].viewers.indexOf(w.me) >= 0, 'joined once created');

    const parent2 = makeParent();
    parent2.desktoprelays[NODE] = 1;
    const w2 = watcher(parent2);
    delete parent2.desktoprelays[NODE];
    t.mock.timers.tick(50);
    assert.strictEqual(w2.closed, true);
    assert.strictEqual(parent2.desktoprelays[NODE], undefined);
});

test('socket without the header is dropped as today', function () {
    const parent = makeParent();
    session(parent);
    const ws = dial(parent, { browser: true, id: 'req1.w.1' });
    assert.strictEqual(ws.closed, true);
    assert.strictEqual(parent.desktoprelays[NODE].viewers.length, 1);
});

// --- Joining ---------------------------------------------------------------

test('watcher joins a running session without login, view-only, and the join log does not throw', async function () {
    const parent = makeParent();
    const s = session(parent);
    receive(s.agent, displayList());
    receive(s.agent, displayInfo());
    const w1 = watcher(parent, 'req1.w.1');
    const w2 = watcher(parent, 'req1.w.2');
    await settle();
    for (const w of [w1, w2]) {
        assert.strictEqual(w.closed, false);
        assert.strictEqual(w.me.viewOnly, true);
        assert.strictEqual(w.me.nouser, true);
        assert.strictEqual(w.me.user, null);
        assert.strictEqual(w.sent[0], 'c');
        assert.deepStrictEqual(sentCommands(w), [11, 82], 'cached display list and positions on join');
    }
    assert.strictEqual(s.mux.viewers.length, 3);
    assert.strictEqual(s.mux, parent.desktoprelays[NODE]);
    const joins = parent.events.filter(function (e) { return e.msgid == 143; });
    assert.strictEqual(joins.length, 2);
    assert.strictEqual(joins[0].userid, undefined);
    assert.strictEqual(joins[0].username, undefined);
});

test('header on a logged-in browser leg still makes it view-only', function () {
    const parent = makeParent();
    session(parent);
    const ws = dial(parent, { browser: true, viewer: true, user: TECH, id: 'req1.w.1' });
    assert.strictEqual(ws.closed, false);
    assert.strictEqual(ws.me.viewOnly, true);
    assert.strictEqual(ws.me.nouser, true);
});

test("a watcher's handshake strings never start the stream or set its options", function () {
    const parent = makeParent();
    const s = session(parent);
    const w = watcher(parent);
    const before = s.agent.sent.length;
    receive(w, '2');
    receive(w, JSON.stringify({ type: 'options', usage: 2 }));
    assert.strictEqual(s.agent.sent.length, before, 'nothing reached the agent');
    assert.strictEqual(s.mux.protocolOptions, null);
});

// --- Input -----------------------------------------------------------------

test('a watcher cannot ask the agent for a TCP or UDP tunnel', function () {
    const parent = makeParent();
    const debug = [];
    parent.parent.debug = function (cat, msg) { debug.push(msg); };
    const s = session(parent);
    const tcp = fakeWs();
    const tcpReq = fakeReq({ browser: true, viewer: true, id: 'req1.w.1' });
    tcpReq.query.tcpport = '22'; tcpReq.query.tcpaddr = '127.0.0.1';
    multiplex.CreateMeshRelay(parent, tcp, tcpReq, DOMAIN, null, undefined);
    const udp = fakeWs();
    const udpReq = fakeReq({ browser: true, viewer: true, id: 'req1.w.2' });
    udpReq.query.udpport = '5000';
    multiplex.CreateMeshRelay(parent, udp, udpReq, DOMAIN, null, undefined);
    assert.strictEqual(tcp.closed, false);
    assert.strictEqual(udp.closed, false);
    assert.strictEqual(s.mux.viewers.length, 3);
    assert.ok(!debug.some(function (m) { return m.indexOf('tunnel command') >= 0; }), 'no tunnel command was sent to the agent');
});

test('a watcher is refused while the multiplexor has no writer, and the writer still gets it', function () {
    const parent = makeParent();
    const a = agent(parent);
    const mux = parent.desktoprelays[NODE];
    assert.strictEqual(typeof mux, 'object');
    assert.strictEqual(mux.viewers.length, 0);
    const w = watcher(parent);
    assert.strictEqual(w.closed, true);
    assert.strictEqual(a.closed, false);
    assert.strictEqual(parent.desktoprelays[NODE], mux);
    assert.strictEqual(mux.startTime, null);
    assert.deepStrictEqual(a.sent, ['c'], 'the refused watcher sent the agent nothing');
    const h = host(parent);
    assert.strictEqual(h.closed, false);
    assert.strictEqual(parent.desktoprelays[NODE], mux);
    assert.ok(mux.startTime != null, 'the writer started the session');
    const w2 = watcher(parent, 'req1.w.2');
    assert.strictEqual(w2.closed, false);
    assert.strictEqual(mux.viewers.length, 2);
});

test("an upstream view-only guest keeps today's quality and display-list requests", function () {
    const parent = makeParent();
    const s = session(parent);
    const ws = fakeWs();
    multiplex.CreateMeshRelay(parent, ws, fakeReq({ browser: true, id: 'guest1' }), DOMAIN, null, { vo: 1, nouser: 1 });
    assert.strictEqual(ws.closed, false);
    assert.strictEqual(ws.me.viewOnly, true);
    assert.notStrictEqual(ws.me.watcher, true);
    const before = sentCommands(s.agent).length;
    receive(ws, quality(1, 90, 1024, 10));
    receive(ws, displayList());
    const after = sentCommands(s.agent).slice(before);
    assert.ok(after.indexOf(5) >= 0, 'the guest quality request reached the agent as on master');
    assert.ok(after.indexOf(11) >= 0, 'the guest display-list request reached the agent as on master');
    receive(ws, cmd(1, Buffer.alloc(4)));
    assert.strictEqual(sentCommands(s.agent).length, before + after.length, 'input from a view-only guest still does not');
});

test('nothing a watcher sends reaches the agent except refresh and pause', async function () {
    const parent = makeParent();
    const s = session(parent);
    receive(s.agent, screenSize(64, 32));
    const w = watcher(parent);
    await settle();
    assert.deepStrictEqual(sentCommands(w), [7], 'the cached screen size on join');
    const before = s.agent.sent.length;
    for (const c of [1, 2, 10, 11, 12, 85, 87]) { receive(w, cmd(c, Buffer.from([0, 0]))); }
    receive(w, quality(1, 90, 1024, 50));
    receive(w, '2');
    receive(w, JSON.stringify({ ctrlChannel: '102938', type: 'lock' }));
    receive(w, JSON.stringify({ ctrlChannel: '102938', type: 'autolock', value: true }));
    assert.strictEqual(s.agent.sent.length, before, 'agent saw nothing');

    const frames = w.sent.length;
    receive(w, cmd(6));
    await settle();
    assert.strictEqual(w.sent.length, frames + 1, 'refresh replays the screen from the cache');
    assert.strictEqual(w.sent[frames].readUInt16BE(0), 7);
    assert.strictEqual(s.agent.sent.length, before);

    receive(w, cmd(8, Buffer.from([0])));
    assert.strictEqual(s.agent.sent.length, before + 1, 'unpause is aggregated to the agent');
    assert.deepStrictEqual(sentCommands(s.agent).slice(-1), [8]);
});

test('the host asks for the display list, a watcher cannot', function () {
    const parent = makeParent();
    const s = session(parent);
    const w = watcher(parent);
    receive(w, displayList());
    assert.deepStrictEqual(sentCommands(s.agent), []);
    receive(s.host, displayList());
    assert.deepStrictEqual(sentCommands(s.agent), [11]);
});

test("the host's quality command wins over watcher defaults", function () {
    const parent = makeParent();
    const s = session(parent);
    watcher(parent, 'req1.w.1');
    const w2 = watcher(parent, 'req1.w.2');
    receive(s.host, quality(1, 60, 512, 200));
    const sent = s.agent.sent.filter(Buffer.isBuffer);
    assert.strictEqual(sent.length, 1);
    assert.strictEqual(sent[0].readUInt16BE(0), 5);
    assert.strictEqual(sent[0][5], 60, 'compression');
    assert.strictEqual(sent[0].readUInt16BE(6), 512, 'scaling not lifted back to the watcher default 1024');
    assert.strictEqual(sent[0].readUInt16BE(8), 200, 'frame rate not lowered to the watcher default 100');
    receive(w2, quality(1, 90, 1024, 50));
    assert.strictEqual(s.agent.sent.filter(Buffer.isBuffer).length, 1, 'a watcher quality command changes nothing');
    assert.strictEqual(s.mux.imageScaling, 512);
});

test('a watcher quality command with only watchers left sends the agent nothing', function (t) {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const parent = makeParent();
    const s = session(parent);
    const w = watcher(parent);
    hangup(s.host);
    const before = s.agent.sent.length;
    receive(w, quality(1, 90, 1024, 50));
    assert.strictEqual(s.agent.sent.length, before);
});

// --- Output ----------------------------------------------------------------

test('agent display list and display info reach watchers', async function () {
    const parent = makeParent();
    const s = session(parent);
    const w = watcher(parent);
    receive(s.agent, displayList());
    receive(s.agent, displayInfo());
    receive(s.agent, cmd(12, Buffer.from([0, 1])));
    receive(s.agent, cmd(88, Buffer.from([1])));
    await settle();
    assert.deepStrictEqual(sentCommands(w), [11, 82], 'monitor switches follow, input-only updates do not');
    assert.deepStrictEqual(sentCommands(s.host), [11, 82, 12, 88]);
});

// --- Lifecycle -------------------------------------------------------------

test('a watcher leaving changes nothing', function (t) {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const parent = makeParent();
    const s = session(parent);
    const w1 = watcher(parent, 'req1.w.1'), w2 = watcher(parent, 'req1.w.2');
    hangup(w1);
    assert.strictEqual(s.mux.viewers.length, 2);
    assert.strictEqual(s.agent.closed, false);
    assert.strictEqual(w2.closed, false);
    assert.strictEqual(s.mux.lingerTimer, undefined);
    t.mock.timers.tick(GRACE);
    assert.strictEqual(parent.desktoprelays[NODE], s.mux);
    assert.strictEqual(s.agent.closed, false);
});

test('the writer leaving with nobody watching disposes at once', function () {
    const parent = makeParent();
    const s = session(parent);
    hangup(s.host);
    assert.strictEqual(s.agent.closed, true);
    assert.strictEqual(s.mux.viewers, undefined);
    assert.strictEqual(parent.desktoprelays[NODE], undefined);
    const again = session(parent);
    assert.notStrictEqual(again.mux, s.mux, 'the next session gets its own multiplexor');
});

test('the writer leaving with watchers starts the grace and a redial cancels it', function (t) {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const parent = makeParent();
    const s = session(parent);
    const w = watcher(parent);
    hangup(s.host);
    assert.strictEqual(s.agent.closed, false, 'stream kept for the grace');
    assert.strictEqual(w.closed, false);
    assert.ok(s.mux.lingerTimer != null);
    t.mock.timers.tick(5000);
    const h2 = host(parent, 'req1.2.redial');
    assert.strictEqual(h2.closed, false);
    assert.strictEqual(parent.desktoprelays[NODE], s.mux, 'same multiplexor, same recording');
    assert.strictEqual(s.mux.lingerTimer, undefined);
    t.mock.timers.tick(GRACE * 2);
    assert.strictEqual(s.agent.closed, false);
    assert.strictEqual(w.closed, false);
    assert.strictEqual(s.mux.viewers.length, 2);
});

test('a second writer leaving with watchers left does not end the session while one writer remains', function (t) {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const parent = makeParent();
    const s = session(parent);
    const h2 = host(parent, 'req2');
    watcher(parent);
    hangup(h2);
    assert.strictEqual(s.mux.lingerTimer, undefined);
    hangup(s.host);
    assert.ok(s.mux.lingerTimer != null);
});

test('watchers never outlive the writer past the grace', function (t) {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const parent = makeParent();
    const s = session(parent);
    const w1 = watcher(parent, 'req1.w.1'), w2 = watcher(parent, 'req1.w.2');
    hangup(s.host);
    t.mock.timers.tick(GRACE - 1);
    assert.strictEqual(s.agent.closed, false);
    t.mock.timers.tick(1);
    assert.strictEqual(s.agent.closed, true);
    assert.strictEqual(w1.closed, true);
    assert.strictEqual(w2.closed, true);
    assert.strictEqual(s.mux.viewers, undefined);
    assert.strictEqual(parent.desktoprelays[NODE], undefined);
    assert.ok(parent.events.some(function (e) { return e.msgid == 147; }), 'session closed logged');
    const again = session(parent);
    assert.notStrictEqual(again.mux, s.mux);
});

test('the grace still ends a session whose agent never came', function (t) {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const parent = makeParent();
    const h = host(parent);
    const mux = parent.desktoprelays[NODE];
    const w = watcher(parent);
    hangup(h);
    assert.strictEqual(w.closed, false);
    t.mock.timers.tick(GRACE);
    assert.strictEqual(w.closed, true);
    assert.strictEqual(mux.viewers, undefined);
    assert.strictEqual(parent.desktoprelays[NODE], undefined);
});

test('the last watcher leaving during the grace disposes at once', function (t) {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const parent = makeParent();
    const s = session(parent);
    const w = watcher(parent);
    hangup(s.host);
    hangup(w);
    assert.strictEqual(s.agent.closed, true);
    assert.strictEqual(parent.desktoprelays[NODE], undefined);
    assert.strictEqual(s.mux.lingerTimer, undefined);
    t.mock.timers.tick(GRACE);
});

test('the agent dropping closes every viewer, not every other one', function () {
    const parent = makeParent();
    const s = session(parent);
    const w1 = watcher(parent, 'req1.w.1'), w2 = watcher(parent, 'req1.w.2');
    hangup(s.agent);
    assert.strictEqual(s.host.closed, true);
    assert.strictEqual(w1.closed, true);
    assert.strictEqual(w2.closed, true);
    assert.strictEqual(parent.desktoprelays[NODE], undefined);
});
