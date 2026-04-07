// Arb Calculator LAN Server
// Run with: node server.js
// Both devices must be on the same network.
// Find your local IP with: ipconfig (Windows) or ifconfig (Mac/Linux)

const http = require("http");
const fs = require("fs");
const path = require("path");
const os = require("os");
const { WebSocketServer } = require("ws");

const CSV_PATH = path.join(__dirname, "bets.csv");
const CSV_HEADERS = ["timestamp", "site", "status", "wager", "odds", "toWin", "totalPayout"];

function escapeCsv(v) {
  if (v == null) return "";
  const s = String(v);
  return s.includes(",") || s.includes('"') || s.includes("\n") ? `"${s.replace(/"/g, '""')}"` : s;
}

// Parse a dollar string like "$104.00 CAD" or "$95.00" → number
function parseMoney(s) {
  if (s == null) return null;
  const m = String(s).replace(/[^0-9.]/g, "");
  const n = parseFloat(m);
  return isNaN(n) ? null : n;
}

// Decimal odds → American odds string e.g. 1.9523 → "-210"
function decimalToAmerican(dec) {
  if (dec == null || dec <= 1) return null;
  const n = dec >= 2
    ? Math.round((dec - 1) * 100)
    : Math.round(-100 / (dec - 1));
  return n > 0 ? "+" + n : String(n);
}

function normalizeBetRow(row) {
  let wager, odds, toWin, totalPayout, betId, selection;

  if (row.site === "draftkings") {
    wager = parseMoney(row.totalWagered);
    totalPayout = parseMoney(row.totalPotentialPayout);
    toWin = (wager != null && totalPayout != null) ? +(totalPayout - wager).toFixed(2) : null;
    // decimal odds = totalPayout / wager → convert to american
    const dec = (wager && totalPayout) ? totalPayout / wager : null;
    odds = decimalToAmerican(dec);
    betId = null;
    selection = null;
  } else {
    // fanduel / betrivers
    wager = parseMoney(row.wager);
    toWin = parseMoney(row.toWin);
    totalPayout = parseMoney(row.totalPayout);
    odds = row.odds || null;
    betId = row.betId || null;
    selection = row.selection || null;
  }

  return {
    timestamp: row.timestamp || null,
    site: row.site || null,
    status: row.status || null,
    wager: wager != null ? wager.toFixed(2) : null,
    odds,
    toWin: toWin != null ? toWin.toFixed(2) : null,
    totalPayout: totalPayout != null ? totalPayout.toFixed(2) : null,
    betId,
    selection
  };
}

function appendBetToCsv(row) {
  const normalized = normalizeBetRow(row);
  const exists = fs.existsSync(CSV_PATH);
  if (!exists) {
    fs.writeFileSync(CSV_PATH, CSV_HEADERS.join(",") + "\n", "utf8");
  }
  const line = CSV_HEADERS.map(k => escapeCsv(normalized[k])).join(",") + "\n";
  fs.appendFileSync(CSV_PATH, line, "utf8");
}

const PORT = 80;

function getLocalIPs() {
  const results = [];
  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      if (iface.family === "IPv4" && !iface.internal) {
        results.push({ name, address: iface.address });
      }
    }
  }
  return results;
}

// ── State ────────────────────────────────────────────────────────────────────

let state = {
  draftkings: null,
  fanduel: null,
  fdMaxWager: null,
  betrivers: null,
  updatedAt: null
};

let betState = {
  phase: "idle",      // "idle" | "waiting" | "firing"
  intents: new Set(), // "draftkings" and/or "fanduel"
  timeoutHandle: null
};

// Per-client metadata: source -> { ws, ip, connectedAt, lastSeenAt, oddsUpdates }
const clientMeta = new Map();

// Circular event log — last 50 entries
const eventLog = [];
function pushLog(level, msg) {
  const entry = { ts: Date.now(), level, msg };
  eventLog.push(entry);
  if (eventLog.length > 50) eventLog.shift();
  const prefix = level === "info" ? "ℹ" : level === "warn" ? "⚠" : "✓";
  console.log(`${prefix}  ${new Date(entry.ts).toLocaleTimeString()}  ${msg}`);
  // Push log entry to browser dashboard clients
  wsBroadcastDashboard({ type: "LOG", entry });
}

