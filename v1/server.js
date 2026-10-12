const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { WebSocketServer } = require('ws');

const PORT = 3000;
const TICK = 30;              // updates per second
const DT = 1 / TICK;
const GRAVITY = 1800, JUMP_V = 620;
const W = 800;

// ---- static file server (serves public/index.html) ----
const server = http.createServer((req, res) => {
  fs.readFile(path.join(__dirname, 'public', 'index.html'), (err, data) => {
    if (err) { res.writeHead(500); return res.end('error'); }
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(data);
  });
});

// ---- game state (server is authoritative) ----
let players = {};   // id -> {name,color,y,vy,alive,score}
let obstacles = []; // {x,w,h}
let speed = 300;
let nextSpawn = 600;
let restartAt = 0;
let nextId = 1;

function resetRound() {
  obstacles = []; speed = 300; nextSpawn = 600; restartAt = 0;
  for (const p of Object.values(players)) { p.y = 0; p.vy = 0; p.alive = true; p.score = 0; }
}

function tick() {
  const list = Object.values(players);
  if (!list.length) return;

  // round over? wait 2s then restart
  if (list.every(p => !p.alive)) {
    if (!restartAt) restartAt = Date.now() + 2000;
    if (Date.now() >= restartAt) resetRound();
  } else {
    speed += 6 * DT;
    for (const o of obstacles) o.x -= speed * DT;
    obstacles = obstacles.filter(o => o.x + o.w > -10);

    nextSpawn -= speed * DT;
    if (nextSpawn <= 0) {
      obstacles.push({ x: W + 20, w: 20 + Math.random() * 25, h: 30 + Math.random() * 25 });
      nextSpawn = 280 + Math.random() * 300 + speed * 0.3;
    }

    for (const p of list) {
      if (!p.alive) continue;
      p.vy -= GRAVITY * DT;
      p.y = Math.max(0, p.y + p.vy * DT);
      if (p.y === 0) p.vy = 0;
      p.score += speed * DT * 0.05;
      // player box: x 50..80, height 36 above ground
      for (const o of obstacles) {
        if (o.x < 80 && o.x + o.w > 50 && p.y < o.h) { p.alive = false; break; }
      }
    }
  }

  const msg = JSON.stringify({ t: 'state', players, obstacles });
  wss.clients.forEach(c => c.readyState === 1 && c.send(msg));
}

// ---- websockets ----
const wss = new WebSocketServer({ server });
wss.on('connection', ws => {
  const id = nextId++;
  const color = `hsl(${(id * 67) % 360},70%,50%)`;
  players[id] = { name: 'P' + id, color, y: 0, vy: 0, alive: true, score: 0 };
  ws.send(JSON.stringify({ t: 'hello', id }));

  ws.on('message', raw => {
    let m; try { m = JSON.parse(raw); } catch { return; }
    const p = players[id];
    if (m.t === 'jump' && p.alive && p.y === 0) p.vy = JUMP_V;
    if (m.t === 'name' && typeof m.name === 'string') p.name = m.name.slice(0, 12);
  });
  ws.on('close', () => { delete players[id]; });
});

setInterval(tick, 1000 / TICK);

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Local:   http://localhost:${PORT}`);
  for (const addrs of Object.values(os.networkInterfaces()))
    for (const a of addrs)
      if (a.family === 'IPv4' && !a.internal) console.log(`On LAN:  http://${a.address}:${PORT}`);
});