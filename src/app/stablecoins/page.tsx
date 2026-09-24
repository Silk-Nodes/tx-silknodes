"use client";

// Route page for /stablecoins. HomePage reads usePathname() and switches to
// the stablecoins tab, the same way /rwa and the other pages work. This file
// exists so /stablecoins is a real, shareable URL.

import HomePage from "../page";

export default function Page() {
  return <HomePage />;
}