// ── WebSocket helpers ────────────────────────────────────────────────────────

// All extension clients — used for broadcasting (one entry per connected device)
const wsClients = new Set();

// source -> metadata (for dashboard display and odds tracking)
// source is now a unique device ID like "background-x7k2m1"
// clientMeta still also holds sportsbook-sourced entries for odds tracking

// Browser dashboard clients (the status page)
const dashboardClients = new Set();

function wsBroadcast(data) {
  const msg = JSON.stringify(data);
  for (const ws of wsClients) {
    if (ws.readyState === ws.OPEN) ws.send(msg);
  }
}

function wsBroadcastDashboard(data) {
  const msg = JSON.stringify(data);
  for (const ws of dashboardClients) {
    if (ws.readyState === ws.OPEN) ws.send(msg);
  }
}

function broadcastDebugSnapshot() {
  wsBroadcastDashboard({ type: "SNAPSHOT", ...buildDebugSnapshot() });
}

function buildDebugSnapshot() {
  const clients = [];
  for (const [source, meta] of clientMeta.entries()) {
    clients.push({
      source,
      ip: meta.ip,
      connectedAt: meta.connectedAt,
      lastSeenAt: meta.lastSeenAt,
      oddsUpdates: meta.oddsUpdates,
      connected: meta.ws.readyState === meta.ws.OPEN
    });
  }
  return { state, clients, eventLog: [...eventLog] };
}

function americanToDecimal(american) {
  const n = parseFloat(String(american).replace("−", "-").replace("–", "-"));
  if (isNaN(n)) return null;
  if (n > 0) return n / 100 + 1;
  return 100 / Math.abs(n) + 1;
}

function serverArbValid(intents) {
  const sides = intents ? [...intents] : ["draftkings", "fanduel"];
  const hasBr = sides.includes("betrivers");
  const hasFd = sides.includes("fanduel");
  const dkDec = americanToDecimal(state.draftkings);
  if (hasBr) {
    const brDec = americanToDecimal(state.betrivers);
    if (!dkDec || !brDec) return false;
    return (1 / dkDec) + (1 / brDec) < 1;
  }
  const fdDec = americanToDecimal(state.fanduel);
  if (!dkDec || !fdDec) return false;
  return (1 / dkDec) + (1 / fdDec) < 1;
}

function resetBetState() {
  if (betState.timeoutHandle) {
    clearTimeout(betState.timeoutHandle);
    betState.timeoutHandle = null;
  }
  betState.phase = "idle";
  betState.intents = new Set();
}

function applyOddsUpdate(source, odds, fdMaxWager) {
  if (source === "draftkings") {
    state.draftkings = odds ?? null;
  } else if (source === "fanduel") {
    state.fanduel = odds ?? null;
    if (fdMaxWager != null) state.fdMaxWager = fdMaxWager;
    if (fdMaxWager === null) state.fdMaxWager = null;
  } else if (source === "betrivers") {
    state.betrivers = odds ?? null;
  }
  state.updatedAt = Date.now();
}

// ── HTTP Server ──────────────────────────────────────────────────────────────

