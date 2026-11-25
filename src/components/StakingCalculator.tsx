"use client";

// Staking rewards after a validator's commission.
//
// Base APR comes from the chain snapshot every other page reads, so a figure
// here always matches the validators table. During the PSE pause (6 Nov 2026
// to 6 Dec 2027) issuance is fixed, so APR only moves with total stake; the
// estimate holds as long as stake stays roughly where it is, which the copy
// says rather than implies.
//
// The default is neutral: the stake-weighted average commission of the
// active set, not Silk Nodes. Silk Nodes is one row in the comparison.

import { Fragment, useMemo, useState } from "react";
import Link from "next/link";
import type { ValidatorSetEntry } from "@/lib/types";
import { SILK_NODES_VALIDATOR } from "@/lib/chain-config";
import { formatCompact } from "@/lib/ui-format";
import Shareable, { useInSnapshot } from "@/components/share/Shareable";
import AmountInput from "@/components/AmountInput";
import { DAYS_PER_YEAR, amountOf, averageCommission, cleanAmount, gridStep, stakingReward } from "@/lib/earn-math";
import ValidatorPicker, { type PickerOption } from "@/components/ValidatorPicker";
import { useQueryParam } from "@/hooks/useQueryParam";

const AVG = "avg";
const PERIODS: { days: number; label: string }[] = [
  { days: 30, label: "30 days" },
  { days: 90, label: "90 days" },
  { days: 365, label: "1 year" },
];
const PRESETS: [number, string][] = [[1_000, "1K"], [10_000, "10K"], [100_000, "100K"], [1_000_000, "1M"]];

const fmtTX = (n: number) => (n >= 1e4 ? formatCompact(n) : n.toLocaleString("en-US", { maximumFractionDigits: n < 10 ? 2 : 0 }));
const fmtUsd = (n: number) => (n >= 1000 ? `$${n.toLocaleString("en-US", { maximumFractionDigits: 0 })}` : n >= 0.01 ? `$${n.toFixed(2)}` : "< $0.01");

const label: React.CSSProperties = { fontSize: "0.58rem", color: "var(--text-light)", textTransform: "uppercase", letterSpacing: "0.05em" };
const pill = (color: string): React.CSSProperties => ({
  padding: "4px 10px", borderRadius: 999, fontSize: "0.64rem", fontFamily: "var(--font-mono)", fontWeight: 700,
  color, border: `1px solid ${color}`, whiteSpace: "nowrap",
});
const chip = (on: boolean): React.CSSProperties => ({
  padding: "6px 12px", borderRadius: 999, fontSize: "0.68rem", fontFamily: "var(--font-mono)", cursor: "pointer",
  border: `1px solid ${on ? "var(--text-accent)" : "var(--glass-border)"}`,
  background: "transparent", color: on ? "var(--text-accent)" : "var(--text-dark)",
  fontWeight: on ? 700 : 400, whiteSpace: "nowrap",
});

