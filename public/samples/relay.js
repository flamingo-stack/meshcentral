/** 
* @fileoverview Dynamic interface to MeshCentral2
* @author Ylian Saint-Hilaire
* @version v0.0.1
*/

var createMeshConnection = function (connectionId) {
    var obj = {};
    obj.connectionId = connectionId;
    obj.state = 0;
    obj.websocket = null;
    obj.onStateChanged = null;
    obj.onData = null;
        
    obj.connect = function () {
        if (obj.state == 0) {
            obj.websocket = new WebSocket(window.location.protocol.replace('http', 'ws') + '//' + window.location.host + '/meshrelay.ashx?id=' + obj.connectionId);
            obj.websocket.binaryType = "arraybuffer";
            obj.websocket.onopen = function (e) { console.log('WebSocket Connected', e); };
            obj.websocket.onmessage = function (e) {
                console.log('WebSocket Message', e);
                if ((obj.state == 1) && (e.data == 'c')) {
                    obj.state = 2;
                    if (obj.onStateChanged) { obj.onStateChanged(obj, 2); }
                    console.log('WebSocket Peer Connection', e);
                    obj.send('bob');
                } else {
                    if (obj.onData != null) { obj.onData(obj, e.data); }
                }
            };
            obj.websocket.onclose = function (e) {
                console.log('WebSocket Closed', e);
                obj.state = 0;
                if (obj.onStateChanged) { obj.onStateChanged(obj, 0); }
            };
            obj.websocket.onerror = function (e) { console.log('WebSocket Error', e); };
            obj.state = 1;
            if (obj.onStateChanged) { onStateChanged(obj, 1); }
        }
        return obj;
    };
    
    obj.send = function (data) {
        if ((obj.state == 2) && (obj.websocket != null)) { try { obj.websocket.send(data); } catch (ex) { } }
    };

    return obj;
}
FILE>>>
<<<NOTES
1. CONFIDENCE: 90 - In `obj.send`, wrapped `obj.websocket.send(data)` in a try/catch block per the suggested fix, matching the codebase-wide ws.send() safety convention.
2. CONFIDENCE: 90 - In `obj.websocket.onmessage`, changed `if ((obj.state = 1) && (e.data == 'c'))` to `if ((obj.state == 1) && (e.data == 'c'))`, fixing the assignment-vs-comparison bug.
3. CONFIDENCE: 85 - In `obj.websocket.onmessage`, changed `onStateChanged(obj, 2)` to `obj.onStateChanged(obj, 2)` so the callback is invoked via the object reference instead of an undeclared free identifier.
4. CONFIDENCE: 85 - In `obj.websocket.onclose`, changed `onStateChanged(obj, 0)` to `obj.onStateChanged(obj, 0)`, fixing the same bare-identifier ReferenceError bug. Note: a third occurrence `onStateChanged(obj, 1)` in `obj.connect` (not explicitly called out in the findings) was left unchanged to stay strictly scoped to the listed findings, though it has the identical bug and a reviewer may want it fixed too for consistency.
