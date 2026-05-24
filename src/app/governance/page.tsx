"use client";

// Route page for /governance (the landing). Proposal detail pages live
// at /governance/[id] in a sibling route file. Both render HomePage,
// which handles the rest via URL detection.

import HomePage from "../page";

export default function Page() {
  return <HomePage />;
}
