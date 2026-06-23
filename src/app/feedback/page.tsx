"use client";

// Route page for /feedback. The actual rendering happens inside HomePage,
// which reads usePathname() and switches activeTab accordingly. This
// route file exists so /feedback is a real shareable URL.

import HomePage from "../page";

export default function Page() {
  return <HomePage />;
}