export default function StakingCalculator({
  validators, baseApr, price, initialAmount, dilutionPct,
}: {
  validators: ValidatorSetEntry[] | null;
  /** Base staking APR before commission, as a percentage (24.4 = 24.4%). */
  baseApr: number;
  price: number;
  initialAmount?: number;
  /** Yearly issuance as a share of circulating supply, percent. */
  dilutionPct?: number | null;
}) {
  // ?validator=corevaloper1... preselects a validator.
  const fromUrl = useQueryParam("validator");
  // ?amount=25000 prefills the field (the Today page's Earn card sends it).
  // Typing takes over from the address.
  const amountFromUrl = cleanAmount(useQueryParam("amount") ?? "");
  const [typed, setAmountText] = useState<string | null>(null);
  const amountText = typed ?? (amountOf(amountFromUrl) > 0 ? amountFromUrl : initialAmount ? String(Math.round(initialAmount)) : "10000");
  const [picked, setPicked] = useState<string | null>(null);
  const [days, setDays] = useState(365);
  const [compound, setCompound] = useState(false);

  const active = useMemo(
    () => (validators ?? []).filter((v) => v.tokens > 0).sort((a, b) => b.tokens - a.tokens),
    [validators],
  );
  const avg = useMemo(() => averageCommission(active), [active]);
  const choice = picked ?? (fromUrl && active.some((v) => v.operatorAddress === fromUrl) ? fromUrl : AVG);
  const chosen = active.find((v) => v.operatorAddress === choice) ?? null;
  const commission = chosen ? chosen.commission : avg ?? 0;
  const silk = active.find((v) => v.operatorAddress === SILK_NODES_VALIDATOR) ?? null;

  const amount = amountOf(amountText);
  const apr = (baseApr / 100) * (1 - commission);
  const reward = stakingReward(amount, apr, days, compound);
  const perDay = stakingReward(amount, apr, 1, false);
  const effectivePct = amount > 0 ? (stakingReward(amount, apr, DAYS_PER_YEAR, compound) / amount) * 100 : apr * 100;

  // The chosen row plus the two reference points. Deduplicated, so picking
  // Silk Nodes does not show it twice.
  const rows = [
    { key: AVG, name: "Network average", c: avg },
    ...(silk ? [{ key: silk.operatorAddress, name: silk.moniker, c: silk.commission }] : []),
    ...(chosen && chosen.operatorAddress !== silk?.operatorAddress ? [{ key: chosen.operatorAddress, name: chosen.moniker, c: chosen.commission }] : []),
  ].filter((r) => r.c !== null) as { key: string; name: string; c: number }[];

  const ready = baseApr > 0 && active.length > 0;

  // What the current amount earns at a given commission, for the picker rows
  // and the comparison line.
  const rewardWith = (c: number) => stakingReward(amount, (baseApr / 100) * (1 - c), days, compound);
  const rowDetail = (c: number) => (amount > 0 && ready ? `+${fmtTX(rewardWith(c))} TX` : "");
  const options: PickerOption[] = [
    ...(avg !== null ? [{ key: AVG, name: "Network average", commission: avg, detail: rowDetail(avg) }] : []),
    ...active.map((v) => ({ key: v.operatorAddress, name: v.moniker, commission: v.commission, detail: rowDetail(v.commission) })),
  ];
  // Two points along the way, far enough from the left edge to label: the
  // quarter and half marks of a year, a third and two thirds of 90 days.
  const marks = [7, 14, 30, 60, 90, 180]
    .filter((d) => d / days >= 0.15 && d / days <= 0.7)
    .slice(-2)
    .map((d) => ({ day: d, value: stakingReward(amount, apr, d, compound) }));

  const periodLabel = PERIODS.find((p) => p.days === days)?.label;
  const grossApr = baseApr / 100;
  const series = Array.from({ length: 49 }, (_, i) => {
    const d = (days * i) / 48;
    return {
      day: d,
      net: stakingReward(amount, apr, d, false),
      gross: stakingReward(amount, grossApr, d, false),
      restaked: stakingReward(amount, apr, d, true),
    };
  });
  const simpleReward = stakingReward(amount, apr, days, false);
  const restakeExtra = stakingReward(amount, apr, days, true) - simpleReward;
  const commissionPaid = stakingReward(amount, grossApr, days, false) - simpleReward;
  const whoLabel = chosen ? chosen.moniker : "Network average";

  return (
    <div className="grid-12" style={{ marginBottom: 16, alignItems: "stretch" }}>
      {/* Left: the inputs */}
      <div className="col-5" style={{ display: "flex" }}>
        <div className="panel" style={{ flex: 1, display: "flex", flexDirection: "column", gap: 18, justifyContent: "space-between" }}>
          <div>
            <div style={label}>Amount to stake</div>
            <div style={{ marginTop: 6 }}>
              <AmountInput value={amountText} onChange={setAmountText} unit="TX" ariaLabel="Amount of TX to stake" />
            </div>
            <div style={{ display: "flex", gap: 6, marginTop: 8, flexWrap: "wrap", alignItems: "center" }}>
              {PRESETS.map(([p, t]) => (
                <button key={p} type="button" aria-pressed={amount === p} style={chip(amount === p)} onClick={() => setAmountText(String(p))}>{t}</button>
              ))}
              {price > 0 && amount > 0 && (
                <span style={{ marginLeft: "auto", fontSize: "0.68rem", fontFamily: "var(--font-mono)", color: "var(--text-medium)", whiteSpace: "nowrap" }}>≈ {fmtUsd(amount * price)}</span>
              )}
            </div>
          </div>

          <div>
            <div style={label}>Validator</div>
            <ValidatorPicker options={options} value={choice} onChange={setPicked} disabled={!ready} />
          </div>

          <div>
            <div style={label}>Period</div>
            <div style={{ display: "flex", gap: 6, marginTop: 6, flexWrap: "wrap", alignItems: "center" }}>
              {PERIODS.map((p) => (
                <button key={p.days} type="button" aria-pressed={days === p.days} style={chip(days === p.days)} onClick={() => setDays(p.days)}>{p.label}</button>
              ))}
            </div>
            <label style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 14, width: "fit-content", fontSize: "0.72rem", color: "var(--text-dark)", cursor: "pointer" }}>
              <button type="button" role="switch" aria-checked={compound} className="earn-switch" onClick={() => setCompound((c) => !c)} />
              Restake rewards daily
            </label>
          </div>

          <div>
            <div style={label}>Where the {ready ? `${baseApr.toFixed(2)}%` : ""} goes</div>
            <div style={{ display: "flex", height: 14, borderRadius: 7, overflow: "hidden", marginTop: 8, background: "var(--glass-border)" }}>
              <div style={{ width: `${(1 - commission) * 100}%`, background: "var(--text-accent)" }} />
              <div style={{ width: `${commission * 100}%`, minWidth: commission > 0 ? 3 : 0, background: "var(--calc-commission)" }} />
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 10, marginTop: 8, fontSize: "0.68rem", fontFamily: "var(--font-mono)" }}>
              <span style={{ color: "var(--text-accent)", fontWeight: 700 }}>{ready ? `${(apr * 100).toFixed(2)}% to you` : "..."}</span>
              <span style={{ color: "var(--warn-text)", fontWeight: 700 }}>{ready ? `${((grossApr - apr) * 100).toFixed(2)}% commission` : ""}</span>
            </div>
          </div>

          <div style={{ fontSize: "0.62rem", lineHeight: 1.6, color: "var(--text-light)", paddingTop: 14, borderTop: "1px solid var(--glass-border)" }}>
            Base APR {ready ? `${baseApr.toFixed(2)}%` : "..."} before commission, read from the chain.
            Inflation is fixed until December 2027, so APR falls when more TX is staked and rises when stake leaves.
            {dilutionPct ? ` Unstaked TX is diluted about ${dilutionPct.toFixed(1)}% a year.` : ""} Unstaking takes 7 days.
          </div>
        </div>
      </div>

      {/* Right: the result */}
      <div className="col-7" style={{ display: "flex" }}>
        <div className="panel" style={{ flex: 1, display: "flex", flexDirection: "column" }}>
          <div className="calc-share">
          <Shareable
            title="TX staking estimate"
            subtitle={`${amount.toLocaleString("en-US", { maximumFractionDigits: 2 })} TX · ${whoLabel} · ${periodLabel}`}
            caption={`Base APR ${baseApr.toFixed(2)}% read from the chain, ${(commission * 100).toFixed(1)}% commission. Estimate only.`}
            cameraOffset={{ top: -4, right: 0 }}
          >
          <div style={{ ...label, paddingRight: 48 }}>
            Rewards over {periodLabel}{chosen ? ` with ${chosen.moniker}` : ", network average commission"}
          </div>
          <div style={{ display: "flex", alignItems: "baseline", gap: 12, flexWrap: "wrap", marginTop: 8 }}>
            {ready && amount <= 0 ? (
              <span style={{ fontSize: "1.1rem", color: "var(--text-medium)", padding: "14px 0" }}>Enter an amount to stake.</span>
            ) : (
              <>
                <span style={{ fontSize: "3rem", fontWeight: 800, lineHeight: 1, letterSpacing: "-0.02em", fontFamily: "var(--font-mono)", color: "var(--text-accent)", textShadow: "0 0 28px rgba(177,252,3,0.28)" }}>
                  {ready ? `+${fmtTX(reward)}` : "..."}
                </span>
                <span style={{ fontSize: "1rem", color: "var(--text-light)" }}>TX</span>
                {ready && price > 0 && <span style={{ fontSize: "1rem", color: "var(--text-medium)" }}>≈ {fmtUsd(reward * price)}</span>}
              </>
            )}
          </div>
          {ready && amount > 0 && (
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 10 }}>
              <span style={pill("var(--warn-text)")}>{fmtTX(commissionPaid)} TX to the validator</span>
              {compound && <span style={pill("var(--calc-restake)")}>+{fmtTX(restakeExtra)} TX extra from restaking</span>}
            </div>
          )}

          <GrowthChart series={series} marks={marks} ready={ready && amount > 0} compound={compound} price={price} endLabel={periodLabel ?? ""} />
          </Shareable>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 12, marginTop: 14 }}>
            {[
              ["a day", ready ? `+${fmtTX(perDay)}` : "...", "TX"],
              ["a month", ready ? `+${fmtTX(stakingReward(amount, apr, DAYS_PER_YEAR / 12, compound))}` : "...", "TX"],
              ["a year, net", ready ? `${effectivePct.toFixed(2)}%` : "...", ""],
            ].map(([k, v, unit]) => (
              <div key={k}>
                <div style={{ fontSize: "1rem", fontWeight: 700, fontFamily: "var(--font-mono)", color: "var(--text-dark)" }}>
                  {v}{unit && ready && <span style={{ fontSize: "0.68rem", fontWeight: 400, color: "var(--text-light)" }}> {unit}</span>}
                </div>
                <div style={{ fontSize: "0.6rem", color: "var(--text-light)", marginTop: 2 }}>{k}</div>
              </div>
            ))}
          </div>

          {ready && amount > 0 && (
            <div style={{ marginTop: 14, paddingTop: 12, borderTop: "1px solid var(--glass-border)", display: "flex", gap: "10px 18px", flexWrap: "wrap", alignItems: "center", fontSize: "0.68rem", color: "var(--text-medium)" }}>
              {rows.map((r) => (
                <span key={r.key}>
                  {r.name} <span style={{ fontFamily: "var(--font-mono)", color: "var(--text-dark)", fontWeight: r.key === choice ? 700 : 400 }}>+{fmtTX(rewardWith(r.c))}</span>
                  <span style={{ color: "var(--text-light)" }}> at {(r.c * 100).toFixed(1)}%</span>
                </span>
              ))}
              {/* The next step. A chosen validator's page has the delegate
                  button; with no choice made, the table is where to make one. */}
              <span style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 14, minWidth: 0, maxWidth: "100%" }}>
                {chosen && <Link href="/validators" className="link" style={{ whiteSpace: "nowrap" }}>Compare validators</Link>}
                <Link
                  href={chosen ? `/validators/${chosen.operatorAddress}` : "/validators"}
                  className="btn-olive"
                  style={{
                    display: "inline-block", padding: "9px 16px", borderRadius: 10, fontSize: "0.72rem", fontWeight: 700, textDecoration: "none",
                    maxWidth: 280, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                  }}
                >
                  {chosen ? `Stake with ${chosen.moniker}` : "Choose a validator"}
                </Link>
              </span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

