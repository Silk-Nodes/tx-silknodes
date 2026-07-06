// Per-page SEO content: a keyword-natural intro + a short FAQ for each main
// page. Rendered visibly (server-side, so crawlers and non-JS/agentic bots
// read it) by <SeoSection>, which also emits matching FAQPage + BreadcrumbList
// JSON-LD. Keep the copy honest and genuinely useful — it exists for readers
// first, search engines second. Not keyword stuffing.

export interface SeoFaq {
  q: string;
  a: string;
}
export interface SeoPage {
  path: string; // for the breadcrumb
  heading: string; // visible <h2>
  intro: string[]; // paragraphs
  faqs: SeoFaq[];
}

export const SEO_PAGES: Record<string, SeoPage> = {
  home: {
    path: "/",
    heading: "ALL in ONE TX: the community dashboard for the TX blockchain",
    intro: [
      "ALL in ONE TX is a free, community-built dashboard for the TX blockchain (the token formerly known as Coreum, denom ucore). It brings everything about the network into one place: live staking APR and bonded ratio, PSE (Proof of Support Emission) scores and rewards, validator comparison, exchange inflows and outflows, governance in plain English, and a per-wallet passport for any address.",
      "It is built and maintained by Silk Nodes, a professional validator on TX. No sign-up, no wallet connection required to explore, just open a page and read the on-chain data.",
    ],
    faqs: [
      { q: "What is ALL in ONE TX?", a: "ALL in ONE TX is a free, open-source dashboard for the TX token on the Coreum blockchain. It lets you stake TX, check PSE scores, calculate rewards, explore validators, follow exchange flows, read governance in plain English, and look up any wallet, in one place." },
      { q: "What is PSE (Proof of Support Emission)?", a: "PSE is TX's reward mechanism that distributes TX to stakers based on their support duration and amount. Early, committed stakers capture higher PSE rewards as the emission decreases over time." },
      { q: "How do I stake TX tokens?", a: "Connect your Keplr or Leap wallet on the dashboard, choose a validator like Silk Nodes, enter your delegation amount, and confirm. Your tokens begin earning staking rewards and PSE rewards immediately." },
      { q: "What is Silk Nodes' commission rate?", a: "Silk Nodes charges a low commission (well under the typical 8 to 10% of most validators), so delegators keep more of their staking rewards." },
      { q: "Is ALL in ONE TX free, and who built it?", a: "Yes, it is free and most features work without connecting a wallet. It is built and maintained by Silk Nodes, a professional TX validator, as a public good for the community." },
    ],
  },
  pse: {
    path: "/pse",
    heading: "TX PSE score and rewards, explained",
    intro: [
      "PSE (Proof of Support Emission) is TX's community-staker reward mechanism. This page lets you check the live PSE score for any TX wallet, see where it stands in the distribution, and estimate the TX it will earn in the next cycle.",
      "Paste any core1 address to read its real on-chain PSE score, or connect your wallet to track your own standing over time.",
    ],
    faqs: [
      { q: "What is PSE on TX?", a: "PSE (Proof of Support Emission) rewards community stakers on the TX chain with periodic TX distributions based on an on-chain score. It is separate from ordinary staking rewards." },
      { q: "How do I check my PSE score?", a: "Enter any core1 wallet address on the PSE page, or connect your wallet. The score is read live from the chain, no login required." },
      { q: "How are PSE rewards calculated?", a: "Your estimated payout is your share of the network PSE score applied to the cycle's emission. The page shows your score, your pool share, and an estimate for the next distribution." },
    ],
  },
  governance: {
    path: "/governance",
    heading: "TX governance, made readable",
    intro: [
      "TX governance decides how the chain evolves: parameter changes, spending, and upgrades. This page turns every proposal into a plain-English explainer, shows how each validator voted with yours highlighted, and lets you vote directly or override your validator if you disagree.",
      "A live projection shows whether a proposal is on track to pass, so you can act before voting closes.",
    ],
    faqs: [
      { q: "How does voting work on TX?", a: "TX uses on-chain governance: proposals enter a voting period where stakers (and their validators on their behalf) vote Yes, No, Abstain, or No With Veto. You can vote yourself or let your validator vote for you." },
      { q: "Can I override my validator's vote?", a: "Yes. If your validator votes a way you disagree with, you can cast your own vote directly from this page, which overrides your validator's vote for your stake." },
      { q: "What does 'No With Veto' mean?", a: "It is a stronger 'No' that also signals the proposal is spam or harmful. If veto votes exceed a threshold, the proposal is rejected and the deposit is burned." },
    ],
  },
  validators: {
    path: "/validators",
    heading: "Compare TX validators",
    intro: [
      "Choosing a validator determines your staking rewards, your governance representation, and the network's decentralization. This explorer compares every TX validator by voting power, commission, uptime, and PSE, so you can delegate with confidence.",
      "Silk Nodes runs a professional, low-commission validator on TX with a strong uptime record.",
    ],
    faqs: [
      { q: "How do I choose a TX validator?", a: "Look at commission (lower keeps more rewards for you), uptime and reliability, voting power (spreading stake across smaller validators helps decentralization), and governance participation. This page ranks all of these." },
      { q: "What is validator commission?", a: "The percentage a validator keeps from your staking rewards for running the infrastructure. The rest is distributed to delegators like you." },
      { q: "Can I split my stake across validators?", a: "Yes. Delegating to several validators is common and improves both your resilience and the network's decentralization." },
    ],
  },
  flows: {
    path: "/flows",
    heading: "TX exchange flows",
    intro: [
      "Exchange flows track TX moving to and from centralized exchanges, a common signal of buying and selling pressure. This page shows net inflows and outflows over time, a per-exchange breakdown, and per-wallet flow history for any address.",
      "Net outflows (TX leaving exchanges into self-custody) often signal accumulation; net inflows can signal distribution.",
    ],
    faqs: [
      { q: "What are exchange flows?", a: "Deposits to and withdrawals from centralized exchanges. Inflows (TX sent to exchanges) can precede selling; outflows (TX withdrawn to wallets) can indicate accumulation." },
      { q: "Can I see a specific wallet's exchange history?", a: "Yes. Search any core1 address to see its deposits and withdrawals per exchange, plus whether it is a net accumulator or distributor." },
    ],
  },
  calculator: {
    path: "/calculator",
    heading: "TX staking rewards calculator",
    intro: [
      "Estimate your TX staking rewards and PSE earnings before you delegate. Enter a stake amount to see projected returns based on the live network APR and PSE emission, so you can plan your delegation.",
    ],
    faqs: [
      { q: "How much can I earn staking TX?", a: "It depends on the live staking APR, the amount you delegate, and your validator's commission. Enter your figures on this page for a current, on-chain estimate." },
      { q: "Does PSE change my staking returns?", a: "Yes. PSE adds community-staker emissions on top of ordinary staking rewards. The calculator factors both into the estimate." },
    ],
  },
  passport: {
    path: "/passport",
    heading: "TX Wallet Passport",
    intro: [
      "The Wallet Passport is a full on-chain profile for any TX address in one view: holdings, staking and delegations, PSE earned to date, token holdings, exchange behavior, governance record, referral earnings, and a complete activity timeline.",
      "Paste any core1 address to look it up, no wallet connection needed.",
    ],
    faqs: [
      { q: "What can I see in a TX Wallet Passport?", a: "Everything on-chain about the address: net worth, staked amount and validators, PSE earned, tokens held, exchange inflows/outflows, governance votes, and full transaction history." },
      { q: "Do I need to connect a wallet?", a: "No. You can look up any public core1 address without connecting. Connecting only lets you jump straight to your own wallet." },
    ],
  },
};
