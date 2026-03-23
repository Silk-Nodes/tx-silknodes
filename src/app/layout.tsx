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
  metadataBase: new URL("https://silk-nodes.github.io"),
  alternates: {
    canonical: "/tx-silknodes/",
  },
  icons: {
    icon: `${basePath}/tx-icon.png`,
    shortcut: `${basePath}/tx-icon.png`,
    apple: `${basePath}/tx-icon.png`,
  },
  openGraph: {
    title: "ALL in ONE TX | Stake \u2022 PSE \u2022 Explore \u2022 Track",
    description: "Stake TX, Check your PSE score, Calculate your staking rewards, Explore validators, Manage delegations, and Track tokenized assets. Built by Silk Nodes on the TX blockchain.",
    url: "https://silk-nodes.github.io/tx-silknodes/",
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
        <meta name="theme-color" content="#B1FC03" />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
        <meta
          httpEquiv="Content-Security-Policy"
          content="default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval' https://www.googletagmanager.com https://www.google-analytics.com https://www.clarity.ms; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; font-src 'self' data:; frame-src https://restake.app; connect-src 'self' https://api.coingecko.com https://rest-coreum.ecostake.com https://rpc-coreum.ecostake.com https://full-node.mainnet-1.coreum.dev:1317 https://hasura.mainnet-1.coreum.dev https://api.web3forms.com https://www.google-analytics.com https://www.googletagmanager.com https://www.clarity.ms; object-src 'none'; base-uri 'self';"
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
              logo: "https://silk-nodes.github.io/tx-silknodes/silk-nodes-logo.png",
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

        {/* FAQ structured data for rich snippets */}
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{
            __html: JSON.stringify({
              "@context": "https://schema.org",
              "@type": "FAQPage",
              mainEntity: [
                {
                  "@type": "Question",
                  name: "What is ALL in ONE TX?",
                  acceptedAnswer: {
                    "@type": "Answer",
                    text: "ALL in ONE TX is a free, open-source staking dashboard for the TX token on Coreum blockchain. It lets you stake TX, check PSE scores, calculate rewards, explore validators, and track tokenized assets in one place.",
                  },
                },
                {
                  "@type": "Question",
                  name: "What is PSE (Proof of Support Emission)?",
                  acceptedAnswer: {
                    "@type": "Answer",
                    text: "PSE is Coreum's unique reward mechanism that distributes TX tokens to stakers based on their support duration and amount. Early stakers capture higher PSE rewards as the emission decreases over time.",
                  },
                },
                {
                  "@type": "Question",
                  name: "How do I stake TX tokens?",
                  acceptedAnswer: {
                    "@type": "Answer",
                    text: "Connect your Keplr or Leap wallet on the ALL in ONE TX dashboard, choose a validator like Silk Nodes (5% commission), enter your delegation amount, and confirm the transaction. Your tokens begin earning staking rewards and PSE rewards immediately.",
                  },
                },
                {
                  "@type": "Question",
                  name: "What is Silk Nodes commission rate?",
                  acceptedAnswer: {
                    "@type": "Answer",
                    text: "Silk Nodes charges a 5% commission rate, which is lower than the typical 8-10% charged by most validators. This means delegators keep more of their staking rewards.",
                  },
                },
                {
                  "@type": "Question",
                  name: "What are tokenized real-world assets (RWA) on Coreum?",
                  acceptedAnswer: {
                    "@type": "Answer",
                    text: "Coreum enables tokenization of real-world assets like stocks, real estate, and bonds using its smart token standard. These are compliant, programmable financial assets built at the protocol level, not through smart contracts.",
                  },
                },
              ],
            }),
          }}
        />

        {/* Microsoft Clarity - Heatmaps & Session Recording */}
        <Script id="microsoft-clarity" strategy="afterInteractive">
          {`
            (function(c,l,a,r,i,t,y){
              c[a]=c[a]||function(){(c[a].q=c[a].q||[]).push(arguments)};
              t=l.createElement(r);t.async=1;t.src="https://www.clarity.ms/tag/"+i;
              y=l.getElementsByTagName(r)[0];y.parentNode.insertBefore(t,y);
            })(window,document,"clarity","script","CLARITY_ID");
          `}
        </Script>
      </head>
      <body>{children}</body>
    </html>
  );
}
