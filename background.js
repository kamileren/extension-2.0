// Store odds and max wager from each site
let oddsData = {
  draftkings: null,
  fanduel: null,
  fdMaxWager: null
};

let serverUrl = null;
let serverPollInterval = null;

// Load saved server URL on startup
chrome.storage.local.get("serverUrl", ({ serverUrl: saved }) => {
  if (saved) startServerSync(saved);
});

function broadcast() {
  chrome.tabs.query({}, (tabs) => {
    tabs.forEach((tab) => {
      if (
        tab.url &&
        (tab.url.includes("draftkings.com") || tab.url.includes("fanduel.com") || tab.url.includes("fanduel.ca"))
      ) {
        chrome.tabs.sendMessage(tab.id, {
          type: "ODDS_DATA",
          draftkings: oddsData.draftkings,
          fanduel: oddsData.fanduel,
          fdMaxWager: oddsData.fdMaxWager
        }).catch(() => {});
      }
    });
  });
}

// Push local update to LAN server
async function pushToServer(source, odds, fdMaxWager) {
  if (!serverUrl) return;
  try {
    await fetch(`http://${serverUrl}/update`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ source, odds, fdMaxWager }),
      signal: AbortSignal.timeout(2000)
    });
  } catch (_) {}
}

// Pull state from LAN server and merge — remote wins for the opposite side
async function pullFromServer() {
  if (!serverUrl) return;
  try {
    const r = await fetch(`http://${serverUrl}/state`, { signal: AbortSignal.timeout(2000) });
    if (!r.ok) return;
    const remote = await r.json();

    let changed = false;

    if (remote.draftkings !== oddsData.draftkings) {
      oddsData.draftkings = remote.draftkings;
      changed = true;
    }
    if (remote.fanduel !== oddsData.fanduel) {
      oddsData.fanduel = remote.fanduel;
      changed = true;
    }
    // Sticky max: only update if remote has a value
    if (remote.fdMaxWager != null && remote.fdMaxWager !== oddsData.fdMaxWager) {
      oddsData.fdMaxWager = remote.fdMaxWager;
      changed = true;
    }

    if (changed) broadcast();
  } catch (_) {}
}

function startServerSync(url) {
  serverUrl = url;
  if (serverPollInterval) clearInterval(serverPollInterval);
  if (!url) { serverPollInterval = null; return; }
  // Poll server every 2 seconds to pick up odds from the other device
  serverPollInterval = setInterval(pullFromServer, 2000);
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === "ODDS_UPDATE") {
    oddsData[message.source] = message.odds;
    if (message.source === "fanduel") {
      if (message.fdMaxWager != null) oddsData.fdMaxWager = message.fdMaxWager;
    }
    broadcast();
    // Push to server so the other device sees it
    pushToServer(message.source, message.odds, message.fdMaxWager ?? null);
  }

  if (message.type === "GET_ODDS") {
    sendResponse(oddsData);
  }

  if (message.type === "SET_SERVER") {
    chrome.storage.local.set({ serverUrl: message.serverUrl || null });
    startServerSync(message.serverUrl || null);
  }

  return true;
});
