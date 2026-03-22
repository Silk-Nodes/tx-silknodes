import type { Metadata } from "next";
import Script from "next/script";
import "./globals.css";

export const metadata: Metadata = {
  title: "ALL in ONE TX | Silk Nodes",
  description:
    "ALL in ONE TX dashboard by Silk Nodes. Stake TX tokens, check your Proof of Support Emission (PSE) score, explore validators, manage delegations, and track tokenized assets (RWA) on the Coreum blockchain. Real-time on-chain data, PSE calculator, auto-compound via Restake, and wallet integration with Keplr and Leap.",
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
    icon: "/tx-icon.png",
    shortcut: "/tx-icon.png",
    apple: "/tx-icon.png",
  },
  openGraph: {
    title: "ALL in ONE TX | Silk Nodes",
    description: "Stake TX, check your PSE score, explore validators, manage delegations, and track tokenized assets. Built by Silk Nodes on the Coreum blockchain.",
    url: "https://tx.silknodes.io",
    siteName: "ALL in ONE TX",
    type: "website",
    locale: "en_US",
    images: [
      {
        url: "/tx-icon.png",
        width: 512,
        height: 512,
        alt: "TX Token",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "ALL in ONE TX | Silk Nodes",
    description: "Stake TX, check your PSE score, explore validators, and manage delegations on Coreum.",
    images: ["/tx-icon.png"],
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
              description: "Stake TX tokens, check PSE rewards, explore validators, and manage delegations on the Coreum blockchain. Built by Silk Nodes validator.",
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
