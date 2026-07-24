"use client";

// /passport/core1... opens the Wallet Passport already pointed at that
// address. Lets anything that lists a wallet (validator delegator tables,
// flow counterparties) deep-link straight into its full on-chain profile.

import HomePage from "../../page";

export default function PassportRoutePage() {
  return <HomePage />;
}
