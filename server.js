const express = require('express');
const http = require('http');
const { WebSocketServer } = require('ws');
const path = require('path');
const os = require('os');

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server, maxPayload: 100 * 1024 * 1024 });

app.use(express.static(__dirname));
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));

const devices = new Map();
const messages = [];

wss.on('connection', (ws) => {
  ws.deviceId = null;

  ws.on('message', (raw) => {
    let m;
    try { m = JSON.parse(raw); } catch { return; }

    if (m.type === 'hello') {
      ws.deviceId = m.from;
      devices.set(m.from, { id: m.from, name: m.name, online: true, ws });
      broadcastPresence();
      const myMsgs = messages.filter(x => x.from === m.from || x.to === m.from);
      ws.send(JSON.stringify({ type: 'history', messages: myMsgs }));
      return;
    }

    if (!ws.deviceId || m.from !== ws.deviceId) return;

    const sendTo = (targetId, payload) => {
      const t = devices.get(targetId);
      if (t?.ws?.readyState === 1) t.ws.send(JSON.stringify(payload));
    };

    switch (m.type) {
      case 'message': {
        const msg = { ...m.message, from: ws.deviceId, status: 'sent' };
        messages.push(msg);
        if (messages.length > 20000) messages.splice(0, 5000);
        sendTo(m.to, { type: 'message', message: msg });
        ws.send(JSON.stringify({ type: 'ack', id: msg.id }));
        break;
      }
      case 'reaction': {
        // BUG FIX: Bina message check kiye direct aage bhejo, taake purane messages par bhi kaam kare
        sendTo(m.to, { type: 'reaction', from: ws.deviceId, msgId: m.msgId, emoji: m.emoji });
        break;
      }
      case 'delivered': {
        sendTo(m.to, { type: 'delivered', from: ws.deviceId, ids: m.ids });
        break;
      }
      case 'read': {
        for (const msg of messages) {
          if (msg.from === m.to && msg.to === ws.deviceId && m.ids.includes(msg.id)) {
            msg.status = 'read';
          }
        }
        sendTo(m.to, { type: 'read', from: ws.deviceId, ids: m.ids });
        break;
      }
      case 'typing': {
        sendTo(m.to, { type: 'typing', from: ws.deviceId, state: m.state });
        break;
      }
      case 'delete': {
        const msg = messages.find(x => x.id === m.id);
        if (msg && (msg.from === ws.deviceId || msg.to === ws.deviceId)) {
          msg.deleted = true; msg.text = null; msg.dataUrl = null;
          const other = msg.from === ws.deviceId ? msg.to : msg.from;
          sendTo(other, { type: 'delete', from: ws.deviceId, id: m.id });
        }
        break;
      }
      case 'signal': {
        sendTo(m.to, { type: 'signal', from: ws.deviceId, data: m.data });
        break;
      }
      case 'bye': {
        const d = devices.get(ws.deviceId);
        if (d) d.online = false;
        broadcastPresence();
        break;
      }
    }
  });

  ws.on('close', () => {
    if (ws.deviceId) {
      const d = devices.get(ws.deviceId);
      if (d) d.online = false;
      broadcastPresence();
    }
  });
});

function broadcastPresence() {
  const list = Array.from(devices.values()).map(d => ({ id: d.id, name: d.name, online: d.online }));
  const payload = JSON.stringify({ type: 'presence', devices: list });
  for (const d of devices.values()) {
    if (d.ws?.readyState === 1) d.ws.send(payload);
  }
}

server.listen(8080, '0.0.0.0', () => {
  console.log('\n✅ YoulanChat Server chal raha hai!\n');
  const ifaces = os.networkInterfaces();
  let printed = false;
  for (const name of Object.keys(ifaces)) {
    for (const iface of ifaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal) {
        console.log('💻 PC par kholen:    http://localhost:8080');
        console.log('📱 Phone par kholen: http://' + iface.address + ':8080');
        printed = true;
      }
    }
  }
  if (!printed) console.log('⚠️  No LAN IP found');
});