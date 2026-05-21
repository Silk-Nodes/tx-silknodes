// GET /api/governance
//
// Proxies Coreum's Hasura gov tables into the shape useGovernance()
// expects. We do the unit conversion (ucore → TX) server-side so the
// client never sees raw bigint strings.
//
// We hit Hasura instead of having the client call it directly so:
//   1. The Hasura URL stays out of the client bundle (less surface).
//   2. We can cache / sanitize / normalize in one place.
//   3. If we ever switch indexers, only this route changes.

import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const revalidate = 60; // 1 min — governance state doesn't change often

const HASURA_URL = "https://hasura.mainnet-1.coreum.dev/v1/graphql";
const UCORE_PER_TX = 1_000_000;

interface HasuraProposal {
  id: number;
  title: string;
  description: string;
  status: string;
  content: { "@type"?: string }[] | null;
  proposer_address: string | null;
  submit_time: string | null;
  voting_start_time: string | null;
  voting_end_time: string | null;
  proposal_tally_result: {
    yes: string;
    no: string;
    abstain: string;
    no_with_veto: string;
  } | null;
  staking_pool_snapshot: { bonded_tokens: string } | null;
}

interface HasuraGovParams {
  params: {
    quorum: string;
    threshold: string;
    veto_threshold: string;
    voting_period: number;
  };
}

const QUERY = `{
  proposal(order_by: {id: desc}) {
    id
    title
    description
    status
    content
    proposer_address
    submit_time
    voting_start_time
    voting_end_time
    proposal_tally_result {
      yes
      no
      abstain
      no_with_veto
    }
    staking_pool_snapshot {
      bonded_tokens
    }
  }
  gov_params {
    params
  }
}`;

function ucoreToTX(s: string | undefined | null): number {
  if (!s) return 0;
  try {
    return Number(BigInt(s)) / UCORE_PER_TX;
  } catch {
    return 0;
  }
}

export async function GET() {
  try {
    const res = await fetch(HASURA_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query: QUERY }),
      // Don't cache for too long client-side; the route already has
      // revalidate=60 above.
      cache: "no-store",
    });
    if (!res.ok) {
      return NextResponse.json(
        { error: `hasura HTTP ${res.status}` },
        { status: 502, headers: { "cache-control": "no-store" } },
      );
    }
    const json = await res.json();
    if (json.errors) {
      return NextResponse.json(
        { error: "hasura-errors", details: json.errors },
        { status: 502, headers: { "cache-control": "no-store" } },
      );
    }

    const proposals = ((json.data?.proposal ?? []) as HasuraProposal[]).map((p) => {
      const tally = p.proposal_tally_result;
      const yes = ucoreToTX(tally?.yes);
      const no = ucoreToTX(tally?.no);
      const abstain = ucoreToTX(tally?.abstain);
      const noWithVeto = ucoreToTX(tally?.no_with_veto);
      // First message in `content` array is the canonical proposal type.
      // Multi-message proposals are rare; we surface the primary one.
      const rawType = Array.isArray(p.content) && p.content[0]?.["@type"]
        ? (p.content[0]["@type"] as string)
        : "";
      return {
        id: p.id,
        title: p.title,
        description: p.description,
        rawStatus: p.status,
        rawType,
        proposer: p.proposer_address,
        submitTime: p.submit_time,
        votingStartTime: p.voting_start_time,
        votingEndTime: p.voting_end_time,
        tally: {
          yes,
          no,
          abstain,
          noWithVeto,
          totalVoted: yes + no + abstain + noWithVeto,
          bondedSnapshot: ucoreToTX(p.staking_pool_snapshot?.bonded_tokens),
        },
      };
    });

    const rawParams = (json.data?.gov_params?.[0] as HasuraGovParams | undefined)?.params;
    const params = {
      quorum: rawParams ? Number(rawParams.quorum) : 0.4,
      threshold: rawParams ? Number(rawParams.threshold) : 0.5,
      vetoThreshold: rawParams ? Number(rawParams.veto_threshold) : 0.334,
      // voting_period from Hasura is in nanoseconds.
      votingPeriodSeconds: rawParams ? rawParams.voting_period / 1e9 : 432000,
    };

    return NextResponse.json(
      { proposals, params },
      { headers: { "cache-control": "no-store" } },
    );
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { error: message },
      { status: 500, headers: { "cache-control": "no-store" } },
    );
  }
}
