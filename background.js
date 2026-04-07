// Store odds and max wager from each site
let oddsData = {
  draftkings: null,
  fanduel: null,
  fdMaxWager: null,
  betrivers: null,
  // line info: { direction: "Over"|"Under", line: 131.5 } per site
  dkLine: null,
  fdLine: null,
  brLine: null
};

let serverUrl = null;
let ws = null;
let wsReconnectTimer = null;
let wsIdentified = false;

// Load saved server URL on startup
chrome.storage.local.get("serverUrl", ({ serverUrl: saved }) => {
  if (saved) connectWebSocket(saved);
});

function broadcast() {
  chrome.tabs.query({}, (tabs) => {
    tabs.forEach((tab) => {
      if (
        tab.url &&
        (tab.url.includes("draftkings.com") || tab.url.includes("fanduel.com") || tab.url.includes("fanduel.ca") || tab.url.includes("betrivers.com") || tab.url.includes("betrivers.ca"))
      ) {
        chrome.tabs.sendMessage(tab.id, {
          type: "ODDS_DATA",
          draftkings: oddsData.draftkings,
          fanduel: oddsData.fanduel,
          fdMaxWager: oddsData.fdMaxWager,
          betrivers: oddsData.betrivers,
          dkLine: oddsData.dkLine,
          fdLine: oddsData.fdLine,
          brLine: oddsData.brLine
        }).catch(() => {});
      }
    });
  });
}

// ── WebSocket client ─────────────────────────────────────────────────────────

function connectWebSocket(url) {
  serverUrl = url;

  // Clean up any existing connection
  if (ws) {
    ws.onclose = null; // prevent reconnect loop on intentional close
    ws.close();
    ws = null;
  }
  if (wsReconnectTimer) {
    clearTimeout(wsReconnectTimer);
    wsReconnectTimer = null;
  }
  if (!url) return;

  wsIdentified = false;

  try {
    ws = new WebSocket(`ws://${url}`);
  } catch (_) {
    scheduleReconnect(url);
    return;
  }

  ws.onopen = () => {
    wsIdentified = true;
    // Use a unique ID per device so two backgrounds don't collide on the server
    const deviceId = "background-" + Math.random().toString(36).slice(2, 8);
    ws.send(JSON.stringify({ type: "IDENTIFY", source: deviceId }));
  };

  ws.onmessage = (event) => {
    let msg;
    try { msg = JSON.parse(event.data); } catch { return; }

    if (msg.type === "ODDS_DATA") {
      let changed = false;

      if (msg.draftkings !== oddsData.draftkings) {
        oddsData.draftkings = msg.draftkings;
        changed = true;
      }
      if (msg.fanduel !== oddsData.fanduel) {
        oddsData.fanduel = msg.fanduel;
        changed = true;
      }
      if (msg.fdMaxWager != null && msg.fdMaxWager !== oddsData.fdMaxWager) {
        oddsData.fdMaxWager = msg.fdMaxWager;
        changed = true;
      }
      // Allow server-side null to clear the sticky max
      if (msg.fdMaxWager === null && oddsData.fdMaxWager !== null) {
        oddsData.fdMaxWager = null;
        changed = true;
      }

      if (changed) broadcast();
    }

    // Forward bet coordination messages to all DK/FD/BR tabs instantly
    if (msg.type === "BET_FIRE" || msg.type === "BET_CANCEL" || msg.type === "BET_WAITING" || msg.type === "BET_FD_ACTUAL") {
      chrome.tabs.query({}, (tabs) => {
        tabs.forEach((tab) => {
          if (
            tab.url &&
            (tab.url.includes("draftkings.com") || tab.url.includes("fanduel.com") || tab.url.includes("fanduel.ca") || tab.url.includes("betrivers.com") || tab.url.includes("betrivers.ca"))
          ) {
            chrome.tabs.sendMessage(tab.id, msg).catch(() => {});
          }
        });
      });
    }
  };

  ws.onclose = () => {
    wsIdentified = false;
    ws = null;
    scheduleReconnect(url);
  };

  ws.onerror = () => {
    // onclose fires after onerror — reconnect happens there
  };
}

function scheduleReconnect(url) {
  if (wsReconnectTimer) clearTimeout(wsReconnectTimer);
  wsReconnectTimer = setTimeout(() => connectWebSocket(url), 3000);
}

// Send an odds update to the server over WebSocket
function pushToServer(source, odds, fdMaxWager) {
  if (!ws || ws.readyState !== WebSocket.OPEN) return;
  ws.send(JSON.stringify({ type: "ODDS_UPDATE", source, odds, fdMaxWager: fdMaxWager ?? null }));
}

// ── Chrome message listener ──────────────────────────────────────────────────

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === "ODDS_UPDATE") {
    oddsData[message.source] = message.odds;
    if (message.source === "fanduel") {
      if (message.hasOwnProperty("fdMaxWager")) {
        if (message.fdMaxWager != null) {
          oddsData.fdMaxWager = message.fdMaxWager;
        } else if (message.fdMaxWager === null) {
          oddsData.fdMaxWager = null;
        }
      }
      oddsData.fdLine = message.lineInfo || null;
    } else if (message.source === "draftkings") {
      oddsData.dkLine = message.lineInfo || null;
    } else if (message.source === "betrivers") {
      oddsData.brLine = message.lineInfo || null;
    }
    broadcast();
    pushToServer(message.source, message.odds, message.fdMaxWager ?? null);
  }

  if (message.type === "GET_ODDS") {
    sendResponse(oddsData);
  }

  if (message.type === "SET_SERVER") {
    const newUrl = message.serverUrl || null;
    chrome.storage.local.set({ serverUrl: newUrl });
    connectWebSocket(newUrl);
  }

  if (message.type === "BET_INTENT") {
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: "BET_INTENT", source: message.source }));
    }
  }

  if (message.type === "BET_CANCEL") {
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: "BET_CANCEL", source: message.source }));
    }
  }

  if (message.type === "BET_CONFIRMED") {
    console.log(`[ARB] Bet confirmed on ${message.site}:`, message);
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: "BET_CONFIRMED", ...message }));
    }
  }

  if (message.type === "BET_FD_ACTUAL") {
    // FD content script is telling us the real bet amount after max wager cap.
    // Forward directly to DK tabs so DK can adjust its wager immediately.
    chrome.tabs.query({}, (tabs) => {
      tabs.forEach((tab) => {
        if (tab.url && tab.url.includes("draftkings.com")) {
          chrome.tabs.sendMessage(tab.id, message).catch(() => {});
        }
      });
    });
  }


  if (message.type === "GET_WS_STATUS") {
    sendResponse({
      connected: ws !== null && ws.readyState === WebSocket.OPEN,
      serverUrl
    });
  }

  return true;
});
