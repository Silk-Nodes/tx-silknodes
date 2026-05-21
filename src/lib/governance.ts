// Governance types and formatting helpers. The shape mirrors what
// Coreum's Hasura `proposal` table returns, with all bigint-ish strings
// converted to JS numbers in TX units (1e6 ucore = 1 TX).

export type ProposalStatus =
  | "deposit"
  | "voting"
  | "passed"
  | "rejected"
  | "failed"
  | "unknown";

export interface ProposalTally {
  yes: number;
  no: number;
  abstain: number;
  noWithVeto: number;
  totalVoted: number;
  bondedSnapshot: number; // total bonded at proposal time, the quorum denominator
}

export interface Proposal {
  id: number;
  title: string;
  description: string;
  status: ProposalStatus;
  rawStatus: string; // original PROPOSAL_STATUS_* string for tooltip
  proposer: string | null;
  submitTime: string; // ISO
  votingStartTime: string | null;
  votingEndTime: string | null;
  tally: ProposalTally;
}

export interface GovParams {
  quorum: number; // 0..1 fraction
  threshold: number; // 0..1 fraction
  vetoThreshold: number; // 0..1 fraction
  votingPeriodSeconds: number;
}

// Map Cosmos PROPOSAL_STATUS_* enum strings to our compact status union.
export function normalizeStatus(raw: string): ProposalStatus {
  switch (raw) {
    case "PROPOSAL_STATUS_DEPOSIT_PERIOD":
      return "deposit";
    case "PROPOSAL_STATUS_VOTING_PERIOD":
      return "voting";
    case "PROPOSAL_STATUS_PASSED":
      return "passed";
    case "PROPOSAL_STATUS_REJECTED":
      return "rejected";
    case "PROPOSAL_STATUS_FAILED":
      return "failed";
    default:
      return "unknown";
  }
}

export const STATUS_LABELS: Record<ProposalStatus, string> = {
  deposit: "Deposit",
  voting: "Voting",
  passed: "Passed",
  rejected: "Rejected",
  failed: "Failed",
  unknown: "Unknown",
};

// Quorum = (yes + no + abstain + veto) / bondedSnapshot — what fraction
// of the bonded set actually voted. Abstain counts toward quorum per the
// Cosmos SDK gov module semantics.
export function calcQuorumFraction(tally: ProposalTally): number {
  if (tally.bondedSnapshot <= 0) return 0;
  return tally.totalVoted / tally.bondedSnapshot;
}

// Yes / No / Veto fractions of NON-ABSTAIN votes — this is the basis on
// which the threshold + veto_threshold checks apply.
export function calcVoteFractions(tally: ProposalTally) {
  const nonAbstain = tally.yes + tally.no + tally.noWithVeto;
  if (nonAbstain <= 0) {
    return { yesPct: 0, noPct: 0, vetoPct: 0, abstainPct: 0 };
  }
  return {
    yesPct: tally.yes / nonAbstain,
    noPct: tally.no / nonAbstain,
    vetoPct: tally.noWithVeto / nonAbstain,
    abstainPct: tally.totalVoted > 0 ? tally.abstain / tally.totalVoted : 0,
  };
}

export function formatTxAmount(tx: number): string {
  if (tx >= 1_000_000_000) return `${(tx / 1_000_000_000).toFixed(2)}B`;
  if (tx >= 1_000_000) return `${(tx / 1_000_000).toFixed(2)}M`;
  if (tx >= 1_000) return `${(tx / 1_000).toFixed(1)}K`;
  return tx.toFixed(0);
}

export function formatRelativeOrAbsolute(iso: string | null, now: number): string {
  if (!iso) return "—";
  const ts = new Date(iso).getTime();
  const diffMs = ts - now;
  const absMs = Math.abs(diffMs);
  const future = diffMs > 0;

  const day = 24 * 60 * 60 * 1000;
  if (absMs < day) {
    const hours = Math.round(absMs / (60 * 60 * 1000));
    return future ? `in ${hours}h` : `${hours}h ago`;
  }
  if (absMs < 7 * day) {
    const days = Math.round(absMs / day);
    return future ? `in ${days}d` : `${days}d ago`;
  }
  // Fall back to absolute date for old proposals.
  return new Date(iso).toISOString().slice(0, 10);
}
