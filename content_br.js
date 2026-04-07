// BetRivers content script

(function () {
  // ---- arb calculation ----
  function americanToDecimal(american) {
    const n = parseFloat(String(american).replace("−", "-").replace("–", "-"));
    if (isNaN(n)) return null;
    if (n > 0) return n / 100 + 1;
    return 100 / Math.abs(n) + 1;
  }

  function calcBets(dkOdds, brOdds, totalStake) {
    const dkDec = americanToDecimal(dkOdds);
    const brDec = americanToDecimal(brOdds);
    if (!dkDec || !brDec) return null;
    const ipDk = 1 / dkDec, ipBr = 1 / brDec, total = ipDk + ipBr;
    if (total >= 1) return null;
    const margin = ((1 / total) - 1) * 100;
    const betBr = (totalStake * ipBr) / total;
    const betDk = (totalStake * ipDk) / total;
    const profit = Math.min(betDk * dkDec, betBr * brDec) - totalStake;
    return {
      betDk: betDk.toFixed(2), betBr: betBr.toFixed(2),
      profit: profit.toFixed(2), profitMargin: margin.toFixed(2)
    };
  }

  // ---- banner styles ----
  function injectStyles() {
    if (document.getElementById("arb-banner-styles")) return;
    const style = document.createElement("style");
    style.id = "arb-banner-styles";
    style.textContent = `
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
      .arb-site-br .arb-site-name { color: #00b4d8; }
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
      .arb-bet-btn {
        background: #00c853; border: none; color: #000; cursor: pointer;
        font-size: 12px; font-weight: 800; padding: 6px 14px; border-radius: 5px;
        letter-spacing: 0.5px; white-space: nowrap;
      }
      .arb-bet-btn:hover { background: #00e676; }
      .arb-bet-waiting {
        font-size: 11px; color: #f9a825; font-weight: 700; white-space: nowrap;
        animation: arb-pulse 1s ease-in-out infinite alternate;
      }
      .arb-bet-cancel-btn {
        background: none; border: 1px solid #ff5252; color: #ff5252; cursor: pointer;
        font-size: 11px; font-weight: 700; padding: 4px 10px; border-radius: 4px;
      }
      .arb-bet-cancel-btn:hover { background: #ff5252; color: #000; }
      @keyframes arb-pulse { from { opacity: 1; } to { opacity: 0.4; } }
      .arb-middle-warning {
        width: 100%; background: #ff6f00; color: #000; font-weight: 800;
        font-size: 12px; text-align: center; padding: 4px 16px; letter-spacing: 0.5px;
      }
    `;
    document.head.appendChild(style);
  }

  function detectMiddle(dkLine, brLine) {
    if (!dkLine || !brLine) return null;
    if (!dkLine.direction || !brLine.direction) return null;
    if (dkLine.direction === brLine.direction) return null;
    const overLine  = dkLine.direction === "Over"  ? dkLine.line  : brLine.line;
    const underLine = dkLine.direction === "Under" ? dkLine.line  : brLine.line;
    if (overLine < underLine) {
      return `MIDDLE RISK: Over ${overLine} / Under ${underLine} — score ${overLine}–${underLine - 0.5} wins both bets`;
    }
    return null;
  }

  let lastFilledAmount = null;
  let brBetPhase = "idle"; // "idle" | "waiting"
  let lockedBet = null;

  function renderBanner(dkOdds, brOdds, stake, dkLine, brLine) {
    injectStyles();
    let banner = document.getElementById("arb-banner");
    if (!banner) {
      banner = document.createElement("div");
      banner.id = "arb-banner";
      document.body.insertBefore(banner, document.body.firstChild);
      document.body.style.marginTop = "58px";
    }

    const s = parseFloat(stake) || 100;
    const middleWarning = detectMiddle(dkLine, brLine);
    const middleHTML = middleWarning ? `<div class="arb-middle-warning">⚠ ${middleWarning}</div>` : "";

    if (!dkOdds || !brOdds) {
      banner.className = "";
      banner.innerHTML = `<div id="arb-banner-inner">
        <span class="arb-logo">ARB CALC</span>
        <span class="arb-status">
          ${dkOdds ? `DK: <b>${dkOdds}</b>` : "Waiting for <b>DraftKings</b> odds..."}
          &nbsp;|&nbsp;
          ${brOdds ? `BR: <b>${brOdds}</b>` : "Waiting for <b>BetRivers</b> odds..."}
        </span>
        ${stakeHTML(s)}
        <button class="arb-close-btn" id="arb-close">✕</button>
      </div>`;
      attachListeners();
      return;
    }

    const result = calcBets(dkOdds, brOdds, s);

    if (!result) {
      banner.className = "no-arb";
      banner.innerHTML = `${middleHTML}<div id="arb-banner-inner">
        <span class="arb-logo">ARB CALC</span>
        <div class="arb-odds-group">
          <div class="arb-site arb-site-dk">
            <span class="arb-site-name">DraftKings</span>
            <span class="arb-odd">${dkOdds}</span>
          </div>
          <span class="arb-divider">vs</span>
          <div class="arb-site arb-site-br">
            <span class="arb-site-name">BetRivers</span>
            <span class="arb-odd">${brOdds}</span>
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
      // Auto-fill the BR wager input
      const brBetFloored = Math.floor(parseFloat(result.betBr));
      if (brBetFloored !== lastFilledAmount) {
        lastFilledAmount = brBetFloored;
        setTimeout(() => fillBrInput(brBetFloored), 120);
      }

      banner.className = "";
      banner.innerHTML = `${middleHTML}<div id="arb-banner-inner">
        <span class="arb-logo">ARB ✓</span>
        <div class="arb-odds-group">
          <div class="arb-site arb-site-dk">
            <span class="arb-site-name">DraftKings</span>
            <span class="arb-odd">${dkOdds}</span>
            <span class="arb-bet">Bet $${result.betDk}</span>
          </div>
          <span class="arb-divider">↔</span>
          <div class="arb-site arb-site-br">
            <span class="arb-site-name">BetRivers</span>
            <span class="arb-odd">${brOdds}</span>
            <span class="arb-bet">Bet $${result.betBr}</span>
          </div>
        </div>
        <div class="arb-result">
          <span class="arb-profit-label">Guaranteed Profit</span>
          <span class="arb-profit-value">+$${result.profit}</span>
          <span class="arb-profit-pct">${result.profitMargin}% ROI on $${s}</span>
        </div>
        ${brBetPhase === "idle"
          ? `<button class="arb-bet-btn" id="arb-place-bet">Place Bet</button>`
          : `<span class="arb-bet-waiting">Waiting for DraftKings...</span>
             <button class="arb-bet-cancel-btn" id="arb-cancel-bet">Cancel</button>`
        }
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
          if (data) renderBanner(data.draftkings, data.betrivers, newStake, data.dkLine || null, data.brLine || null);
        });
      });
    }

    const placeBetBtn = document.getElementById("arb-place-bet");
    if (placeBetBtn) {
      placeBetBtn.onclick = () => {
        brBetPhase = "waiting";
        chrome.runtime.sendMessage({ type: "BET_INTENT", source: "betrivers" }, () => void chrome.runtime.lastError);
        chrome.storage.local.get("arbStake", ({ arbStake }) => {
          chrome.runtime.sendMessage({ type: "GET_ODDS" }, (data) => {
            if (data) renderBanner(data.draftkings, data.betrivers, arbStake || 100, data.dkLine || null, data.brLine || null);
          });
        });
      };
    }

    const cancelBetBtn = document.getElementById("arb-cancel-bet");
    if (cancelBetBtn) {
      cancelBetBtn.onclick = () => {
        brBetPhase = "idle";
        chrome.runtime.sendMessage({ type: "BET_CANCEL", source: "betrivers" }, () => void chrome.runtime.lastError);
        chrome.storage.local.get("arbStake", ({ arbStake }) => {
          chrome.runtime.sendMessage({ type: "GET_ODDS" }, (data) => {
            if (data) renderBanner(data.draftkings, data.betrivers, arbStake || 100, data.dkLine || null, data.brLine || null);
          });
        });
      };
    }
  }

  // ---- BetRivers odds + line scraping ----
  function scrapeOdds() {
    const betslip = document.querySelector(".mod-KambiBC-betslip-container") ||
                    document.querySelector("[class*='betslip']");
    if (betslip) {
      const el = betslip.querySelector(".mod-KambiBC-betslip-outcome__odds");
      if (el) {
        const t = el.textContent.trim().replace("−", "-").replace("–", "-");
        if (/^[+-]?\d+$/.test(t)) return t;
      }
    }

    // Fallback: any visible betslip odds element on the page
    const els = document.querySelectorAll(".mod-KambiBC-betslip-outcome__odds");
    for (const el of els) {
      const t = el.textContent.trim().replace("−", "-").replace("–", "-");
      if (/^[+-]?\d+$/.test(t)) return t;
    }
    return null;
  }

  // Scrape Over/Under line from BetRivers betslip.
  // Selector: span.mod-KambiBC-betslip-outcome__outcome-label
  // Text examples: "Over 131.5", "Under 48.5"
  function scrapeLineInfo() {
    const els = document.querySelectorAll(".mod-KambiBC-betslip-outcome__outcome-label");
    for (const el of els) {
      const t = el.textContent.trim();
      const match = t.match(/^(Over|Under)\s+([\d.]+)$/i);
      if (match) {
        return {
          direction: match[1].charAt(0).toUpperCase() + match[1].slice(1).toLowerCase(),
          line: parseFloat(match[2])
        };
      }
    }
    return null;
  }

  // Fill the BetRivers wager input.
  // Selector: input.mod-KambiBC-stake-input (aria-label="Wager")
  function fillBrInput(amount) {
    const input = document.querySelector(
      'input.mod-KambiBC-stake-input, input.mod-KambiBC-js-stake-input, input[aria-label="Wager"]'
    );
    if (!input) return;

    const floored = Math.floor(amount).toString();

    const nativeSetter = Object.getOwnPropertyDescriptor(
      window.HTMLInputElement.prototype, "value"
    ).set;
    nativeSetter.call(input, floored);

    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
  }

  function clickBrButton() {
    // If BetRivers is showing an odds change approval, click that first then
    // wait for it to resolve back to the normal "Place bet" button.
    const approveBtn = document.querySelector('button[aria-label="Approve odds change"]');
    if (approveBtn && !approveBtn.disabled) {
      approveBtn.click();
      // Poll until the approve button is gone and the place bet button appears
      const started = Date.now();
      const poll = setInterval(() => {
        if (Date.now() - started > 4000) { clearInterval(poll); return; }
        const stillApproving = document.querySelector('button[aria-label="Approve odds change"]');
        if (stillApproving) return; // still waiting
        clearInterval(poll);
        const placeBtn = document.querySelector('button[aria-label="Place bet"]');
        if (placeBtn && !placeBtn.disabled) placeBtn.click();
      }, 100);
      return;
    }

    const btn = document.querySelector('button[aria-label="Place bet"]');
    if (!btn || btn.disabled) return;
    btn.click();
  }

  // ---- Bet confirmation scraping ----
  function scrapeBrBetConfirmation() {
    // BetRivers shows a receipt — look for confirmation text in betslip area
    const receiptEl = document.querySelector(
      "[class*='bet-receipt'], [class*='betReceipt'], [class*='confirmation']"
    );
    if (!receiptEl) return null;
    const text = receiptEl.textContent || "";
    if (!/bet placed|receipt|confirmed/i.test(text)) return null;

    const wagerEl = document.querySelector('input[aria-label="Wager"]');
    const oddsEl = document.querySelector(".mod-KambiBC-betslip-outcome__odds");

    return {
      site: "betrivers", status: "placed",
      wager: wagerEl ? wagerEl.value : null,
      odds: oddsEl ? oddsEl.textContent.trim() : null,
      timestamp: new Date().toISOString()
    };
  }

  let brConfirmationObserver = null;

  function watchForBrConfirmation() {
    if (brConfirmationObserver) return;
    brConfirmationObserver = new MutationObserver(() => {
      const result = scrapeBrBetConfirmation();
      if (!result) return;
      brConfirmationObserver.disconnect();
      brConfirmationObserver = null;
      console.log("[ARB] BetRivers bet confirmed:", result);
      chrome.runtime.sendMessage({ type: "BET_CONFIRMED", ...result }, () => void chrome.runtime.lastError);
    });
    brConfirmationObserver.observe(document.body, { childList: true, subtree: true });
  }

  let lastOdds = null;
  let lastPollOdds = null;
  let lastLineInfo = null;

  function poll() {
    const odds = scrapeOdds();
    const lineInfo = scrapeLineInfo();
    const lineKey = lineInfo ? `${lineInfo.direction}${lineInfo.line}` : null;
    const lastLineKey = lastLineInfo ? `${lastLineInfo.direction}${lastLineInfo.line}` : null;

    if (odds !== lastPollOdds) {
      lastPollOdds = odds;
      lastFilledAmount = null;
    }
    if (odds !== lastOdds || lineKey !== lastLineKey) {
      lastOdds = odds;
      lastLineInfo = lineInfo;
      if (brBetPhase === "waiting") brBetPhase = "idle";
      chrome.runtime.sendMessage({ type: "ODDS_UPDATE", source: "betrivers", odds, lineInfo });
    }
  }

  chrome.runtime.onMessage.addListener((msg) => {
    if (msg.type === "ODDS_DATA") {
      chrome.storage.local.get("arbStake", ({ arbStake }) => {
        renderBanner(msg.draftkings, msg.betrivers, arbStake || 100, msg.dkLine || null, msg.brLine || null);
      });
    }

    if (msg.type === "BET_FIRE") {
      brBetPhase = "idle";
      chrome.runtime.sendMessage({ type: "GET_ODDS" }, (data) => {
        if (data && data.draftkings && data.betrivers) {
          chrome.storage.local.get("arbStake", ({ arbStake }) => {
            const stake = arbStake || 100;
            const result = calcBets(data.draftkings, data.betrivers, stake);
            if (result) {
              lockedBet = {
                dkOdds: data.draftkings,
                brOdds: data.betrivers,
                betDk: parseFloat(result.betDk),
                betBr: parseFloat(result.betBr),
                stake
              };
            }
          });
        }
      });
      watchForBrConfirmation();
      clickBrButton();
    }

    if (msg.type === "BET_CANCEL") {
      brBetPhase = "idle";
      lockedBet = null;
      chrome.storage.local.get("arbStake", ({ arbStake }) => {
        chrome.runtime.sendMessage({ type: "GET_ODDS" }, (data) => {
          if (data) renderBanner(data.draftkings, data.betrivers, arbStake || 100, data.dkLine || null, data.brLine || null);
        });
      });
    }
  });

  // Init
  chrome.storage.local.get("arbStake", ({ arbStake }) => {
    chrome.runtime.sendMessage({ type: "GET_ODDS" }, (data) => {
      renderBanner(
        data ? data.draftkings : null,
        data ? data.betrivers : null,
        arbStake || 100,
        data ? data.dkLine || null : null,
        data ? data.brLine || null : null
      );
    });
  });

  setInterval(poll, 1500);
  const observer = new MutationObserver(() => poll());
  observer.observe(document.body, { childList: true, subtree: true });
})();
