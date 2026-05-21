"use client";

import { useMemo, useState } from "react";
import type { ValidatorVote, VoteOption } from "@/hooks/useProposalDetail";
import { formatTxAmount } from "@/lib/governance";

interface Props {
  validators: ValidatorVote[];
  totalBonded: number;
  highlightAddresses?: string[]; // operator addrs of user's delegated validators
}

type Filter = "all" | VoteOption;
type SortKey = "rank" | "moniker" | "stake" | "vote" | "votedAt";

const FILTERS: { id: Filter; label: string; tone: string }[] = [
  { id: "all", label: "All", tone: "neutral" },
  { id: "YES", label: "Yes", tone: "yes" },
  { id: "NO", label: "No", tone: "no" },
  { id: "NO_WITH_VETO", label: "Veto", tone: "veto" },
  { id: "ABSTAIN", label: "Abstain", tone: "abstain" },
  { id: "DID_NOT_VOTE", label: "Did Not Vote", tone: "muted" },
];

const VOTE_LABEL: Record<VoteOption, string> = {
  YES: "Yes",
  NO: "No",
  ABSTAIN: "Abstain",
  NO_WITH_VETO: "Veto",
  DID_NOT_VOTE: "Did not vote",
};

export default function ValidatorVoteTable({
  validators,
  totalBonded,
  highlightAddresses = [],
}: Props) {
  const [filter, setFilter] = useState<Filter>("all");
  const [search, setSearch] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("stake");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");

  const highlightSet = useMemo(
    () => new Set(highlightAddresses.map((a) => a.toLowerCase())),
    [highlightAddresses],
  );

  const counts = useMemo(() => {
    const c = { all: validators.length, YES: 0, NO: 0, NO_WITH_VETO: 0, ABSTAIN: 0, DID_NOT_VOTE: 0 };
    for (const v of validators) c[v.voteOption]++;
    return c;
  }, [validators]);

  const rows = useMemo(() => {
    let r = validators;
    if (filter !== "all") r = r.filter((v) => v.voteOption === filter);
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      r = r.filter(
        (v) =>
          v.moniker.toLowerCase().includes(q) ||
          v.operatorAddress.toLowerCase().includes(q),
      );
    }
    const ranked = [...r];
    ranked.sort((a, b) => {
      const dir = sortDir === "asc" ? 1 : -1;
      switch (sortKey) {
        case "moniker": return dir * a.moniker.localeCompare(b.moniker);
        case "stake": return dir * (a.bondedStakeTX - b.bondedStakeTX);
        case "vote": return dir * a.voteOption.localeCompare(b.voteOption);
        case "votedAt": {
          const at = a.votedAt ? new Date(a.votedAt).getTime() : 0;
          const bt = b.votedAt ? new Date(b.votedAt).getTime() : 0;
          return dir * (at - bt);
        }
        default: return dir * (b.bondedStakeTX - a.bondedStakeTX);
      }
    });
    return ranked;
  }, [validators, filter, search, sortKey, sortDir]);

  const toggleSort = (key: SortKey) => {
    if (key === sortKey) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else { setSortKey(key); setSortDir(key === "moniker" ? "asc" : "desc"); }
  };

  return (
    <div className="vvt">
      <div className="vvt-controls">
        <div className="vvt-filters">
          {FILTERS.map((f) => (
            <button
              key={f.id}
              type="button"
              className={`vvt-chip vvt-chip-${f.tone} ${filter === f.id ? "active" : ""}`}
              onClick={() => setFilter(f.id)}
            >
              {f.label} <span className="vvt-chip-count">{counts[f.id as keyof typeof counts]}</span>
            </button>
          ))}
        </div>
        <input
          type="search"
          className="vvt-search"
          placeholder="Search validator..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      <div className="vvt-table-wrap">
        <table className="vvt-table">
          <thead>
            <tr>
              <th className="vvt-th-rank">#</th>
              <th
                className={`vvt-sortable ${sortKey === "moniker" ? "active" : ""}`}
                onClick={() => toggleSort("moniker")}
              >
                Validator {sortKey === "moniker" && (sortDir === "asc" ? "▲" : "▼")}
              </th>
              <th
                className={`vvt-sortable vvt-num ${sortKey === "stake" ? "active" : ""}`}
                onClick={() => toggleSort("stake")}
              >
                Bonded {sortKey === "stake" && (sortDir === "asc" ? "▲" : "▼")}
              </th>
              <th className="vvt-num">% of bonded</th>
              <th
                className={`vvt-sortable ${sortKey === "vote" ? "active" : ""}`}
                onClick={() => toggleSort("vote")}
              >
                Vote {sortKey === "vote" && (sortDir === "asc" ? "▲" : "▼")}
              </th>
              <th
                className={`vvt-sortable ${sortKey === "votedAt" ? "active" : ""}`}
                onClick={() => toggleSort("votedAt")}
              >
                Voted at {sortKey === "votedAt" && (sortDir === "asc" ? "▲" : "▼")}
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((v, idx) => {
              const isHighlight = highlightSet.has(v.operatorAddress.toLowerCase());
              return (
                <tr key={v.consensusAddress} className={isHighlight ? "vvt-row-you" : ""}>
                  <td className="vvt-td-rank">{idx + 1}</td>
                  <td className="vvt-td-mon">
                    <div className="vvt-mon-cell">
                      {v.avatarUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={v.avatarUrl} alt="" className="vvt-avatar" />
                      ) : (
                        <div className="vvt-avatar vvt-avatar-fallback">
                          {v.moniker.slice(0, 1).toUpperCase()}
                        </div>
                      )}
                      <div className="vvt-mon-text">
                        <span className="vvt-mon-name">{v.moniker || "(unnamed)"}</span>
                        {isHighlight && <span className="vvt-mon-you-badge">YOUR VALIDATOR</span>}
                        {v.jailed && <span className="vvt-mon-jailed-badge">JAILED</span>}
                      </div>
                    </div>
                  </td>
                  <td className="vvt-num">{formatTxAmount(v.bondedStakeTX)} TX</td>
                  <td className="vvt-num">
                    {totalBonded > 0 ? ((v.bondedStakeTX / totalBonded) * 100).toFixed(2) : "0.00"}%
                  </td>
                  <td>
                    <VoteBadge option={v.voteOption} />
                  </td>
                  <td className="vvt-td-time">{v.votedAt ? relTime(v.votedAt) : ""}</td>
                </tr>
              );
            })}
            {rows.length === 0 && (
              <tr><td colSpan={6} className="vvt-empty">No validators match these filters.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function VoteBadge({ option }: { option: VoteOption }) {
  const cls = `vvt-vote-badge vvt-vote-${option.toLowerCase()}`;
  return <span className={cls}>{VOTE_LABEL[option]}</span>;
}

function relTime(iso: string): string {
  try {
    const ms = Date.now() - new Date(iso).getTime();
    if (ms < 60_000) return "just now";
    if (ms < 3_600_000) return `${Math.floor(ms / 60_000)}m ago`;
    if (ms < 86_400_000) return `${Math.floor(ms / 3_600_000)}h ago`;
    return `${Math.floor(ms / 86_400_000)}d ago`;
  } catch {
    return iso;
  }
}
