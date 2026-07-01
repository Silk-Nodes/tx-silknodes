import type { Metadata } from "next";

export async function generateMetadata(
  { params }: { params: Promise<{ id: string }> },
): Promise<Metadata> {
  const { id } = await params;
  // `absolute` sets the full title directly (the parent "Governance" string
  // title otherwise swallows the brand template for this nested route).
  return { title: { absolute: `Proposal #${id} · All in ONE TX` } };
}

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
