import type { Metadata } from "next";
import Script from "next/script";
import "./globals.css";

const basePath = "/tx-silknodes";

export const metadata: Metadata = {
  title: "ALL in ONE TX | Stake \u2022 PSE \u2022 Explore \u2022 Track",
  description:
    "Stake TX, Check your PSE score, Calculate your staking rewards, Explore validators, Manage delegations, and Track tokenized assets. Built by Silk Nodes on the TX blockchain.",
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
    title: "ALL in ONE TX | Stake \u2022 PSE \u2022 Explore \u2022 Track",
    description: "Stake TX, Check your PSE score, Calculate your staking rewards, Explore validators, Manage delegations, and Track tokenized assets. Built by Silk Nodes on the TX blockchain.",
    url: "https://tx.silknodes.io",
    siteName: "ALL in ONE TX",
    type: "website",
    locale: "en_US",
    images: [
      {
        url: `${basePath}/og-image.png`,
        width: 1200,
        height: 630,
        alt: "ALL in ONE TX | Stake, PSE, Explore, Track",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "ALL in ONE TX | Stake \u2022 PSE \u2022 Explore \u2022 Track",
    description: "Stake TX, Check your PSE score, Calculate your staking rewards, Explore validators, Manage delegations, and Track tokenized assets. Built by Silk Nodes on the TX blockchain.",
    images: [`${basePath}/og-image.png`],
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
    <html lang="en">
      <head>
        <link rel="icon" href={`${basePath}/tx-icon.png`} type="image/png" />
        <link rel="apple-touch-icon" href={`${basePath}/tx-icon.png`} />
        {/* Google Analytics */}
        <Script
          src="https://www.googletagmanager.com/gtag/js?id=G-CJ5WHL9PC3"
          strategy="afterInteractive"
        />
        <Script id="google-analytics" strategy="afterInteractive">
          {`
            window.dataLayer = window.dataLayer || [];
            function gtag(){dataLayer.push(arguments);}
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
      </head>
      <body>{children}</body>
    </html>
  );
}
