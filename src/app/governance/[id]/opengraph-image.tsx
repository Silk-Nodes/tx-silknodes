import {
  ogFrame,
  ogImage,
  ogTallyBar,
  ogStatusPill,
  fetchProposalOg,
  OG_SIZE,
  OG_CONTENT_TYPE,
} from "@/lib/og";

export const runtime = "nodejs";
export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;
export const alt = "TX Governance proposal";

function truncate(s: string, n: number): string {
  return s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s;
}

export default async function Image({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const p = await fetchProposalOg(Number(id));

  // No data (bad id / indexer hiccup): fall back to a branded governance card.
  if (!p) {
    return ogImage(
      ogFrame({
        eyebrow: `Governance · Proposal #${id}`,
        title: "TX Governance",
        subtitle: "Live proposal tallies, validator votes, and delegator overrides.",
      }),
    );
  }

  return ogImage(
    ogFrame({
      eyebrow: `Governance · Proposal #${id}`,
      title: truncate(p.title, 68),
      children: (
        <>
          {ogStatusPill(p.status)}
          {ogTallyBar(p)}
        </>
      ),
    }),
  );
}
