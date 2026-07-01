"use client";

// Route page for /referral. Rendering happens inside HomePage, which reads
// usePathname() and switches activeTab. This makes /referral a real URL.

import HomePage from "../page";

export default function Page() {
  return <HomePage />;
}