type Point = { day: number; net: number; gross: number; restaked: number };
type Mark = { day: number; value: number };

// Rewards from today to the end of the period. Lime is what you keep, the
// orange band above it is the validator's commission, and with restaking on
// a yellow line shows the compounded path.
//
// The scale and two points along the way are printed on the chart, so it can
// be read without hovering; hover still reads any single day. Labels are
// HTML over the SVG because the SVG is stretched to the panel and would
// stretch its text with it.
function GrowthChart({ series, marks, ready, compound, price, endLabel }: { series: Point[]; marks: Mark[]; ready: boolean; compound: boolean; price: number; endLabel: string }) {
  const [hover, setHover] = useState<number | null>(null);
  // On the page the chart takes the card's spare height; in the exported PNG
  // there is no neighbour to match, so it gets a fixed one.
  const snapshot = useInSnapshot();
  const max = Math.max(...series.map((p) => Math.max(p.gross, compound ? p.restaked : 0)), 1e-9);
  const total = series[series.length - 1].day || 1;
  const x = (i: number) => (i / (series.length - 1)) * 100;
  const y = (v: number) => 40 - (v / max) * 36;
  const top = (v: number) => `${(y(v) / 40) * 100}%`;
  const left = (day: number) => (day / total) * 100;
  const line = (k: keyof Point) => series.map((p, i) => `${x(i)},${y(p[k])}`).join(" ");
  const band = `${series.map((p, i) => `${x(i)},${y(p.gross)}`).join(" ")} ${[...series].reverse().map((p, i) => `${x(series.length - 1 - i)},${y(p.net)}`).join(" ")}`;
  const step = ready ? gridStep(max) : 0;
  const ticks = step > 0 ? Array.from({ length: Math.floor(max / step) }, (_, i) => (i + 1) * step) : [];
  const shownMarks = ready ? marks : [];
  const h = hover !== null ? series[hover] : null;
  // Mouse hovers; a finger taps or drags sideways, and the card stays until
  // the next touch, so the value can be read without a hand over it.
  const read = (e: React.PointerEvent<HTMLDivElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    const t = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width));
    setHover(Math.round(t * (series.length - 1)));
  };
  const faint = { stroke: "var(--text-light)" };

  return (
    <div style={{ marginTop: 18, flex: 1, display: "flex", flexDirection: "column" }}>
      <div
        style={{ position: "relative", flex: snapshot ? "none" : "1 1 0", height: snapshot ? 220 : undefined, minHeight: 150, touchAction: "pan-y" }}
        onPointerLeave={(e) => { if (e.pointerType === "mouse") setHover(null); }}
        onPointerDown={read}
        onPointerMove={read}
      >
        <svg viewBox="0 0 100 40" preserveAspectRatio="none" style={{ position: "absolute", inset: 0, width: "100%", height: "100%", opacity: ready ? 1 : 0.25 }} aria-hidden="true">
          {ticks.map((t) => (
            <line key={t} x1="0" y1={y(t)} x2="100" y2={y(t)} style={faint} opacity="0.28" strokeWidth="1" strokeDasharray="2 4" vectorEffect="non-scaling-stroke" />
          ))}
          <polygon points={`0,40 ${line("net")} 100,40`} style={{ fill: "var(--text-accent)" }} opacity="0.16" />
          <polygon points={band} style={{ fill: "var(--calc-commission)" }} opacity="0.35" />
          <polyline points={line("net")} fill="none" style={{ stroke: "var(--text-accent)" }} strokeWidth="2" vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
          {compound && <polyline points={line("restaked")} fill="none" style={{ stroke: "var(--calc-restake)" }} strokeWidth="2" strokeDasharray="5 4" vectorEffect="non-scaling-stroke" />}
          <line x1="0" y1="40" x2="100" y2="40" style={faint} opacity="0.4" strokeWidth="1" vectorEffect="non-scaling-stroke" />
          {shownMarks.map((m) => (
            <line key={m.day} x1={left(m.day)} y1="0" x2={left(m.day)} y2={y(m.value)} style={faint} opacity="0.5" strokeWidth="1" strokeDasharray="2 3" vectorEffect="non-scaling-stroke" />
          ))}
          {h && <line x1={x(hover!)} y1="0" x2={x(hover!)} y2="40" style={faint} strokeWidth="1" strokeDasharray="2 3" vectorEffect="non-scaling-stroke" />}
        </svg>

        {ticks.map((t) => (
          <span key={t} style={{ position: "absolute", left: 0, top: top(t), transform: "translateY(-100%)", paddingBottom: 2, fontSize: "0.56rem", fontFamily: "var(--font-mono)", color: "var(--text-light)", whiteSpace: "nowrap", pointerEvents: "none" }}>
            {fmtTX(t)} TX
          </span>
        ))}
        {shownMarks.map((m) => (
          <Fragment key={m.day}>
            <span style={{
              position: "absolute", left: `${left(m.day)}%`, top: top(m.value), width: 8, height: 8, borderRadius: "50%",
              transform: "translate(-50%, -50%)", pointerEvents: "none",
              background: compound ? "var(--calc-restake)" : "var(--text-accent)",
            }} />
            <span style={{ position: "absolute", left: `${left(m.day)}%`, top: 0, transform: "translateX(6px)", fontSize: "0.58rem", lineHeight: 1.35, color: "var(--text-light)", whiteSpace: "nowrap", pointerEvents: "none" }}>
              {m.day} days
              <br />
              <span style={{ fontFamily: "var(--font-mono)", fontWeight: 700, color: "var(--text-dark)" }}>+{fmtTX(m.value)}</span>
            </span>
          </Fragment>
        ))}

        {h && ready && (
          <div style={{
            position: "absolute", top: 4, pointerEvents: "none",
            left: `${x(hover!)}%`, transform: `translateX(${x(hover!) > 60 ? "-105%" : "8px"})`,
            background: "rgba(15, 27, 7, 0.92)", color: "#f4f1eb", padding: "8px 12px", borderRadius: 8,
            border: "1px solid rgba(177, 252, 3, 0.3)", boxShadow: "0 4px 12px rgba(0,0,0,0.3)",
            fontSize: "0.68rem", fontFamily: "var(--font-mono)", whiteSpace: "nowrap",
          }}>
            <div style={{ color: "rgba(177, 252, 3, 0.75)", fontWeight: 600, marginBottom: 4 }}>day {Math.round(h.day)}</div>
            <div style={{ color: "#B1FC03" }}>+{fmtTX(h.net)} TX{price > 0 ? ` ≈ ${fmtUsd(h.net * price)}` : ""}</div>
            {compound && <div style={{ color: "#EBF450" }}>restaked +{fmtTX(h.restaked)} TX</div>}
            <div style={{ color: "#FFB078" }}>commission {fmtTX(h.gross - h.net)} TX</div>
          </div>
        )}
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", marginTop: 6, fontSize: "0.6rem", fontFamily: "var(--font-mono)", color: "var(--text-light)" }}>
        <span>today</span>
        <span style={{ display: "flex", gap: 12 }}>
          <span><span style={{ color: "var(--text-accent)" }}>■</span> yours</span>
          <span><span style={{ color: "var(--calc-commission)" }}>■</span> commission</span>
          {compound && <span><span style={{ color: "var(--calc-restake)" }}>┅</span> restaked</span>}
        </span>
        <span>{endLabel}</span>
      </div>
    </div>
  );
}

