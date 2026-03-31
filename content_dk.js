// DraftKings content script
// Injects arb.js and banner.js inline since content scripts can't share modules easily

(function () {
  // ---- arb.js inlined ----
  function americanToDecimal(american) {
    const n = parseFloat(String(american).replace("−", "-").replace("–", "-"));
    if (isNaN(n)) return null;
    if (n > 0) return n / 100 + 1;
    return 100 / Math.abs(n) + 1;
  }
  // odds1 = DK, odds2 = FD. fdMax caps the FD side.
  function calcBets(dkOdds, fdOdds, totalStake, fdMax) {
    const dkDec = americanToDecimal(dkOdds);
    const fdDec = americanToDecimal(fdOdds);
    if (!dkDec || !fdDec) return null;
    const ipDk = 1 / dkDec, ipFd = 1 / fdDec, total = ipDk + ipFd;
    if (total >= 1) return null;
    const margin = ((1 / total) - 1) * 100;

    let betFd = (totalStake * ipFd) / total;
    let betDk = (totalStake * ipDk) / total;
    let capped = false;
    let effectiveStake = totalStake;

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

  // ---- banner logic ----
  function injectStyles() {
    if (document.getElementById("arb-banner-styles")) return;
    const style = document.createElement("style");
    style.id = "arb-banner-styles";
    style.textContent = getBannerCSS();
    document.head.appendChild(style);
  }

  function getBannerCSS() {
    return `
      #arb-banner {
        position: fixed; top: 0; left: 0; width: 100%; z-index: 2147483647;
        background: linear-gradient(135deg, #0f1923 0%, #1a2d1a 50%, #0f1923 100%);
        color: #fff; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
        font-size: 13px; border-bottom: 2px solid #00c853;
        box-shadow: 0 2px 16px rgba(0,200,83,0.3); box-sizing: border-box;
      }
      #arb-banner.no-arb { border-bottom-color: #ff5252; box-shadow: 0 2px 16px rgba(255,82,82,0.2); }
      #arb-banner-inner {
        display: flex; align-items: center; justify-content: space-between;
        padding: 8px 16px; gap: 12px; flex-wrap: wrap;
      }
      .arb-logo { font-weight: 800; font-size: 15px; color: #00c853; letter-spacing: 1px; white-space: nowrap; }
      .arb-odds-group { display: flex; align-items: center; gap: 20px; flex-wrap: wrap; }
      .arb-site { display: flex; flex-direction: column; align-items: center; gap: 2px; }
      .arb-site-name { font-size: 10px; text-transform: uppercase; letter-spacing: 1px; opacity: 0.6; }
      .arb-site-dk .arb-site-name { color: #f9a825; }
      .arb-site-fd .arb-site-name { color: #4fc3f7; }
      .arb-odd { font-size: 20px; font-weight: 700; color: #fff; }
      .arb-bet { font-size: 11px; color: #00e676; font-weight: 600; }
      .arb-divider { color: #555; font-size: 20px; }
      .arb-result { display: flex; flex-direction: column; align-items: center; gap: 2px; }
      .arb-profit-label { font-size: 10px; text-transform: uppercase; letter-spacing: 1px; opacity: 0.6; }
      .arb-profit-value { font-size: 18px; font-weight: 800; color: #00e676; }
      .arb-profit-value.loss { color: #ff5252; }
      .arb-profit-pct { font-size: 11px; color: #00c853; }
      .arb-status { font-size: 12px; opacity: 0.7; font-style: italic; }
      .arb-controls { display: flex; align-items: center; gap: 8px; }
      .arb-stake-label { font-size: 11px; opacity: 0.7; }
      .arb-stake-input {
        width: 70px; padding: 4px 6px; border-radius: 4px; border: 1px solid #333;
        background: #1e2a1e; color: #fff; font-size: 13px; font-weight: 600;
        text-align: center; outline: none;
      }
      .arb-stake-input:focus { border-color: #00c853; }
      .arb-close-btn {
        background: none; border: none; color: #666; cursor: pointer;
        font-size: 16px; padding: 2px 6px; line-height: 1;
      }
      .arb-close-btn:hover { color: #fff; }
      .arb-bet-capped { font-size: 10px; color: #ff9800; font-weight: 600; }
    `;
  }

  function renderBanner(dkOdds, fdOdds, stake, fdMaxWager) {
    injectStyles();
    let banner = document.getElementById("arb-banner");
    if (!banner) {
      banner = document.createElement("div");
      banner.id = "arb-banner";
      document.body.insertBefore(banner, document.body.firstChild);
      // push page content down
      document.body.style.marginTop = "58px";
    }

    const s = parseFloat(stake) || 100;
    const fdMax = fdMaxWager != null ? parseFloat(fdMaxWager) : null;

    if (!dkOdds || !fdOdds) {
      banner.className = "";
      banner.innerHTML = `<div id="arb-banner-inner">
        <span class="arb-logo">ARB CALC</span>
        <span class="arb-status">
          ${dkOdds ? `DK: <b>${dkOdds}</b>` : "Waiting for <b>DraftKings</b> odds..."}
          &nbsp;|&nbsp;
          ${fdOdds ? `FD: <b>${fdOdds}</b>` : "Waiting for <b>FanDuel</b> odds..."}
        </span>
        ${stakeHTML(s)}
        <button class="arb-close-btn" id="arb-close">✕</button>
      </div>`;
      attachListeners();
      return;
    }

    const result = calcBets(dkOdds, fdOdds, s, fdMax);

    if (!result) {
      banner.className = "no-arb";
      banner.innerHTML = `<div id="arb-banner-inner">
        <span class="arb-logo">ARB CALC</span>
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
          <span class="arb-profit-value loss">No Arb</span>
          <span class="arb-profit-pct">Implied prob &gt; 100%</span>
        </div>
        ${stakeHTML(s)}
        <button class="arb-close-btn" id="arb-close">✕</button>
      </div>`;
    } else {
      const capNote = result.capped
        ? `<span class="arb-bet-capped">MAX $${result.betFd}</span>`
        : `<span class="arb-bet">Bet $${result.betFd}</span>`;
      const stakeNote = result.capped
        ? `${result.profitMargin}% ROI · Total stake $${result.effectiveStake} (FD capped)`
        : `${result.profitMargin}% ROI on $${s}`;

      // Auto-fill the DK wager input (floored, no cents).
      const dkBetFloored = Math.floor(parseFloat(result.betDk));
      if (dkBetFloored !== lastFilledAmount) {
        lastFilledAmount = dkBetFloored;
        setTimeout(() => fillDkInput(dkBetFloored), 120);
      }

      banner.className = "";
      banner.innerHTML = `<div id="arb-banner-inner">
        <span class="arb-logo">ARB ✓</span>
        <div class="arb-odds-group">
          <div class="arb-site arb-site-dk">
            <span class="arb-site-name">DraftKings</span>
            <span class="arb-odd">${dkOdds}</span>
            <span class="arb-bet">Bet $${result.betDk}</span>
          </div>
          <span class="arb-divider">↔</span>
          <div class="arb-site arb-site-fd">
            <span class="arb-site-name">FanDuel</span>
            <span class="arb-odd">${fdOdds}</span>
            ${capNote}
          </div>
        </div>
        <div class="arb-result">
          <span class="arb-profit-label">Guaranteed Profit</span>
          <span class="arb-profit-value">+$${result.profit}</span>
          <span class="arb-profit-pct">${stakeNote}</span>
        </div>
        ${stakeHTML(s)}
        <button class="arb-close-btn" id="arb-close">✕</button>
      </div>`;
    }
    attachListeners();
  }

  function stakeHTML(stake) {
    return `<div class="arb-controls">
      <span class="arb-stake-label">Total $</span>
      <input id="arb-stake-input" class="arb-stake-input" type="number" min="1" value="${stake}" />
    </div>`;
  }

  function attachListeners() {
    const closeBtn = document.getElementById("arb-close");
    if (closeBtn) {
      closeBtn.onclick = () => {
        const b = document.getElementById("arb-banner");
        if (b) b.remove();
        document.body.style.marginTop = "";
      };
    }
    const input = document.getElementById("arb-stake-input");
    if (input) {
      input.addEventListener("change", () => {
        const newStake = parseFloat(input.value) || 100;
        chrome.storage.local.set({ arbStake: newStake });
        chrome.runtime.sendMessage({ type: "GET_ODDS" }, (data) => {
          if (data) renderBanner(data.draftkings, data.fanduel, newStake, data.fdMaxWager);
        });
      });
    }
  }

  // ---- DraftKings odds scraping (betslip only) ----
  function scrapeOdds() {
    // Target the odds display inside the betslip only
    // Structure: [data-testid="betslip-odds-standard"] > span.sportsbook-odds
    const betslipOddsEl = document.querySelector(
      '[data-testid="betslip-odds-standard"] .sportsbook-odds'
    );
    if (betslipOddsEl) {
      const t = betslipOddsEl.textContent.trim().replace("−", "-").replace("–", "-");
      if (/^[+-]?\d+$/.test(t)) return t;
    }

    // Fallback: any .sportsbook-odds inside the betslip container
    const betslipContainer = document.querySelector(".dk-betslip-shell__container");
    if (betslipContainer) {
      const els = betslipContainer.querySelectorAll(".sportsbook-odds");
      for (const el of els) {
        const t = el.textContent.trim().replace("−", "-").replace("–", "-");
        if (/^[+-]?\d+$/.test(t)) return t;
      }
    }

    return null;
  }

  let lastFilledAmount = null;

  // Auto-fill the DK betslip wager input.
  // DK uses React controlled inputs — must use the native setter trick.
  // Selector: [data-testid="betslip-wager-box-input"]
  function fillDkInput(amount) {
    const input = document.querySelector('[data-testid="betslip-wager-box-input"]');
    if (!input) return;

    const floored = Math.floor(amount).toString();

    const nativeSetter = Object.getOwnPropertyDescriptor(
      window.HTMLInputElement.prototype, "value"
    ).set;
    nativeSetter.call(input, floored);

    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
  }

  let lastOdds = null;
  let lastPollOdds = null;

  function poll() {
    const odds = scrapeOdds();
    if (odds !== lastPollOdds) {
      lastPollOdds = odds;
      lastFilledAmount = null;
    }
    if (odds !== lastOdds) {
      lastOdds = odds;
      chrome.runtime.sendMessage({ type: "ODDS_UPDATE", source: "draftkings", odds });
    }
  }

  // Listen for odds data updates from background
  chrome.runtime.onMessage.addListener((msg) => {
    if (msg.type === "ODDS_DATA") {
      chrome.storage.local.get("arbStake", ({ arbStake }) => {
        renderBanner(msg.draftkings, msg.fanduel, arbStake || 100, msg.fdMaxWager);
      });
    }
  });

  // Init
  chrome.storage.local.get("arbStake", ({ arbStake }) => {
    chrome.runtime.sendMessage({ type: "GET_ODDS" }, (data) => {
      renderBanner(data ? data.draftkings : null, data ? data.fanduel : null, arbStake || 100, data ? data.fdMaxWager : null);
    });
  });

  // Poll for odds every 1.5 seconds
  setInterval(poll, 1500);
  // Also observe DOM mutations for SPA navigation
  const observer = new MutationObserver(() => poll());
  observer.observe(document.body, { childList: true, subtree: true });
})();
