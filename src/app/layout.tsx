import type { Metadata } from "next";
import Script from "next/script";
import "./globals.css";
import { NO_FLASH_SCRIPT } from "@/lib/theme";

// Phase 2: app served from its own origin; no /tx-silknodes/ prefix.
const basePath = "";

export const metadata: Metadata = {
  // Per-page titles: each route's layout sets a short title (e.g. "Flows")
  // and this template appends the brand, so the browser tab reads
  // "Flows \u00b7 All in ONE TX". Routes with no title use `default`.
  title: {
    default: "ALL in ONE TX | Stake \u2022 PSE \u2022 Explore \u2022 Track",
    template: "%s \u00b7 All in ONE TX",
  },
  description:
    "The all-in-one dashboard for the TX chain: staking, PSE rewards, validators, exchange flows, and governance. Built by Silk Nodes.",
  keywords: [
    "TX", "TX token", "TX staking", "TX blockchain", "Coreum", "Coreum staking",
    "PSE", "Proof of Support Emission", "PSE calculator", "PSE rewards", "PSE score",
    "Silk Nodes", "Silk Nodes validator",
    "staking dashboard", "staking calculator", "staking rewards",
    "validator explorer", "delegation", "redelegate", "undelegate",
    "auto-compound", "Restake", "Keplr wallet", "Leap wallet",
    "RWA", "tokenized assets", "smart tokens", "real world assets",
    "crypto staking", "blockchain staking", "Cosmos SDK", "IBC",
  ],
  metadataBase: new URL("https://tx.silknodes.io"),
  alternates: {
    canonical: "/",
  },
  icons: {
    icon: `${basePath}/tx-icon.png`,
    shortcut: `${basePath}/tx-icon.png`,
    apple: `${basePath}/tx-icon.png`,
  },
  openGraph: {
    // title/description are intentionally NOT set here so each route's
    // layout provides its own (og:title falls back to the page title,
    // og:description to the page description). og:image comes from the
    // file-based opengraph-image.tsx convention.
    url: "https://tx.silknodes.io/",
    siteName: "ALL in ONE TX",
    type: "website",
    locale: "en_US",
  },
  twitter: {
    card: "summary_large_image",
    // title/description/image all fall back to the Open Graph values,
    // which are per-route.
  },
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      "max-video-preview": -1,
      "max-image-preview": "large",
      "max-snippet": -1,
    },
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    // suppressHydrationWarning: the no-flash script below sets data-theme on
    // <html> before React hydrates, which React would otherwise flag as a
    // mismatch (its own render has no data-theme) and could reset, desyncing
    // the theme from the switcher (e.g. moon selected but a light page). This
    // opts <html> out of that check so the pre-paint theme survives.
    <html lang="en" suppressHydrationWarning>
      <head>
        {/* Theme no-flash script MUST run before first paint so the <html>
            gets the correct data-theme attribute before React hydrates.
            Otherwise the first render would always be light theme and
            dark/warm users would see a ~100ms flash on every page load. */}
        <script dangerouslySetInnerHTML={{ __html: NO_FLASH_SCRIPT }} />
        <meta name="theme-color" content="#B1FC03" />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
        {/* Google Search Console - replace YOUR_GSC_CODE with verification code from search.google.com/search-console */}
        {/* <meta name="google-site-verification" content="YOUR_GSC_CODE" /> */}
        {/* Bing Webmaster Tools - replace YOUR_BING_CODE with verification code from bing.com/webmasters */}
        {/* <meta name="msvalidate.01" content="YOUR_BING_CODE" /> */}
        <meta
          httpEquiv="Content-Security-Policy"
          content="default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval' https://www.googletagmanager.com https://www.google-analytics.com https://*.clarity.ms; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; font-src 'self' data:; frame-src https://restake.app; connect-src 'self' https://api.coingecko.com https://api.silknodes.io https://rest-coreum.ecostake.com https://rpc-coreum.ecostake.com wss://rpc-coreum.ecostake.com https://full-node.mainnet-1.coreum.dev:1317 https://hasura.mainnet-1.coreum.dev https://api.web3forms.com https://www.google-analytics.com https://analytics.google.com https://www.googletagmanager.com https://*.clarity.ms; object-src 'none'; base-uri 'self';"
        />
        <link rel="icon" href={`${basePath}/tx-icon.png`} type="image/png" />
        <link rel="apple-touch-icon" href={`${basePath}/tx-icon.png`} />
        <link rel="manifest" href={`${basePath}/manifest.json`} />

        {/* Preconnect for faster API calls */}
        <link rel="preconnect" href="https://api.coingecko.com" />
        <link rel="preconnect" href="https://full-node.mainnet-1.coreum.dev" />
        <link rel="dns-prefetch" href="https://rest-coreum.ecostake.com" />
        <link rel="dns-prefetch" href="https://www.googletagmanager.com" />
        {/* Google Analytics */}
        <Script
          src="https://www.googletagmanager.com/gtag/js?id=G-CJ5WHL9PC3"
          strategy="afterInteractive"
        />
        <Script id="google-analytics" strategy="afterInteractive">
          {`
            window.dataLayer = window.dataLayer || [];
            function gtag(){dataLayer.push(arguments);}
            gtag('consent', 'default', {
              analytics_storage: localStorage.getItem('tx-cookie-consent') === 'declined' ? 'denied' : 'granted',
            });
            gtag('js', new Date());
            gtag('config', 'G-CJ5WHL9PC3');
          `}
        </Script>

        {/* Structured data for AI and search engines */}
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{
            __html: JSON.stringify({
              "@context": "https://schema.org",
              "@type": "WebApplication",
              name: "ALL in ONE TX",
              url: "https://tx.silknodes.io",
              description: "Stake TX, Check your PSE score, Calculate your staking rewards, Explore validators, Manage delegations, and Track tokenized assets. Built by Silk Nodes on the TX blockchain.",
              applicationCategory: "FinanceApplication",
              operatingSystem: "Web",
              offers: {
                "@type": "Offer",
                price: "0",
                priceCurrency: "USD",
              },
              creator: {
                "@type": "Organization",
                name: "Silk Nodes",
                url: "https://silknodes.io",
                description: "Professional blockchain validator and infrastructure provider. Active on Coreum (TX), Cosmos ecosystem.",
              },
              featureList: [
                "TX token staking with Keplr and Leap wallet",
                "Live PSE (Proof of Support Emission) score lookup",
                "PSE rewards calculator and simulator",
                "Validator explorer with commission and voting power comparison",
                "Delegate, undelegate, and redelegate TX tokens",
                "Auto-compound staking rewards via Restake integration",
                "Tokenized asset (RWA) explorer on Coreum",
                "Real-time on-chain data from Coreum mainnet",
              ],
            }),
          }}
        />

        {/* Organization schema with social links */}
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{
            __html: JSON.stringify({
              "@context": "https://schema.org",
              "@type": "Organization",
              name: "Silk Nodes",
              url: "https://silknodes.io",
              logo: "https://tx.silknodes.io/silk-nodes-logo.png",
              description: "Professional blockchain validator and infrastructure provider. Active on Coreum (TX) with 5% commission, 99.98% uptime, and zero slashing events.",
              sameAs: [
                "https://x.com/silk_nodes",
                "https://github.com/Silk-Nodes",
              ],
              contactPoint: {
                "@type": "ContactPoint",
                contactType: "customer support",
                url: "https://x.com/silk_nodes",
              },
            }),
          }}
        />

        {/* Per-page FAQ + breadcrumb structured data is emitted by
            <SeoSection> (src/components/SeoSection.tsx) so each route carries
            its own, page-specific FAQPage rather than one global block
            duplicated on every route. */}

        {/* Microsoft Clarity - Heatmaps & Session Recording
            To enable: replace YOUR_CLARITY_ID with your project ID from clarity.microsoft.com
        <Script id="microsoft-clarity" strategy="afterInteractive">
          {`
            (function(c,l,a,r,i,t,y){
              c[a]=c[a]||function(){(c[a].q=c[a].q||[]).push(arguments)};
              t=l.createElement(r);t.async=1;t.src="https://www.clarity.ms/tag/"+i;
              y=l.getElementsByTagName(r)[0];y.parentNode.insertBefore(t,y);
            })(window,document,"clarity","script","YOUR_CLARITY_ID");
          `}
        </Script>
        */}
      </head>
      <body>{children}</body>
    </html>
  );
}
