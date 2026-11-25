"use client";

// Validator picker for the staking calculator: a button that opens a
// searchable list. Each row shows the validator's commission and what the
// current amount earns with it, so the list is a comparison and not only a
// way to choose.
//
// The list is rendered into <body>. Panels clip their overflow (rounded
// corners over a backdrop blur), so a list inside one would be cut off at
// the panel's edge. It is positioned in page coordinates, which keeps it
// attached to the button while the page scrolls.
//
// Keyboard follows the combobox pattern: arrows move, Enter picks, Escape
// closes, and focus returns to the button.

import { useId, useRef, useState } from "react";
import { createPortal } from "react-dom";

export interface PickerOption {
  key: string;
  name: string;
  /** As a fraction, 0.05 for 5%. */
  commission: number;
  /** Right-hand figure for the row, already formatted. */
  detail: string;
}

export default function ValidatorPicker({
  options, value, onChange, disabled,
}: {
  options: PickerOption[];
  value: string;
  onChange: (key: string) => void;
  disabled?: boolean;
}) {
  const id = useId();
  const trigger = useRef<HTMLButtonElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number; width: number } | null>(null);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  // Focusing the search box on a phone opens the keyboard over the list, so
  // it is only focused for a mouse or trackpad.
  const [focusSearch, setFocusSearch] = useState(true);

  const selected = options.find((o) => o.key === value) ?? options[0];
  const q = query.trim().toLowerCase();
  const shown = q ? options.filter((o) => o.name.toLowerCase().includes(q)) : options;
  const optionId = (i: number) => `${id}-opt-${i}`;

  // Keep the highlighted row inside the list's own scroll area. Scrolls the
  // list only: scrollIntoView would also move the page.
  const reveal = (i: number) => requestAnimationFrame(() => {
    const el = document.getElementById(optionId(i));
    const list = el?.parentElement;
    if (!el || !list) return;
    if (el.offsetTop < list.scrollTop) list.scrollTop = el.offsetTop;
    else if (el.offsetTop + el.offsetHeight > list.scrollTop + list.clientHeight) list.scrollTop = el.offsetTop + el.offsetHeight - list.clientHeight;
  });

  const open = () => {
    const r = trigger.current?.getBoundingClientRect();
    if (!r) return;
    const at = Math.max(0, options.findIndex((o) => o.key === value));
    setQuery("");
    setActive(at);
    setFocusSearch(window.matchMedia("(pointer: fine)").matches);
    setPos({ top: r.bottom + window.scrollY + 6, left: r.left + window.scrollX, width: r.width });
    reveal(at);
  };
  const close = () => {
    setPos(null);
    trigger.current?.focus();
  };
  const pick = (key: string) => {
    onChange(key);
    close();
  };
  const move = (to: number) => {
    const i = Math.min(shown.length - 1, Math.max(0, to));
    setActive(i);
    reveal(i);
  };

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") { e.preventDefault(); move(active + 1); }
    else if (e.key === "ArrowUp") { e.preventDefault(); move(active - 1); }
    else if (e.key === "Enter") { e.preventDefault(); if (shown[active]) pick(shown[active].key); }
    else if (e.key === "Escape" || e.key === "Tab") { e.preventDefault(); close(); }
  };

  return (
    <>
      <button
        ref={trigger}
        type="button"
        className="earn-picker"
        disabled={disabled || !selected}
        aria-haspopup="listbox"
        aria-expanded={pos !== null}
        aria-label={selected ? `Validator: ${selected.name}, ${(selected.commission * 100).toFixed(1)}% commission` : "Validator"}
        onClick={() => (pos ? close() : open())}
        onKeyDown={(e) => { if (e.key === "ArrowDown" && !pos) { e.preventDefault(); open(); } }}
      >
        <span className="earn-picker-name">{selected ? selected.name : "..."}</span>
        {selected && <span className="earn-picker-rate">{(selected.commission * 100).toFixed(1)}% commission</span>}
        <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true" style={{ flex: "none", transform: pos ? "rotate(180deg)" : undefined }}>
          <path d="M2.5 4.5 6 8l3.5-3.5" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>

      {pos && typeof document !== "undefined" && createPortal(
        <>
          <div style={{ position: "fixed", inset: 0, zIndex: 199 }} onClick={close} aria-hidden="true" />
          <div className="earn-pop" style={{ top: pos.top, left: pos.left, width: pos.width }} onKeyDown={onKey}>
            <input
              type="text"
              className="earn-pop-search"
              role="combobox"
              aria-expanded="true"
              aria-controls={`${id}-list`}
              aria-activedescendant={shown[active] ? optionId(active) : undefined}
              aria-label="Search validators"
              placeholder={`Search ${options.length - 1} validators`}
              autoComplete="off"
              autoFocus={focusSearch}
              value={query}
              onChange={(e) => { setQuery(e.target.value); setActive(0); reveal(0); }}
            />
            <div id={`${id}-list`} role="listbox" aria-label="Validators" className="earn-pop-list">
              {shown.length === 0 && <div className="earn-pop-empty">No validator matches that search.</div>}
              {shown.map((o, i) => (
                <div
                  key={o.key}
                  id={optionId(i)}
                  role="option"
                  aria-selected={o.key === value}
                  data-active={i === active}
                  className="earn-opt"
                  onMouseMove={() => { if (i !== active) setActive(i); }}
                  onClick={() => pick(o.key)}
                >
                  <span className="earn-opt-name">{o.name}</span>
                  <span className="earn-opt-rate">{(o.commission * 100).toFixed(1)}%</span>
                  <span className="earn-opt-detail">{o.detail}</span>
                </div>
              ))}
            </div>
          </div>
        </>,
        document.body,
      )}
    </>
  );
}
