"use client";

// Route page for /passport. Rendering happens inside HomePage, which reads
// usePathname() and switches activeTab. This file makes /passport a real,
// shareable URL (and supports /passport?address=core1...).

import HomePage from "../page";

export default function Page() {
  return <HomePage />;
}