/** A compact version for a validator's own page: amount in, monthly and yearly out. */
export function ValidatorRewardBox({ operatorAddress, delegatorApr }: { operatorAddress: string; delegatorApr: number | null }) {
  const [amountText, setAmountText] = useState("10000");
  const amount = amountOf(amountText);
  const apr = (delegatorApr ?? 0) / 100;
  const year = stakingReward(amount, apr, DAYS_PER_YEAR, false);
  const month = stakingReward(amount, apr, DAYS_PER_YEAR / 12, false);
  // A tinted card, the only one in the rail, so it reads as something to use
  // rather than one more stat row.
  return (
    <div style={{
      marginTop: 14, padding: "14px 16px", borderRadius: 14,
      background: "rgba(177,252,3,0.07)", border: "1px solid rgba(177,252,3,0.28)",
    }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 10 }}>
        <span style={{ fontSize: "0.78rem", fontWeight: 700, color: "var(--text-dark)" }}>Estimate your rewards</span>
        <span style={{ fontSize: "0.6rem", fontFamily: "var(--font-mono)", color: "var(--text-light)" }}>{apr > 0 ? `${(apr * 100).toFixed(2)}% APR` : ""}</span>
      </div>

      <div style={{ marginTop: 10 }}>
        <AmountInput value={amountText} onChange={setAmountText} unit="TX" ariaLabel="Amount of TX to stake" height={42} fontSize="0.95rem" />
      </div>
      <div style={{ display: "flex", gap: 6, marginTop: 8, flexWrap: "wrap" }}>
        {PRESETS.slice(0, 3).map(([p, t]) => (
          <button key={p} type="button" aria-pressed={amount === p} style={chip(amount === p)} onClick={() => setAmountText(String(p))}>{t}</button>
        ))}
      </div>

      <div style={{ marginTop: 14 }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: 8, flexWrap: "wrap" }}>
          <span style={{ fontSize: "1.6rem", fontWeight: 800, lineHeight: 1, fontFamily: "var(--font-mono)", color: "var(--text-accent)" }}>
            {apr > 0 ? (amount > 0 ? `+${fmtTX(year)}` : "0") : "..."}
          </span>
          <span style={{ fontSize: "0.72rem", color: "var(--text-light)" }}>TX a year</span>
        </div>
        <div style={{ marginTop: 6, fontSize: "0.68rem", fontFamily: "var(--font-mono)", color: "var(--text-medium)" }}>
          {apr > 0 && amount > 0 ? `+${fmtTX(month)} TX a month, after commission` : ""}
        </div>
      </div>

      <Link
        href={`/calculator?validator=${operatorAddress}`}
        className="btn-olive"
        style={{ display: "block", textAlign: "center", marginTop: 14, padding: "9px 12px", borderRadius: 10, fontSize: "0.72rem", fontWeight: 700, textDecoration: "none" }}
      >
        Open full calculator
      </Link>
    </div>
  );
}
