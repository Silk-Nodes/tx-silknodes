"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import QRCode from "qrcode";
import Shareable from "@/components/share/Shareable";
import { formatCompact } from "@/lib/ui-format";

// tx.market Refer & Earn program (flat bounty per verified signup):
//   Base:  500 TX to the referrer + 500 TX to the friend, after KYC.
//   Elite Club (first 100, by application): 2x = 1000 TX to the referrer.
const BASE_REWARD = 500;
const ELITE_REWARD = 1000;
const FRIEND_REWARD = 500;
const REF_BASE = "https://tx.market/referral?ref=";
const CODE_KEY = "tx-referral-code";

// Pull a ref code out of whatever the user pastes: a full link
// (…?ref=CODE) or the bare code.
function parseCode(raw: string): string {
  const s = raw.trim();
  if (!s) return "";
  const m = s.match(/[?&]ref=([^&\s]+)/i);
  if (m) return decodeURIComponent(m[1]);
  // strip an accidental full URL with the code as the last path segment
  if (/^https?:\/\//i.test(s)) {
    const tail = s.split(/[/?#]/).filter(Boolean).pop() ?? "";
    return tail;
  }
  return s;
}

const TXn = (n: number) => `${formatCompact(n)} TX`;

export default function ReferralTab({ txPrice = 0 }: { txPrice?: number }) {
  const [input, setInput] = useState("");
  const [code, setCode] = useState("");
  const [elite, setElite] = useState(false);
  const [referrals, setReferrals] = useState(10);
  const [targetPrice, setTargetPrice] = useState(0);
  const [qr, setQr] = useState("");
  const [copied, setCopied] = useState<"link" | "text" | null>(null);

  // Restore a previously entered code + seed a sensible target price.
  useEffect(() => {
    try {
      const saved = localStorage.getItem(CODE_KEY);
      if (saved) { setCode(saved); setInput(saved); }
    } catch { /* ignore */ }
  }, []);
  useEffect(() => {
    if (targetPrice === 0 && txPrice > 0) {
      // default the "what if" price to a round 10x-ish aspiration
      setTargetPrice(Math.max(0.05, Math.ceil(txPrice * 10 * 1000) / 1000));
    }
  }, [txPrice, targetPrice]);

  const link = code ? `${REF_BASE}${encodeURIComponent(code)}` : "";

  // Generate the QR (dark modules on white for reliable scanning; the tile
  // gets the neon frame in CSS). Data URI so the share export is self-contained.
  useEffect(() => {
    if (!link) { setQr(""); return; }
    let alive = true;
    QRCode.toDataURL(link, { width: 320, margin: 1, color: { dark: "#0a0d07", light: "#ffffff" } })
      .then((d) => { if (alive) setQr(d); })
      .catch(() => { if (alive) setQr(""); });
    return () => { alive = false; };
  }, [link]);

  const applyCode = useCallback(() => {
    const c = parseCode(input);
    setCode(c);
    try { if (c) localStorage.setItem(CODE_KEY, c); } catch { /* ignore */ }
  }, [input]);

  const shareText = `I'm on the $TX Super App. Sign up with my link and we each earn 500 $TX after KYC:\n\n${link}`;
  const copy = (what: "link" | "text") => {
    const val = what === "link" ? link : shareText;
    navigator.clipboard?.writeText(val).then(() => {
      setCopied(what);
      setTimeout(() => setCopied(null), 1600);
    }).catch(() => {});
  };

  // ── Calculator ──
  const perReferral = elite ? ELITE_REWARD : BASE_REWARD;
  const totalTX = referrals * perReferral;
  const usdNow = txPrice > 0 ? totalTX * txPrice : 0;
  const usdTarget = targetPrice > 0 ? totalTX * targetPrice : 0;
  const eliteBonusTX = referrals * (ELITE_REWARD - BASE_REWARD); // extra vs base
  const fmtUsd = (v: number) => (v >= 1000 ? `$${formatCompact(v)}` : `$${v.toFixed(2)}`);

  const shareOpen = useMemo(() => `https://twitter.com/intent/tweet?text=${encodeURIComponent(shareText)}`, [shareText]);

  return (
    <div className="ref">
      {/* Intro */}
      <div className="ref-intro">
        <h1 className="ref-title">Refer &amp; Earn</h1>
        <p className="ref-sub">
          Share your tx.market link. When a friend signs up and completes KYC,
          you both earn <strong>500 TX</strong>. Elite Club members earn
          <strong> 2x</strong>.
        </p>
        <div className="ref-facts">
          <span className="ref-fact"><b>500 TX</b> per verified signup</span>
          <span className="ref-fact"><b>+500 TX</b> for your friend</span>
          <span className="ref-fact ref-fact-elite"><b>2x</b> as Elite Club</span>
        </div>
      </div>

      {/* Link builder */}
      <div className="ref-card">
        <div className="ref-card-head">Your referral link</div>
        <div className="ref-linkform">
          <input
            className="ref-input"
            placeholder="Paste your tx.market referral code or link"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && applyCode()}
            spellCheck={false}
          />
          <button className="ref-btn-primary" onClick={applyCode} disabled={!input.trim()}>Use link</button>
        </div>

        {link ? (
          <>
            <div className="ref-linkout">
              <span className="ref-linkout-url mono">{link}</span>
              <div className="ref-linkout-actions">
                <button className="ref-chip" onClick={() => copy("link")}>{copied === "link" ? "Copied" : "Copy link"}</button>
                <button className="ref-chip" onClick={() => copy("text")}>{copied === "text" ? "Copied" : "Copy post"}</button>
                <a className="ref-chip ref-chip-x" href={shareOpen} target="_blank" rel="noopener noreferrer">Share on X</a>
              </div>
            </div>

            {/* Shareable card with QR */}
            <Shareable title="Refer & Earn on tx.market" subtitle="Scan or tap to join" caption="We both earn 500 TX after KYC" exportWidth={520}>
              <div className="ref-share">
                <div className="ref-share-left">
                  <div className="ref-share-eyebrow">$TX SUPER APP</div>
                  <div className="ref-share-headline">Join with my link, we both earn 500 TX</div>
                  <div className="ref-share-note">Sign up on tx.market and complete KYC. Elite Club members earn 2x.</div>
                  <div className="ref-share-url mono">{link.replace(/^https?:\/\//, "")}</div>
                </div>
                {qr ? (
                  <div className="ref-qr">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={qr} alt="Referral QR code" width={140} height={140} />
                  </div>
                ) : null}
              </div>
            </Shareable>
          </>
        ) : (
          <div className="ref-empty">
            Enter your code to generate a shareable link, QR, and ready-to-post text.
            Find it in the tx.market app under Refer &amp; Earn.
          </div>
        )}
      </div>

      {/* Calculator */}
      <div className="ref-card">
        <div className="ref-card-head">Earnings calculator</div>

        <div className="ref-calc-controls">
          <div className="ref-tier-toggle" role="group" aria-label="Reward tier">
            <button className={`ref-tier ${!elite ? "active" : ""}`} onClick={() => setElite(false)} aria-pressed={!elite}>Base · 500 TX</button>
            <button className={`ref-tier ${elite ? "active" : ""}`} onClick={() => setElite(true)} aria-pressed={elite}>Elite · 1000 TX</button>
          </div>

          <div className="ref-slider-row">
            <label className="ref-slider-label">Verified referrals <b>{referrals}</b></label>
            <input className="ref-slider" type="range" min={1} max={200} value={referrals}
              onChange={(e) => setReferrals(Number(e.target.value))} />
          </div>
        </div>

        <div className="ref-calc-out">
          <div className="ref-calc-hero">
            <span className="ref-calc-hero-label">You earn</span>
            <span className="ref-calc-hero-value">{TXn(totalTX)}</span>
            <span className="ref-calc-hero-sub">{referrals} × {perReferral} TX</span>
          </div>
          <div className="ref-calc-grid">
            <div className="ref-kv"><span className="ref-kv-label">At today's price</span><span className="ref-kv-value">{txPrice > 0 ? fmtUsd(usdNow) : "—"}</span></div>
            <div className="ref-kv">
              <span className="ref-kv-label">At target price
                <input className="ref-price-input" type="number" step="0.001" min="0" value={targetPrice || ""}
                  onChange={(e) => setTargetPrice(Number(e.target.value))} aria-label="Target TX price" />
              </span>
              <span className="ref-kv-value ref-kv-accent">{targetPrice > 0 ? fmtUsd(usdTarget) : "—"}</span>
            </div>
          </div>
        </div>

        {!elite && (
          <div className="ref-elite-nudge">
            As <strong>Elite Club</strong> the same {referrals} referrals earn{" "}
            <strong>{TXn(referrals * ELITE_REWARD)}</strong> ({TXn(eliteBonusTX)} more).
            <a href="https://tx.market/referral" target="_blank" rel="noopener noreferrer" className="ref-elite-link">Apply in the app →</a>
          </div>
        )}
      </div>

      {/* How it works */}
      <div className="ref-card">
        <div className="ref-card-head">How it works</div>
        <ol className="ref-steps">
          <li><b>Share</b> your link or QR with a friend.</li>
          <li>They <b>sign up</b> on tx.market using your code and complete <b>KYC</b>.</li>
          <li>You both receive <b>500 TX</b> (Elite Club members get <b>1000 TX</b>).</li>
        </ol>
        <div className="ref-fineprint">
          Rewards are issued by tx.market only to successfully KYC-verified signups.
          Elite Club has 100 slots, by application, and applies the 2x multiplier
          while membership is active. This is a community tool by Silk Nodes; all
          rewards and terms are set by tx.market.
        </div>
        <div className="ref-cta-row">
          <a className="ref-btn-primary" href="https://tx.market" target="_blank" rel="noopener noreferrer">Open tx.market</a>
        </div>
      </div>
    </div>
  );
}
