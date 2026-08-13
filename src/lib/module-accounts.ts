// Identifying protocol-owned accounts, so a large balance is not mistaken
// for a whale.
//
// This exists because of a real misreading in public. A wallet-analysis tool
// flagged core1qpf6j4r8jxr6z20s6m6x0hpcx066892u578u83 red: "1,880,952,380.95
// TX with no protocol-level lock of any kind... every token here can be moved
// or sold at any moment", and someone reasonably asked whose wallet it was.
//
// It is not a wallet. It is the pse_team ModuleAccount. A ModuleAccount has
// pub_key: null, so no signature can ever be produced for it; only protocol
// logic moves the funds, on the PSE release schedule. Our own passport had no
// notion of module accounts either and would have rendered it exactly the
// same way.
//
// The balance is also not arbitrary, which is the part that settles the
// question: team is 2% of the 100B PSE released over 84 months, so 2,000,000,000
// total, and the account holds precisely that minus what has been released.

import { PSE_ALLOCATION } from "./pse-calculator";

/** Total PSE emission and its schedule, the basis for every clearing account. */
export const PSE_TOTAL_TX = 100_000_000_000;
export const PSE_MONTHS = 84;

type AllocationKey = keyof typeof PSE_ALLOCATION;

interface ModuleInfo {
  /** Human label for the account. */
  label: string;
  /** One line on what it is for. */
  purpose: string;
  /** PSE stream, when this account is one of the six clearing accounts. */
  allocation?: AllocationKey;
}

/**
 * Module accounts we can name. The six PSE clearing accounts come from the
 * chain's own clearing_account_mappings; the Cosmos SDK ones are standard.
 */
export const MODULE_ACCOUNTS: Record<string, ModuleInfo> = {
  pse_community: {
    label: "PSE community pool",
    purpose: "Pays the monthly PSE distribution to everyone staking TX.",
    allocation: "community",
  },
  pse_foundation: {
    label: "PSE foundation allocation",
    purpose: "Treasury and operations.",
    allocation: "foundation",
  },
  pse_alliance: {
    label: "PSE founding partners allocation",
    purpose: "Founding partners.",
    allocation: "foundingPartners",
  },
  pse_investors: {
    label: "PSE investors allocation",
    purpose: "Early investors.",
    allocation: "vcsInvestors",
  },
  pse_partnership: {
    label: "PSE partnerships allocation",
    purpose: "Partnerships and growth.",
    allocation: "partnershipsGrowth",
  },
  pse_team: {
    label: "PSE team allocation",
    purpose: "Team.",
    allocation: "team",
  },
  bonded_tokens_pool: {
    label: "Bonded tokens pool",
    purpose: "Holds every delegated TX on the chain. Not anyone's balance.",
  },
  not_bonded_tokens_pool: {
    label: "Unbonding tokens pool",
    purpose: "Holds TX that is currently unbonding.",
  },
  distribution: {
    label: "Distribution pool",
    purpose: "Staking rewards waiting to be claimed.",
  },
  fee_collector: {
    label: "Fee collector",
    purpose: "Transaction fees before they are distributed.",
  },
  gov: { label: "Governance deposits", purpose: "Deposits on open proposals." },
  mint: { label: "Mint module", purpose: "Issues new TX per the inflation schedule." },
};

export interface ModuleAccountFacts {
  name: string;
  label: string;
  purpose: string;
  /** True for every ModuleAccount: there is no key, so it cannot sign. */
  cannotSign: true;
  /** Present only for the six PSE clearing accounts. */
  schedule?: {
    sharePct: number;
    totalTX: number;
    perMonthTX: number;
    releasedTX: number;
    monthsReleased: number;
    monthsTotal: number;
  };
}

/**
 * Facts about a module account, given its name and current balance.
 *
 * monthsReleased is derived from the live balance rather than a hardcoded
 * cycle count, so it cannot go stale: released = total - balance, and the
 * schedule pays total/84 each month.
 */
export function describeModuleAccount(name: string, balanceTX: number): ModuleAccountFacts | null {
  const info = MODULE_ACCOUNTS[name];
  if (!info) {
    // An unrecognised module account is still worth flagging: the "cannot
    // sign" point holds for every one of them, and that is the part a reader
    // needs before treating the balance as someone's holdings.
    return { name, label: name, purpose: "A protocol-owned account.", cannotSign: true };
  }
  if (!info.allocation) {
    return { name, label: info.label, purpose: info.purpose, cannotSign: true };
  }
  const sharePct = PSE_ALLOCATION[info.allocation] * 100;
  const totalTX = PSE_TOTAL_TX * PSE_ALLOCATION[info.allocation];
  const perMonthTX = totalTX / PSE_MONTHS;
  const releasedTX = Math.max(0, totalTX - balanceTX);
  return {
    name,
    label: info.label,
    purpose: info.purpose,
    cannotSign: true,
    schedule: {
      sharePct,
      totalTX,
      perMonthTX,
      releasedTX,
      monthsReleased: perMonthTX > 0 ? Math.round(releasedTX / perMonthTX) : 0,
      monthsTotal: PSE_MONTHS,
    },
  };
}
