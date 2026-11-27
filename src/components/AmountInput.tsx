"use client";

// An amount field that groups thousands while you type: 10000 reads 10,000.
//
// The parent holds the plain value (digits and at most one dot), so nothing
// downstream has to strip separators before doing arithmetic. Grouping is
// display only.

import { useRef } from "react";
import { flushSync } from "react-dom";
import { cleanAmount, groupAmount } from "@/lib/earn-math";

export default function AmountInput({
  value, onChange, unit, ariaLabel, height = 56, fontSize = "1.4rem",
}: {
  /** Plain value: digits and at most one dot. */
  value: string;
  onChange: (plain: string) => void;
  unit: string;
  ariaLabel: string;
  height?: number;
  fontSize?: string;
}) {
  const ref = useRef<HTMLInputElement>(null);

  // Regrouping moves characters, and a controlled input answers that by
  // sending the caret to the end. Count the digits left of the caret before
  // the change and put it back after the same number of digits.
  //
  // Placed twice. Once straight after a synchronous render, so the next
  // keystroke of a fast typist lands in the right place. Once on the next
  // frame, for a keystroke that changes nothing (a letter): React restores
  // the field after this handler returns, and that also moves the caret.
  const change = (e: React.ChangeEvent<HTMLInputElement>) => {
    const text = e.target.value;
    const caret = e.target.selectionStart ?? text.length;
    const before = cleanAmount(text.slice(0, caret)).length;
    const plain = cleanAmount(text);
    flushSync(() => onChange(plain));
    const shown = groupAmount(plain);
    let at = 0;
    for (let seen = 0; at < shown.length && seen < before; at++) if (shown[at] !== ",") seen++;
    const place = () => {
      if (ref.current && document.activeElement === ref.current) ref.current.setSelectionRange(at, at);
    };
    place();
    requestAnimationFrame(place);
  };

  return (
    <div style={{ position: "relative" }}>
      <input
        ref={ref}
        type="text"
        inputMode="decimal"
        autoComplete="off"
        aria-label={ariaLabel}
        value={groupAmount(value)}
        onChange={change}
        style={{
          width: "100%", height, padding: `0 ${unit.length * 10 + 30}px 0 14px`, fontSize, fontWeight: 700, fontFamily: "var(--font-mono)",
          borderRadius: 12, border: "1px solid var(--glass-border)", background: "var(--glass-bg)", color: "var(--text-dark)",
        }}
      />
      <span style={{ position: "absolute", right: 14, top: "50%", transform: "translateY(-50%)", fontSize: "0.8rem", color: "var(--text-light)", pointerEvents: "none" }}>{unit}</span>
    </div>
  );
}