const server = http.createServer((req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }

  // GET /state — return current combined odds
  if (req.method === "GET" && req.url === "/state") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(state));
    return;
  }

  // GET /debug — full debug snapshot as JSON
  if (req.method === "GET" && req.url === "/debug") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(buildDebugSnapshot(), null, 2));
    return;
  }

  // POST /update — HTTP fallback, kept for compatibility
  if (req.method === "POST" && req.url === "/update") {
    let body = "";
    req.on("data", chunk => { body += chunk; });
    req.on("end", () => {
      try {
        const data = JSON.parse(body);
        applyOddsUpdate(data.source, data.odds, data.fdMaxWager ?? null);
        wsBroadcast({ type: "ODDS_DATA", ...state });
        broadcastDebugSnapshot();
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: true, state }));
      } catch (e) {
        res.writeHead(400);
        res.end(JSON.stringify({ error: "Invalid JSON" }));
      }
    });
    return;
  }

  // GET /bets.csv — download combined bet log
  if (req.method === "GET" && req.url === "/bets.csv") {
    if (!fs.existsSync(CSV_PATH)) {
      res.writeHead(200, { "Content-Type": "text/csv", "Content-Disposition": "attachment; filename=\"bets.csv\"" });
      res.end(CSV_HEADERS.join(",") + "\n");
      return;
    }
    const csv = fs.readFileSync(CSV_PATH, "utf8");
    res.writeHead(200, { "Content-Type": "text/csv", "Content-Disposition": "attachment; filename=\"bets.csv\"" });
    res.end(csv);
    return;
  }

  // GET / — dashboard
  if (req.method === "GET" && req.url === "/") {
    res.writeHead(200, { "Content-Type": "text/html" });
    res.end(DASHBOARD_HTML);
    return;
  }

  res.writeHead(404);
  res.end("Not found");
});

// ── WebSocket Server ─────────────────────────────────────────────────────────

const wss = new WebSocketServer({ server });

wss.on("connection", (ws, req) => {
  const ip = req.headers["x-forwarded-for"] || req.socket.remoteAddress || "unknown";
  let clientSource = null;
  let isDashboard = false;

  ws.on("message", (raw) => {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }

    if (msg.type === "DASHBOARD") {
      isDashboard = true;
      dashboardClients.add(ws);
      // Send full snapshot immediately
      ws.send(JSON.stringify({ type: "SNAPSHOT", ...buildDebugSnapshot() }));
      return;
    }

    if (msg.type === "IDENTIFY") {
      clientSource = msg.source;
      wsClients.add(ws);
      clientMeta.set(clientSource, {
        ws,
        ip,
        connectedAt: Date.now(),
        lastSeenAt: Date.now(),
        oddsUpdates: 0
      });
      pushLog("info", `${clientSource} connected from ${ip}`);
      broadcastDebugSnapshot();
      // Send current state back immediately
      ws.send(JSON.stringify({ type: "ODDS_DATA", ...state }));
      return;
    }

    if (msg.type === "ODDS_UPDATE") {
      applyOddsUpdate(msg.source, msg.odds, msg.fdMaxWager ?? null);
      const meta = clientMeta.get(msg.source);
      if (meta) {
        meta.lastSeenAt = Date.now();
        meta.oddsUpdates++;
      }
      const oddsStr = msg.odds ?? "null";
      pushLog("ok", `odds update from ${msg.source}: ${oddsStr}${msg.fdMaxWager != null ? ` (max $${msg.fdMaxWager})` : ""}`);
      wsBroadcast({ type: "ODDS_DATA", ...state });
      // Cancel any in-flight bet cycle if odds changed while waiting
      if (betState.phase === "waiting") {
        pushLog("warn", "odds changed during bet handshake — cancelling");
        wsBroadcast({ type: "BET_CANCEL", reason: "odds_changed" });
        resetBetState();
      }
      broadcastDebugSnapshot();
      return;
    }

    if (msg.type === "BET_INTENT") {
      if (betState.phase === "firing") return;
      betState.intents.add(msg.source);
      pushLog("info", `BET_INTENT from ${msg.source} (have: ${[...betState.intents].join(", ")})`);

      if (betState.intents.size === 1) {
        betState.phase = "waiting";
        const waitingOn = msg.source === "draftkings"
          ? (betState.intents.has("betrivers") ? "betrivers" : "fanduel")
          : "draftkings";
        wsBroadcast({ type: "BET_WAITING", waiting_on: waitingOn });
        betState.timeoutHandle = setTimeout(() => {
          pushLog("warn", "BET handshake timed out — resetting");
          wsBroadcast({ type: "BET_CANCEL", reason: "timeout" });
          resetBetState();
          broadcastDebugSnapshot();
        }, 30000);
      } else if (betState.intents.size === 2) {
        clearTimeout(betState.timeoutHandle);
        betState.timeoutHandle = null;
        if (!serverArbValid(betState.intents)) {
          pushLog("warn", "BET_INTENT: arb no longer valid — cancelling");
          wsBroadcast({ type: "BET_CANCEL", reason: "no_arb" });
          resetBetState();
        } else {
          betState.phase = "firing";
          pushLog("ok", "BET_FIRE — arb confirmed, firing both sides");
          wsBroadcast({ type: "BET_FIRE" });
          setTimeout(() => { resetBetState(); broadcastDebugSnapshot(); }, 3000);
        }
        broadcastDebugSnapshot();
      }
      return;
    }

    if (msg.type === "BET_CANCEL") {
      if (betState.phase === "idle") return;
      pushLog("warn", `BET_CANCEL requested by ${msg.source}`);
      wsBroadcast({ type: "BET_CANCEL", reason: "user_cancelled" });
      resetBetState();
      broadcastDebugSnapshot();
      return;
    }

    if (msg.type === "BET_CONFIRMED") {
      pushLog("ok", `BET_CONFIRMED from ${msg.site}: wagered=${msg.totalWagered || msg.wager || "?"}`);
      appendBetToCsv(msg);
      broadcastDebugSnapshot();
      return;
    }

    if (msg.type === "PING") {
      if (clientSource) {
        const meta = clientMeta.get(clientSource);
        if (meta) meta.lastSeenAt = Date.now();
      }
      ws.send(JSON.stringify({ type: "PONG" }));
      return;
    }
  });

  ws.on("close", () => {
    if (isDashboard) {
      dashboardClients.delete(ws);
      return;
    }
    if (clientSource) {
      wsClients.delete(ws);
      clientMeta.delete(clientSource);
      pushLog("warn", `${clientSource} disconnected`);
      // Cancel any in-flight bet cycle if a participant dropped
      if (betState.phase !== "idle") {
        pushLog("warn", `${clientSource} disconnected during bet handshake — cancelling`);
        wsBroadcast({ type: "BET_CANCEL", reason: "user_cancelled" });
        resetBetState();
      }
      broadcastDebugSnapshot();
    }
  });

  ws.on("error", () => {
    if (isDashboard) dashboardClients.delete(ws);
    if (clientSource) {
      wsClients.delete(ws);
      clientMeta.delete(clientSource);
    }
  });
});

