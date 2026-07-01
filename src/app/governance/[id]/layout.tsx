import type { Metadata } from "next";
import { fetchProposalOg } from "@/lib/og";

export async function generateMetadata(
  { params }: { params: Promise<{ id: string }> },
): Promise<Metadata> {
  const { id } = await params;
  const p = await fetchProposalOg(Number(id));
  const name = p?.title
    ? `#${id}: ${p.title.length > 66 ? `${p.title.slice(0, 65).trimEnd()}…` : p.title}`
    : `Governance Proposal #${id}`;

  return {
    // Browser tab: keep it short. `absolute` sets it directly (the parent
    // "Governance" title would otherwise swallow the brand template here).
    title: { absolute: `Proposal #${id} · All in ONE TX` },
    description: `See the live tally, validator votes, and final outcome for TX governance proposal #${id}.`,
    openGraph: { title: name },
  };
}

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
