"use client";

// The proposal detail page is just the main HomePage with the URL
// pointing at /governance/[id]. HomePage detects this via usePathname()
// and renders <ProposalDetailView> inside the governance tab body, so
// the user sees the proposal inside the same top nav + footer as the
// rest of the app.
//
// Keeping the route file is what makes /governance/44 a real shareable
// URL instead of a hash fragment.

import HomePage from "../../page";

export default function ProposalRoutePage() {
  return <HomePage />;
}
