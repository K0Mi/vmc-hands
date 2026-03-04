#!/usr/bin/env node
/**
 * VMC Protocol Bridge
 * Receives bone data via WebSocket, forwards to VSeeFace via OSC.
 * 
 * Usage: node index.js [--port 8765] [--osc-host 127.0.0.1] [--osc-port 39539]
 */

const WebSocket = require('ws');
const osc = require('osc');

// Config
const config = {
  wsPort: parseInt(process.env.WS_PORT || '8765'),
  oscHost: process.env.OSC_HOST || '127.0.0.1',
  oscPort: parseInt(process.env.OSC_PORT || '39539'),
};

// Parse CLI args
for (let i = 2; i < process.argv.length; i++) {
  if (process.argv[i] === '--port') config.wsPort = parseInt(process.argv[++i]);
  else if (process.argv[i] === '--osc-host') config.oscHost = process.argv[++i];
  else if (process.argv[i] === '--osc-port') config.oscPort = parseInt(process.argv[++i]);
}

// OSC Client
const udpPort = new osc.UDPPort({
  localAddress: '0.0.0.0',
  localPort: 0,
  remoteAddress: config.oscHost,
  remotePort: config.oscPort,
  metadata: true
});

udpPort.on('ready', () => console.log(`[OSC] → ${config.oscHost}:${config.oscPort}`));
udpPort.on('error', (e) => console.error('[OSC] Error:', e.message));
udpPort.open();

function sendBone(name, quat) {
  udpPort.send({
    address: '/VMC/Ext/Bone/Pos',
    args: [
      { type: 's', value: name },
      { type: 'f', value: 0 }, { type: 'f', value: 0 }, { type: 'f', value: 0 },
      { type: 'f', value: quat.x }, { type: 'f', value: quat.y },
      { type: 'f', value: quat.z }, { type: 'f', value: quat.w },
    ]
  });
}

// WebSocket Server
const wss = new WebSocket.Server({ host: '0.0.0.0', port: config.wsPort });

console.log(`
╔═══════════════════════════════════════╗
║         VMC Hands Bridge              ║
╠═══════════════════════════════════════╣
║  WebSocket: ws://localhost:${config.wsPort}       ║
║  OSC:       ${config.oscHost}:${config.oscPort}            ║
╚═══════════════════════════════════════╝
`);

let msgCount = 0;
let lastLog = 0;

wss.on('connection', (ws) => {
  console.log('[WS] Client connected');
  
  ws.on('message', (data) => {
    try {
      const msg = JSON.parse(data);
      if (msg.bones) {
        msgCount++;
        const now = Date.now();
        if (now - lastLog > 2000) {
          console.log(`[VMC] ${msg.bones.length} bones × ${msgCount} msgs`);
          lastLog = now;
          msgCount = 0;
        }
        for (const bone of msg.bones) {
          if (bone.name && bone.quat) sendBone(bone.name, bone.quat);
        }
      }
    } catch (e) {
      console.error('[WS] Parse error:', e.message);
    }
  });
  
  ws.on('close', () => console.log('[WS] Client disconnected'));
});

process.on('SIGINT', () => { console.log('\nShutting down...'); process.exit(0); });
