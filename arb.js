// Shared arbitrage calculation logic

function americanToDecimal(american) {
  const n = parseFloat(american);
  if (isNaN(n)) return null;
  if (n > 0) return (n / 100) + 1;
  return (100 / Math.abs(n)) + 1;
}

function calcArb(odds1, odds2) {
  const d1 = americanToDecimal(odds1);
  const d2 = americanToDecimal(odds2);
  if (!d1 || !d2) return null;

  const impliedProb1 = 1 / d1;
  const impliedProb2 = 1 / d2;
  const totalImplied = impliedProb1 + impliedProb2;

  if (totalImplied >= 1) return null; // No arb

  const profitMargin = ((1 / totalImplied) - 1) * 100;

  return {
    d1,
    d2,
    impliedProb1,
    impliedProb2,
    totalImplied,
    profitMargin
  };
}

function calcBets(odds1, odds2, totalStake) {
  const result = calcArb(odds1, odds2);
  if (!result) return null;

  const { d1, d2, impliedProb1, impliedProb2, totalImplied, profitMargin } = result;

  const bet1 = (totalStake * impliedProb1) / totalImplied;
  const bet2 = (totalStake * impliedProb2) / totalImplied;
  const payout1 = bet1 * d1;
  const payout2 = bet2 * d2;
  const profit = Math.min(payout1, payout2) - totalStake;

  return {
    bet1: bet1.toFixed(2),
    bet2: bet2.toFixed(2),
    profit: profit.toFixed(2),
    profitMargin: profitMargin.toFixed(2),
    payout1: payout1.toFixed(2),
    payout2: payout2.toFixed(2)
  };
}
