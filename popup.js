function americanToDecimal(american) {
  const n = parseFloat(String(american).replace("−", "-").replace("–", "-"));
  if (isNaN(n)) return null;
  if (n > 0) return n / 100 + 1;
  return 100 / Math.abs(n) + 1;
}

function calcBets(dkOdds, fdOdds, totalStake, fdMax) {
  const dkDec = americanToDecimal(dkOdds);
  const fdDec = americanToDecimal(fdOdds);
  if (!dkDec || !fdDec) return null;
  const ipDk = 1 / dkDec, ipFd = 1 / fdDec, total = ipDk + ipFd;
  if (total >= 1) return null;
  const margin = ((1 / total) - 1) * 100;
  let betFd = (totalStake * ipFd) / total;
  let betDk = (totalStake * ipDk) / total;
  let capped = false, effectiveStake = totalStake;
  if (fdMax != null && betFd > fdMax) {
    betFd = fdMax;
    betDk = (betFd * fdDec) / dkDec;
    effectiveStake = betFd + betDk;
    capped = true;
  }
  const profit = Math.min(betDk * dkDec, betFd * fdDec) - effectiveStake;
  return {
    betDk: betDk.toFixed(2), betFd: betFd.toFixed(2),
    profit: profit.toFixed(2), profitMargin: margin.toFixed(2),
    effectiveStake: effectiveStake.toFixed(2), capped
  };
}

function render(dkOdds, fdOdds, stake, fdMaxWager) {
  const dkEl = document.getElementById("dk-odds");
  const fdEl = document.getElementById("fd-odds");
  const resultEl = document.getElementById("result-container");
  const s = parseFloat(stake) || 100;
  const fdMax = fdMaxWager != null ? parseFloat(fdMaxWager) : null;

  dkEl.innerHTML = dkOdds ? dkOdds : '<span class="odds-empty">Open DraftKings tab...</span>';
  fdEl.innerHTML = fdOdds ? fdOdds : '<span class="odds-empty">Open FanDuel tab...</span>';

  if (!dkOdds || !fdOdds) {
    resultEl.innerHTML = '<div class="waiting">Waiting for odds from both sites...</div>';
    return;
  }

  const result = calcBets(dkOdds, fdOdds, s, fdMax);

  if (!result) {
    resultEl.innerHTML = `
      <div class="result-box no-arb">
        <div class="result-label">Status</div>
        <div class="result-profit loss">No Arb</div>
        <div class="result-detail">Combined implied probability exceeds 100%</div>
      </div>`;
    return;
  }

  const stakeNote = result.capped
    ? `${result.profitMargin}% ROI · Total $${result.effectiveStake} (FD capped)`
    : `${result.profitMargin}% ROI on $${s}`;

  resultEl.innerHTML = `
    <div class="result-box">
      <div class="result-label">Guaranteed Profit</div>
      <div class="result-profit">+$${result.profit}</div>
      <div class="result-detail">${stakeNote}</div>
    </div>
    <div class="bet-split">
      <div class="bet-item">
        <div class="bet-item-label dk">DraftKings</div>
        <div class="bet-item-amount">$${result.betDk}</div>
      </div>
      <div class="bet-item">
        <div class="bet-item-label fd">FanDuel${result.capped ? " (MAX)" : ""}</div>
        <div class="bet-item-amount">$${result.betFd}</div>
      </div>
    </div>`;
}

// ---- Server status check ----
function checkServer(serverUrl) {
  const dot = document.getElementById("status-dot");
  const txt = document.getElementById("status-text");
  if (!serverUrl) {
    dot.className = "status-dot disabled";
    txt.textContent = "Not configured — single device mode";
    return;
  }
  chrome.runtime.sendMessage({ type: "GET_WS_STATUS" }, (status) => {
    if (status && status.connected) {
      dot.className = "status-dot online";
      txt.textContent = `Connected to ${serverUrl}`;
    } else {
      dot.className = "status-dot offline";
      txt.textContent = `Cannot reach ${serverUrl}`;
    }
  });
}

function loadAndRender() {
  chrome.storage.local.get(["arbStake", "serverUrl"], ({ arbStake, serverUrl }) => {
    const stake = arbStake || 100;
    document.getElementById("stake").value = stake;
    if (serverUrl) document.getElementById("server-ip").value = serverUrl;
    chrome.runtime.sendMessage({ type: "GET_ODDS" }, (data) => {
      render(data ? data.draftkings : null, data ? data.fanduel : null, stake, data ? data.fdMaxWager : null);
    });
    checkServer(serverUrl);
  });
}

document.getElementById("stake").addEventListener("change", (e) => {
  const newStake = parseFloat(e.target.value) || 100;
  chrome.storage.local.set({ arbStake: newStake });
  chrome.runtime.sendMessage({ type: "GET_ODDS" }, (data) => {
    render(data ? data.draftkings : null, data ? data.fanduel : null, newStake, data ? data.fdMaxWager : null);
  });
});

document.getElementById("server-save").addEventListener("click", () => {
  const val = document.getElementById("server-ip").value.trim();
  chrome.storage.local.set({ serverUrl: val || null });
  // Tell background to start/stop syncing
  chrome.runtime.sendMessage({ type: "SET_SERVER", serverUrl: val || null });
  checkServer(val);
});

document.getElementById("clear-btn").addEventListener("click", () => {
  chrome.runtime.sendMessage({ type: "ODDS_UPDATE", source: "draftkings", odds: null });
  chrome.runtime.sendMessage({ type: "ODDS_UPDATE", source: "fanduel", odds: null, fdMaxWager: null });
  setTimeout(loadAndRender, 100);
});

loadAndRender();
setInterval(loadAndRender, 2000);
