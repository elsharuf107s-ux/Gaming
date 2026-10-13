const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT = process.env.PORT || 3000;
const publicDir = path.join(__dirname, 'public');

const games = [
  {
    id: 'mkart360',
    title: 'MKart360 (Mario Kart 64 Xbox 360 Port)',
    platform: 'Xbox 360 / Xenia',
    category: 'xenia-homebrew-port',
    status: 'verified-project',
    compatibility: 'Project explicitly documents Xenia Netplay support',
    sourceUrl: 'https://github.com/sirdankz/MKart360',
    requirements: 'Your own legally obtained US Mario Kart 64 ROM; Windows/Xbox 360 build toolchain; real Xenia-capable GPU host.',
    notes: 'The repository omits copyrighted ROM-derived assets. Its build script generates the Xbox 360 XEX after you provide your own ROM.',
    launchableHere: false
  },
  {
    id: 'project8recomp',
    title: "Tony Hawk's Project 8 Recompiled",
    platform: 'Native PC recompilation',
    category: 'native-recomp',
    status: 'verified-project',
    compatibility: 'Static recompilation; not launched through Xenia',
    sourceUrl: 'https://github.com/theokyr/Project8Recomp',
    requirements: 'Your own legally obtained Xbox 360 game data; compatible Windows GPU host.',
    notes: 'Open-source port/runtime code is available, but copyrighted game data is intentionally not distributed.',
    launchableHere: false
  },
  {
    id: 'vig8recomp',
    title: 'Vigilante 8 Arcade Recompiled',
    platform: 'Native PC recompilation',
    category: 'native-recomp',
    status: 'playable-project',
    compatibility: 'Project reports full 3D gameplay at high frame rates on a native PC build',
    sourceUrl: 'https://github.com/sp00nznet/vig8',
    requirements: 'Your own legally obtained Vigilante 8 Arcade game data; compatible Windows x86-64 GPU host.',
    notes: 'Uses XenonRecomp/ReXGlue-derived technology. Native port, so it does not need Xenia once prepared.',
    launchableHere: false
  },
  {
    id: 'freeridersrecomp',
    title: 'Sonic Free Riders Recompiled',
    platform: 'Native PC/Linux/Android recompilation',
    category: 'native-recomp',
    status: 'gameplay-project',
    compatibility: 'Menus and races are playable; project is still work in progress',
    sourceUrl: 'https://github.com/YuutaTsubasa/Free-Riders-Recompiled',
    requirements: 'Your own legally acquired Sonic Free Riders disc image/game data.',
    notes: 'Supports controller/keyboard and several motion-control options. This is a native recompilation, not an Xenia title.',
    launchableHere: false
  },
  {
    id: 'ac1-test',
    title: "Assassin's Creed",
    platform: 'Xbox 360',
    category: 'mock-retail',
    status: 'mock-ready',
    compatibility: 'UI test only',
    requirements: 'A future real GPU host plus your own legally obtained Xbox 360 game dump.',
    notes: 'No copyrighted game files are included. This entry only exercises the cloud-launch flow.',
    launchableHere: false
  },
  {
    id: 'stream-lab',
    title: 'Streaming Test Lab',
    platform: 'Browser',
    category: 'browser-test',
    status: 'playable',
    compatibility: 'Codespaces',
    requirements: 'Chrome-compatible browser.',
    notes: 'Interactive canvas demo for latency, keyboard and controller testing.',
    launchableHere: true
  }
];

let gpuHost = {
  id: 'mock-gpu-01',
  provider: 'GitHub Codespaces mock host',
  state: 'ready',
  gpu: 'SIMULATED — no physical GPU attached',
  encoder: 'simulated-h264',
  region: 'codespace',
  costPerHourUsd: 0
};

const sessions = new Map();

