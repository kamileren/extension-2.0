// Shared banner injection logic (included by both content scripts)

function injectBannerStyles() {
  if (document.getElementById("arb-banner-styles")) return;
  const style = document.createElement("style");
  style.id = "arb-banner-styles";
  style.textContent = `
    #arb-banner {
      position: fixed;
      top: 0;
      left: 0;
      width: 100%;
      z-index: 2147483647;
      background: linear-gradient(135deg, #0f1923 0%, #1a2d1a 50%, #0f1923 100%);
      color: #fff;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      font-size: 13px;
      border-bottom: 2px solid #00c853;
      box-shadow: 0 2px 16px rgba(0,200,83,0.3);
      transition: all 0.3s ease;
      padding: 0;
    }
    #arb-banner.arb-no-opportunity {
      border-bottom-color: #ff5252;
      box-shadow: 0 2px 16px rgba(255,82,82,0.2);
    }
    #arb-banner-inner {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 8px 16px;
      gap: 12px;
      flex-wrap: wrap;
    }
    #arb-banner .arb-logo {
      font-weight: 800;
      font-size: 14px;
      color: #00c853;
      letter-spacing: 1px;
      white-space: nowrap;
    }
    #arb-banner .arb-odds-group {
      display: flex;
      align-items: center;
      gap: 20px;
      flex-wrap: wrap;
    }
    #arb-banner .arb-site {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 2px;
    }
    #arb-banner .arb-site-name {
      font-size: 10px;
      text-transform: uppercase;
      letter-spacing: 1px;
      opacity: 0.6;
    }
    #arb-banner .arb-site-dk .arb-site-name { color: #f9a825; }
    #arb-banner .arb-site-fd .arb-site-name { color: #1565c0; }
    #arb-banner .arb-odd {
      font-size: 20px;
      font-weight: 700;
      color: #fff;
    }
    #arb-banner .arb-bet {
      font-size: 11px;
      color: #00e676;
      font-weight: 600;
    }
    #arb-banner .arb-divider {
      color: #444;
      font-size: 20px;
    }
    #arb-banner .arb-result {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 2px;
    }
    #arb-banner .arb-profit-label {
      font-size: 10px;
      text-transform: uppercase;
      letter-spacing: 1px;
      opacity: 0.6;
    }
    #arb-banner .arb-profit-value {
      font-size: 18px;
      font-weight: 800;
      color: #00e676;
    }
    #arb-banner .arb-profit-value.arb-loss {
      color: #ff5252;
    }
    #arb-banner .arb-profit-pct {
      font-size: 11px;
      color: #00c853;
    }
    #arb-banner .arb-status {
      font-size: 12px;
      opacity: 0.7;
      font-style: italic;
    }
    #arb-banner .arb-controls {
      display: flex;
      align-items: center;
      gap: 8px;
    }
    #arb-banner .arb-stake-label {
      font-size: 11px;
      opacity: 0.7;
    }
    #arb-banner .arb-stake-input {
      width: 70px;
      padding: 4px 6px;
      border-radius: 4px;
      border: 1px solid #333;
      background: #1e2a1e;
      color: #fff;
      font-size: 13px;
      font-weight: 600;
      text-align: center;
      outline: none;
    }
    #arb-banner .arb-stake-input:focus {
      border-color: #00c853;
    }
    #arb-banner .arb-close-btn {
      background: none;
      border: none;
      color: #666;
      cursor: pointer;
      font-size: 16px;
      padding: 2px 4px;
      line-height: 1;
    }
    #arb-banner .arb-close-btn:hover { color: #fff; }
    body { padding-top: 58px !important; }
  `;
  document.head.appendChild(style);
}

function getOrCreateBanner() {
  let banner = document.getElementById("arb-banner");
  if (!banner) {
    banner = document.createElement("div");
    banner.id = "arb-banner";
    banner.innerHTML = `<div id="arb-banner-inner"><span class="arb-logo">ARB</span><span class="arb-status">Waiting for odds from both sites...</span></div>`;
    document.body.insertBefore(banner, document.body.firstChild);
  }
  return banner;
}

