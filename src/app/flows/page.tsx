"use client";

// Route page for /flows. The actual rendering happens inside HomePage,
// which reads usePathname() and switches activeTab accordingly. This
// route file exists so /flows is a real shareable URL.

import HomePage from "../page";

export default function Page() {
  return <HomePage />;
}