function sendJson(res, status, data) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store'
  });
  res.end(JSON.stringify(data));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => {
      body += chunk;
      if (body.length > 1_000_000) req.destroy();
    });
    req.on('end', () => {
      if (!body) return resolve({});
      try { resolve(JSON.parse(body)); } catch (err) { reject(err); }
    });
    req.on('error', reject);
  });
}

function json404(res) {
  return sendJson(res, 404, { ok: false, error: 'Not found' });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);

  if (url.pathname === '/api/health' && req.method === 'GET') {
    return sendJson(res, 200, {
      ok: true,
      service: 'xenia-cloud-starter',
      node: process.version,
      platform: process.platform,
      arch: process.arch,
      port: PORT,
      gpuExpected: false,
      mockGpuConnected: gpuHost.state === 'ready',
      activeSessions: sessions.size,
      message: 'Codespaces is the control plane and mock host. Real Xenia still requires a compatible GPU host.'
    });
  }

  if (url.pathname === '/api/gpu-host' && req.method === 'GET') {
    return sendJson(res, 200, { ok: true, host: gpuHost });
  }

  if (url.pathname === '/api/games' && req.method === 'GET') {
    return sendJson(res, 200, { ok: true, games });
  }

  if (url.pathname === '/api/sessions' && req.method === 'GET') {
    return sendJson(res, 200, { ok: true, sessions: [...sessions.values()] });
  }

  if (url.pathname === '/api/launch' && req.method === 'POST') {
    try {
      const body = await readBody(req);
      const game = games.find(g => g.id === body.gameId);
      if (!game) return sendJson(res, 400, { ok: false, error: 'Unknown gameId' });
      if (!game.launchableHere) {
        return sendJson(res, 409, {
          ok: false,
          error: 'This title cannot run on the free Codespaces host yet.',
          game,
          nextStep: game.category === 'xenia-homebrew-port'
            ? 'Prepare the project with your own required game data, then connect a real Windows GPU/Xenia host.'
            : 'Prepare the native recompilation with your own required game data, then connect a compatible host.'
        });
      }

      const session = {
        id: crypto.randomUUID(),
        gameId: game.id,
        title: game.title,
        state: 'running',
        mode: 'browser-demo',
        hostId: gpuHost.id,
        startedAt: new Date().toISOString(),
        streamUrl: `/stream.html?session=${encodeURIComponent(crypto.randomUUID())}&game=${encodeURIComponent(game.id)}`,
        notice: 'Browser-native test stream running in Codespaces.'
      };
      sessions.set(session.id, session);
      return sendJson(res, 201, { ok: true, session });
    } catch {
      return sendJson(res, 400, { ok: false, error: 'Invalid JSON body' });
    }
  }

  if (url.pathname.startsWith('/api/sessions/') && req.method === 'DELETE') {
    const id = decodeURIComponent(url.pathname.slice('/api/sessions/'.length));
    if (!sessions.has(id)) return json404(res);
    sessions.delete(id);
    return sendJson(res, 200, { ok: true, stopped: id });
  }

  if (url.pathname.startsWith('/api/')) return json404(res);

  let filePath = url.pathname === '/' ? '/index.html' : url.pathname;
  filePath = path.normalize(filePath).replace(/^\.\.(\/|\\|$)/, '');
  const fullPath = path.join(publicDir, filePath);

  if (!fullPath.startsWith(publicDir)) {
    res.writeHead(403);
    return res.end('Forbidden');
  }

  fs.readFile(fullPath, (err, data) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      return res.end('Not found');
    }
    const ext = path.extname(fullPath);
    const types = {
      '.html': 'text/html; charset=utf-8',
      '.css': 'text/css; charset=utf-8',
      '.js': 'application/javascript; charset=utf-8',
      '.json': 'application/json; charset=utf-8',
      '.svg': 'image/svg+xml'
    };
    res.writeHead(200, { 'Content-Type': types[ext] || 'application/octet-stream' });
    res.end(data);
  });
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Xenia Cloud running on http://0.0.0.0:${PORT}`);
});
