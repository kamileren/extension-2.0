// Arb Calculator LAN Server
// Run with: node server.js
// Both devices must be on the same network.
// Find your local IP with: ipconfig (Windows) or ifconfig (Mac/Linux)

const http = require("http");
const os = require("os");
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

let state = {
  draftkings: null,
  fanduel: null,
  fdMaxWager: null,
  updatedAt: null
};

const server = http.createServer((req, res) => {
  // CORS — allow the extension (chrome-extension://*) and any LAN origin
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

  // POST /update — receive odds from one side
  if (req.method === "POST" && req.url === "/update") {
    let body = "";
    req.on("data", chunk => { body += chunk; });
    req.on("end", () => {
      try {
        const data = JSON.parse(body);
        if (data.source === "draftkings") {
          state.draftkings = data.odds ?? null;
        } else if (data.source === "fanduel") {
          state.fanduel = data.odds ?? null;
          // Only update sticky max if a new value is provided
          if (data.fdMaxWager != null) {
            state.fdMaxWager = data.fdMaxWager;
          }
        }
        state.updatedAt = Date.now();
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: true, state }));
      } catch (e) {
        res.writeHead(400);
        res.end(JSON.stringify({ error: "Invalid JSON" }));
      }
    });
    return;
  }

  // GET / — simple status page
  if (req.method === "GET" && req.url === "/") {
    res.writeHead(200, { "Content-Type": "text/html" });
    res.end(`<!DOCTYPE html>
<html>
<head><title>Arb Server</title>
<style>
  body { font-family: monospace; background: #0f1923; color: #00c853; padding: 30px; }
  pre { background: #1a2d1a; padding: 16px; border-radius: 8px; border: 1px solid #00c853; }
  h2 { color: #fff; }
</style>
</head>
<body>
  <h2>Arb Calculator — LAN Server</h2>
  <p>Running on port <b>${PORT}</b></p>
  <p>Share your local IP with the other device and set it in the extension settings.</p>
  <h3>Current State:</h3>
  <pre id="state">Loading...</pre>
  <script>
    async function refresh() {
      const r = await fetch("/state");
      const d = await r.json();
      document.getElementById("state").textContent = JSON.stringify(d, null, 2);
    }
    refresh();
    setInterval(refresh, 1500);
  </script>
</body>
</html>`);
    return;
  }

  res.writeHead(404);
  res.end("Not found");
});

server.listen(PORT, "0.0.0.0", () => {
  const ips = getLocalIPs();
  console.log(`\n✓ Arb LAN server running on port ${PORT}\n`);
  console.log(`  Local:    http://localhost:${PORT}`);
  if (ips.length === 0) {
    console.log(`  Network:  (no network interfaces found)`);
  } else {
    for (const { name, address } of ips) {
      console.log(`  Network:  http://${address}:${PORT}  (${name})`);
    }
    console.log(`\n  → Enter one of the Network addresses above into the extension popup.`);
  }
  console.log();
});