function renderBanner(dkOdds, fdOdds, stake) {
  injectBannerStyles();
  const banner = getOrCreateBanner();
  const inner = document.getElementById("arb-banner-inner");

  if (!dkOdds && !fdOdds) {
    inner.innerHTML = `
      <span class="arb-logo">ARB</span>
      <span class="arb-status">Open DraftKings &amp; FanDuel — odds will be captured automatically.</span>
      ${stakeInputHTML(stake)}
      <button class="arb-close-btn" onclick="document.getElementById('arb-banner').remove(); document.body.style.paddingTop=''">✕</button>
    `;
    return;
  }

  if (!dkOdds || !fdOdds) {
    const missing = !dkOdds ? "DraftKings" : "FanDuel";
    inner.innerHTML = `
      <span class="arb-logo">ARB</span>
      <span class="arb-status">Waiting for <strong>${missing}</strong> odds...</span>
      ${dkOdds ? `<span class="arb-site arb-site-dk"><span class="arb-site-name">DraftKings</span><span class="arb-odd">${dkOdds}</span></span>` : ""}
      ${fdOdds ? `<span class="arb-site arb-site-fd"><span class="arb-site-name">FanDuel</span><span class="arb-odd">${fdOdds}</span></span>` : ""}
      ${stakeInputHTML(stake)}
      <button class="arb-close-btn" onclick="document.getElementById('arb-banner').remove(); document.body.style.paddingTop=''">✕</button>
    `;
    return;
  }

  // Both odds available — calculate
  const result = calcBets(dkOdds, fdOdds, parseFloat(stake) || 100);

  if (!result) {
    banner.classList.add("arb-no-opportunity");
    inner.innerHTML = `
      <span class="arb-logo">ARB</span>
      <div class="arb-odds-group">
        <div class="arb-site arb-site-dk">
          <span class="arb-site-name">DraftKings</span>
          <span class="arb-odd">${dkOdds}</span>
        </div>
        <span class="arb-divider">vs</span>
        <div class="arb-site arb-site-fd">
          <span class="arb-site-name">FanDuel</span>
          <span class="arb-odd">${fdOdds}</span>
        </div>
      </div>
      <div class="arb-result">
        <span class="arb-profit-label">Status</span>
        <span class="arb-profit-value arb-loss">No Arb</span>
        <span class="arb-profit-pct">Combined implied prob &gt; 100%</span>
      </div>
      ${stakeInputHTML(stake)}
      <button class="arb-close-btn" onclick="document.getElementById('arb-banner').remove(); document.body.style.paddingTop=''">✕</button>
    `;
    return;
  }

  banner.classList.remove("arb-no-opportunity");
  inner.innerHTML = `
    <span class="arb-logo">ARB ✓</span>
    <div class="arb-odds-group">
      <div class="arb-site arb-site-dk">
        <span class="arb-site-name">DraftKings</span>
        <span class="arb-odd">${dkOdds}</span>
        <span class="arb-bet">Bet $${result.bet1}</span>
      </div>
      <span class="arb-divider">↔</span>
      <div class="arb-site arb-site-fd">
        <span class="arb-site-name">FanDuel</span>
        <span class="arb-odd">${fdOdds}</span>
        <span class="arb-bet">Bet $${result.bet2}</span>
      </div>
    </div>
    <div class="arb-result">
      <span class="arb-profit-label">Guaranteed Profit</span>
      <span class="arb-profit-value">+$${result.profit}</span>
      <span class="arb-profit-pct">${result.profitMargin}% ROI</span>
    </div>
    ${stakeInputHTML(stake)}
    <button class="arb-close-btn" onclick="document.getElementById('arb-banner').remove(); document.body.style.paddingTop=''">✕</button>
  `;

  // Re-attach stake listener
  const input = document.getElementById("arb-stake-input");
  if (input) {
    input.addEventListener("change", () => {
      const newStake = parseFloat(input.value) || 100;
      chrome.storage.local.set({ arbStake: newStake });
      chrome.runtime.sendMessage({ type: "GET_ODDS" }, (data) => {
        if (data) renderBanner(data.draftkings, data.fanduel, newStake);
      });
    });
  }
}

function stakeInputHTML(stake) {
  return `
    <div class="arb-controls">
      <span class="arb-stake-label">Total Stake $</span>
      <input id="arb-stake-input" class="arb-stake-input" type="number" min="1" value="${parseFloat(stake) || 100}" />
    </div>
  `;
}
