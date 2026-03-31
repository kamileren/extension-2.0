// FanDuel content script

(function () {
  // ---- arb calculation ----
  function americanToDecimal(american) {
    const n = parseFloat(String(american).replace("−", "-").replace("–", "-"));
    if (isNaN(n)) return null;
    if (n > 0) return n / 100 + 1;
    return 100 / Math.abs(n) + 1;
  }

  // Calculate bets respecting an optional FanDuel max wager cap.
  // If the uncapped FD bet exceeds fdMax, we cap FD at fdMax and
  // derive the required DK bet to guarantee profit on the FD return.
  function calcBets(dkOdds, fdOdds, totalStake, fdMax) {
    const dkDec = americanToDecimal(dkOdds);
    const fdDec = americanToDecimal(fdOdds);
    if (!dkDec || !fdDec) return null;

    const ipDk = 1 / dkDec;
    const ipFd = 1 / fdDec;
    const total = ipDk + ipFd;
    if (total >= 1) return null;

    const margin = ((1 / total) - 1) * 100;

    // Uncapped bets
    let betFd = (totalStake * ipFd) / total;
    let betDk = (totalStake * ipDk) / total;

    let capped = false;
    let effectiveStake = totalStake;

    if (fdMax != null && betFd > fdMax) {
      // Cap FD bet at max wager.
      // To still guarantee profit: DK bet must cover the FD payout.
      // FD payout = fdMax * fdDec
      // DK bet = FD payout / dkDec  (so DK payout = FD payout too)
      betFd = fdMax;
      betDk = (betFd * fdDec) / dkDec;
      effectiveStake = betFd + betDk;
      capped = true;
    }

    const payoutFd = betFd * fdDec;
    const payoutDk = betDk * dkDec;
    const profit = Math.min(payoutFd, payoutDk) - effectiveStake;

    return {
      betDk: betDk.toFixed(2),
      betFd: betFd.toFixed(2),
      profit: profit.toFixed(2),
      profitMargin: margin.toFixed(2),
      effectiveStake: effectiveStake.toFixed(2),
      capped
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
      .arb-site-fd .arb-site-name { color: #4fc3f7; }
      .arb-odd { font-size: 20px; font-weight: 700; color: #fff; }
      .arb-bet { font-size: 11px; color: #00e676; font-weight: 600; }
      .arb-bet-capped { font-size: 10px; color: #ff9800; font-weight: 600; }
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
      .arb-reset-max-btn {
        background: #3a1a00; border: 1px solid #ff9800; color: #ff9800;
        cursor: pointer; font-size: 10px; font-weight: 700; padding: 3px 7px;
        border-radius: 4px; letter-spacing: 0.5px; white-space: nowrap;
      }
      .arb-reset-max-btn:hover { background: #ff9800; color: #000; }
    `;
    document.head.appendChild(style);
  }

  let lastFilledAmount = null;
  let fdBetPhase = "idle"; // "idle" | "waiting"

  function renderBanner(dkOdds, fdOdds, stake, fdMaxWager) {
    injectStyles();
    let banner = document.getElementById("arb-banner");
    if (!banner) {
      banner = document.createElement("div");
      banner.id = "arb-banner";
      document.body.insertBefore(banner, document.body.firstChild);
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
        ${fdMax != null && fdMax < 100000 ? `<button class="arb-reset-max-btn" id="arb-reset-max">RESET MAX $${fdMax}</button>` : ""}
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
        ${fdMax != null && fdMax < 100000 ? `<button class="arb-reset-max-btn" id="arb-reset-max">RESET MAX $${fdMax}</button>` : ""}
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

      // Auto-fill the FD wager input (floored, no cents).
      // Only re-fill when the amount actually changes to avoid cursor fighting.
      const fdBetFloored = Math.floor(parseFloat(result.betFd));
      if (fdBetFloored !== lastFilledAmount) {
        lastFilledAmount = fdBetFloored;
        // Small delay so FD's DOM is settled after any re-render
        setTimeout(() => fillFdInput(fdBetFloored), 120);
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
        ${fdBetPhase === "idle"
          ? `<button class="arb-bet-btn" id="arb-place-bet">Place Bet</button>`
          : `<span class="arb-bet-waiting">Waiting for DraftKings...</span>
             <button class="arb-bet-cancel-btn" id="arb-cancel-bet">Cancel</button>`
        }
        ${fdMax != null && fdMax < 100000 ? `<button class="arb-reset-max-btn" id="arb-reset-max">RESET MAX $${fdMax}</button>` : ""}
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

    const resetBtn = document.getElementById("arb-reset-max");
    if (resetBtn) {
      resetBtn.onclick = () => {
        // Set sticky max to a huge number so cap never triggers
        stickyMax = 100000;
        lastMax = 100000;
        lastFilledAmount = null;
        chrome.runtime.sendMessage({
          type: "ODDS_UPDATE",
          source: "fanduel",
          odds: lastOdds,
          fdMaxWager: 100000
        });
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

    const placeBetBtn = document.getElementById("arb-place-bet");
    if (placeBetBtn) {
      placeBetBtn.onclick = () => {
        fdBetPhase = "waiting";
        chrome.runtime.sendMessage({ type: "BET_INTENT", source: "fanduel" });
        chrome.storage.local.get("arbStake", ({ arbStake }) => {
          chrome.runtime.sendMessage({ type: "GET_ODDS" }, (data) => {
            if (data) renderBanner(data.draftkings, data.fanduel, arbStake || 100, data.fdMaxWager);
          });
        });
      };
    }

    const cancelBetBtn = document.getElementById("arb-cancel-bet");
    if (cancelBetBtn) {
      cancelBetBtn.onclick = () => {
        fdBetPhase = "idle";
        chrome.runtime.sendMessage({ type: "BET_CANCEL", source: "fanduel" });
        chrome.storage.local.get("arbStake", ({ arbStake }) => {
          chrome.runtime.sendMessage({ type: "GET_ODDS" }, (data) => {
            if (data) renderBanner(data.draftkings, data.fanduel, arbStake || 100, data.fdMaxWager);
          });
        });
      };
    }
  }

  // ---- FanDuel betslip scraping ----
  function scrapeOdds() {
    const els = Array.from(document.querySelectorAll('[aria-label^="Odds "]'));
    if (els.length === 0) return null;
    // Take the last element — betslip items render after page content
    for (let i = els.length - 1; i >= 0; i--) {
      const label = els[i].getAttribute("aria-label") || "";
      const match = label.match(/Odds\s+([+-]?\d+)/);
      if (match) {
        const val = match[1].replace("−", "-").replace("–", "-");
        if (/^[+-]?\d+$/.test(val)) return val;
      }
    }
    return null;
  }

  // Scrape FanDuel max wager from betslip.
  // HTML: <span ...>max wager $382.50</span>
  function scrapeMaxWager() {
    const spans = document.querySelectorAll("span");
    for (const span of spans) {
      const t = span.textContent.trim().toLowerCase();
      const match = t.match(/^max wager \$([0-9,]+\.?\d*)$/);
      if (match) {
        return parseFloat(match[1].replace(",", ""));
      }
    }
    return null;
  }

  let lastOdds = null;
  let lastMax = null;
  let lastPollOdds = null; // track odds changes to reset fill guard
  // Sticky max: once we've seen a max wager value, keep it even after it
  // disappears from the DOM (FD removes the warning once you're at/below it).
  let stickyMax = null;

  function poll() {
    const odds = scrapeOdds();
    const scrapedMax = scrapeMaxWager();

    // Update sticky max only when FD shows a new value
    if (scrapedMax != null) {
      stickyMax = scrapedMax;
    }

    const effectiveMax = stickyMax;

    // If odds changed, reset the fill guard so the new bet amount gets written
    if (odds !== lastPollOdds) {
      lastPollOdds = odds;
      lastFilledAmount = null;
    }

    if (odds !== lastOdds && fdBetPhase === "waiting") fdBetPhase = "idle";

    if (odds !== lastOdds || effectiveMax !== lastMax) {
      lastOdds = odds;
      lastMax = effectiveMax;
      chrome.runtime.sendMessage({
        type: "ODDS_UPDATE",
        source: "fanduel",
        odds,
        fdMaxWager: effectiveMax
      });
    }
  }

  function clickFdButton() {
    const buttons = Array.from(document.querySelectorAll('[role="button"]'));
    const btn = buttons.find(b =>
      Array.from(b.querySelectorAll("span")).some(s => /^Place .+ bet$/i.test(s.textContent.trim()))
    );
    if (btn) btn.click();
  }

  // Find the FanDuel betslip wager input and set its value, then fire
  // the React synthetic events so FD's state picks up the change.
  // Auto-fill the FanDuel betslip wager input.
  // FD's input has no stable id/name/placeholder — obfuscated classes throughout.
  // Most reliable anchor: the <span> with exact text "wager" is always a sibling,
  // so we find that span and walk up to grab the input in the same container.
  // Fallback: any input[type="text"][autocorrect="off"] that isn't a search box.
  function fillFdInput(amount) {
    let wagerInput = null;

    // Primary: find the "wager" label span, go up to its container, find the input
    const spans = Array.from(document.querySelectorAll("span"));
    const wagerLabel = spans.find(s => s.textContent.trim().toLowerCase() === "wager");
    if (wagerLabel) {
      // Walk up a few levels to find a common ancestor, then find the input inside it
      let node = wagerLabel.parentElement;
      for (let i = 0; i < 4; i++) {
        if (!node) break;
        const inp = node.querySelector('input[type="text"]');
        if (inp) { wagerInput = inp; break; }
        node = node.parentElement;
      }
    }

    // Fallback: input[type="text"][autocorrect="off"] that has style="outline: none"
    if (!wagerInput) {
      const candidates = Array.from(document.querySelectorAll('input[type="text"][autocorrect="off"]'));
      wagerInput = candidates.find(el => (el.getAttribute("style") || "").includes("outline: none"));
    }

    if (!wagerInput) return;

    const floored = Math.floor(amount).toString();

    // Use React's internal setter to bypass controlled-input protection
    const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
      window.HTMLInputElement.prototype, "value"
    ).set;
    nativeInputValueSetter.call(wagerInput, floored);

    wagerInput.dispatchEvent(new Event("input", { bubbles: true }));
    wagerInput.dispatchEvent(new Event("change", { bubbles: true }));
  }

  chrome.runtime.onMessage.addListener((msg) => {
    if (msg.type === "ODDS_DATA") {
      chrome.storage.local.get("arbStake", ({ arbStake }) => {
        renderBanner(msg.draftkings, msg.fanduel, arbStake || 100, msg.fdMaxWager);
      });
    }

    if (msg.type === "BET_FIRE") {
      fdBetPhase = "idle";
      clickFdButton();
    }

    if (msg.type === "BET_CANCEL") {
      fdBetPhase = "idle";
      chrome.storage.local.get("arbStake", ({ arbStake }) => {
        chrome.runtime.sendMessage({ type: "GET_ODDS" }, (data) => {
          if (data) renderBanner(data.draftkings, data.fanduel, arbStake || 100, data.fdMaxWager);
        });
      });
    }
  });

  chrome.storage.local.get("arbStake", ({ arbStake }) => {
    chrome.runtime.sendMessage({ type: "GET_ODDS" }, (data) => {
      renderBanner(
        data ? data.draftkings : null,
        data ? data.fanduel : null,
        arbStake || 100,
        data ? data.fdMaxWager : null
      );
    });
  });

  setInterval(poll, 1500);
  const observer = new MutationObserver(() => poll());
  observer.observe(document.body, { childList: true, subtree: true });
})();