// ── Dashboard HTML ───────────────────────────────────────────────────────────

const DASHBOARD_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"/>
<title>Arb Server — Dashboard</title>
<style>
  *{box-sizing:border-box;margin:0;padding:0}
  body{font-family:monospace;background:#0b1118;color:#c9d1d9;font-size:13px;padding:24px;min-height:100vh}
  h1{font-size:18px;color:#00c853;letter-spacing:1px;margin-bottom:4px}
  .subtitle{font-size:11px;color:#555;margin-bottom:24px}
  .grid{display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:16px}
  @media(max-width:700px){.grid{grid-template-columns:1fr}}
  .card{background:#161f28;border:1px solid #1e2e3e;border-radius:8px;padding:16px}
  .card h2{font-size:11px;text-transform:uppercase;letter-spacing:1px;color:#555;margin-bottom:12px}
  .odds-row{display:flex;justify-content:space-between;align-items:center;padding:6px 0;border-bottom:1px solid #1a2535}
  .odds-row:last-child{border-bottom:none}
  .odds-label{color:#888;font-size:11px}
  .odds-value{font-size:20px;font-weight:700;color:#fff}
  .odds-value.empty{font-size:12px;color:#333;font-weight:400;font-style:italic}
  .odds-value.dk{color:#f9a825}
  .odds-value.fd{color:#4fc3f7}
  .badge{display:inline-block;padding:2px 7px;border-radius:4px;font-size:10px;font-weight:700;letter-spacing:.5px}
  .badge.online{background:#0a2a0a;color:#00c853;border:1px solid #00c853}
  .badge.offline{background:#2a0a0a;color:#ff5252;border:1px solid #ff5252}
  .client-row{padding:8px 0;border-bottom:1px solid #1a2535}
  .client-row:last-child{border-bottom:none}
  .client-name{font-size:13px;font-weight:700;color:#fff;margin-bottom:4px}
  .client-name.dk{color:#f9a825}
  .client-name.fd{color:#4fc3f7}
  .client-meta{font-size:11px;color:#555;line-height:1.8}
  .client-meta span{color:#888}
  .log-wrap{background:#161f28;border:1px solid #1e2e3e;border-radius:8px;padding:16px}
  .log-wrap h2{font-size:11px;text-transform:uppercase;letter-spacing:1px;color:#555;margin-bottom:10px}
  #log{height:180px;overflow-y:auto;display:flex;flex-direction:column;gap:3px}
  .log-entry{font-size:11px;display:flex;gap:8px;padding:2px 0}
  .log-ts{color:#333;flex-shrink:0;width:68px}
  .log-msg.info{color:#888}
  .log-msg.ok{color:#00c853}
  .log-msg.warn{color:#f9a825}
  .updated{font-size:10px;color:#333;margin-top:16px;text-align:right}
  .ws-dot{width:7px;height:7px;border-radius:50%;background:#ff5252;display:inline-block;margin-right:5px;vertical-align:middle}
  .ws-dot.online{background:#00c853}
  .no-clients{font-size:11px;color:#333;font-style:italic;padding:6px 0}
</style>
</head>
<body>
<h1>ARB SERVER — DASHBOARD</h1>
<div class="subtitle">Live debug view &nbsp;·&nbsp; auto-updates via WebSocket</div>

<div class="grid">
  <div class="card">
    <h2>Current Odds</h2>
    <div class="odds-row">
      <span class="odds-label">DraftKings</span>
      <span class="odds-value dk" id="dk-val"><span style="font-size:12px;color:#333;font-style:italic">waiting...</span></span>
    </div>
    <div class="odds-row">
      <span class="odds-label">FanDuel</span>
      <span class="odds-value fd" id="fd-val"><span style="font-size:12px;color:#333;font-style:italic">waiting...</span></span>
    </div>
    <div class="odds-row">
      <span class="odds-label">BetRivers</span>
      <span class="odds-value" id="br-val" style="color:#00b4d8"><span style="font-size:12px;color:#333;font-style:italic">waiting...</span></span>
    </div>
    <div class="odds-row">
      <span class="odds-label">FD Max Wager</span>
      <span class="odds-value" id="max-val" style="font-size:14px"><span style="font-size:12px;color:#333;font-style:italic">—</span></span>
    </div>
    <div class="odds-row">
      <span class="odds-label">Last Updated</span>
      <span class="odds-value" id="updated-val" style="font-size:12px;color:#555"><span style="font-style:italic">—</span></span>
    </div>
  </div>

  <div class="card">
    <h2>Connected Clients <span id="ws-status-badge" class="badge offline">WS disconnected</span></h2>
    <div id="clients-container"><div class="no-clients">No clients connected</div></div>
  </div>
</div>

<div class="log-wrap">
  <h2>Event Log</h2>
  <div id="log"></div>
</div>

<div class="updated">Page connected: <span class="ws-dot" id="page-ws-dot"></span><span id="page-ws-text">connecting...</span></div>

<script>
  function fmt(ts) {
    if (!ts) return "—";
    return new Date(ts).toLocaleTimeString();
  }
  function ago(ts) {
    if (!ts) return "—";
    const s = Math.floor((Date.now() - ts) / 1000);
    if (s < 5) return "just now";
    if (s < 60) return s + "s ago";
    return Math.floor(s/60) + "m ago";
  }

  function renderState(state) {
    const dk = document.getElementById("dk-val");
    const fd = document.getElementById("fd-val");
    const mx = document.getElementById("max-val");
    const up = document.getElementById("updated-val");
    const br = document.getElementById("br-val");
    dk.innerHTML = state.draftkings ? state.draftkings : '<span style="font-size:12px;color:#333;font-style:italic">no odds</span>';
    fd.innerHTML = state.fanduel    ? state.fanduel    : '<span style="font-size:12px;color:#333;font-style:italic">no odds</span>';
    if (br) br.innerHTML = state.betrivers ? state.betrivers : '<span style="font-size:12px;color:#333;font-style:italic">no odds</span>';
    mx.innerHTML = state.fdMaxWager != null ? '$' + Number(state.fdMaxWager).toFixed(2) : '<span style="font-size:12px;color:#333;font-style:italic">—</span>';
    up.innerHTML = state.updatedAt  ? fmt(state.updatedAt) : '<span style="font-style:italic">—</span>';
  }

  function renderClients(clients) {
    const el = document.getElementById("clients-container");
    const badge = document.getElementById("ws-status-badge");
    if (!clients || clients.length === 0) {
      el.innerHTML = '<div class="no-clients">No clients connected</div>';
      badge.textContent = "0 clients";
      badge.className = "badge offline";
      return;
    }
    badge.textContent = clients.length + " client" + (clients.length > 1 ? "s" : "");
    badge.className = "badge online";
    el.innerHTML = clients.map(c => {
      const cls = c.source === "draftkings" ? "dk" : "fd";
      const label = c.source === "draftkings" ? "DraftKings" : "FanDuel";
      const status = c.connected
        ? '<span style="color:#00c853">● connected</span>'
        : '<span style="color:#ff5252">● disconnected</span>';
      return \`<div class="client-row">
        <div class="client-name \${cls}">\${label} \${status}</div>
        <div class="client-meta">
          IP: <span>\${c.ip}</span><br>
          Connected: <span>\${fmt(c.connectedAt)}</span><br>
          Last seen: <span>\${ago(c.lastSeenAt)}</span><br>
          Odds updates sent: <span>\${c.oddsUpdates}</span>
        </div>
      </div>\`;
    }).join("");
  }

  function appendLog(entry) {
    const el = document.getElementById("log");
    const div = document.createElement("div");
    div.className = "log-entry";
    div.innerHTML = \`<span class="log-ts">\${fmt(entry.ts)}</span><span class="log-msg \${entry.level}">\${entry.msg}</span>\`;
    el.appendChild(div);
    el.scrollTop = el.scrollHeight;
  }

  function renderLog(entries) {
    const el = document.getElementById("log");
    el.innerHTML = "";
    for (const e of entries) appendLog(e);
  }

  // WebSocket connection to dashboard feed
  const dot = document.getElementById("page-ws-dot");
  const txt = document.getElementById("page-ws-text");

  function connect() {
    const ws = new WebSocket("ws://" + location.host);

    ws.onopen = () => {
      dot.className = "ws-dot online";
      txt.textContent = "connected";
      ws.send(JSON.stringify({ type: "DASHBOARD" }));
    };

    ws.onmessage = (e) => {
      const msg = JSON.parse(e.data);
      if (msg.type === "SNAPSHOT") {
        renderState(msg.state);
        renderClients(msg.clients);
        renderLog(msg.eventLog);
      }
      if (msg.type === "LOG") {
        appendLog(msg.entry);
      }
      if (msg.type === "ODDS_DATA") {
        renderState(msg);
      }
    };

    ws.onclose = () => {
      dot.className = "ws-dot";
      txt.textContent = "disconnected — reconnecting...";
      setTimeout(connect, 3000);
    };
  }

  connect();

  // Refresh "last seen" ago timestamps every 5s
  setInterval(() => {
    fetch("/debug").then(r => r.json()).then(d => renderClients(d.clients));
  }, 5000);
</script>
</body>
</html>`;

// ── Start ────────────────────────────────────────────────────────────────────

server.listen(PORT, "0.0.0.0", () => {
  const ips = getLocalIPs();
  console.log(`\n✓ Arb LAN server running on port ${PORT}\n`);
  console.log(`  Dashboard: http://localhost:${PORT}`);
  if (ips.length > 0) {
    for (const { name, address } of ips) {
      console.log(`  Network:   http://${address}:${PORT}  (${name})`);
    }
    console.log(`\n  → Enter one of the Network addresses above into the extension popup.`);
  }
  console.log(`\n  Debug API: GET /debug\n`);
  pushLog("ok", "server started on port " + PORT);
});
