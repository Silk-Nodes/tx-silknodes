"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { createPortal } from "react-dom";

interface TooltipProps {
  text: string;
  children?: React.ReactNode;
  position?: "top" | "bottom";
}

export default function Tooltip({ text, children, position = "top" }: TooltipProps) {
  const [visible, setVisible] = useState(false);
  const [coords, setCoords] = useState<{ top: number; left: number } | null>(null);
  const wrapperRef = useRef<HTMLSpanElement>(null);

  const updatePosition = useCallback(() => {
    if (!wrapperRef.current) return;
    const rect = wrapperRef.current.getBoundingClientRect();
    const top = position === "top" ? rect.top - 8 : rect.bottom + 8;

    // The bubble is centred on the trigger and translated -50%, so a trigger
    // near either edge pushes half the bubble off screen. Measured at 393px
    // wide: a tooltip on a right-hand column ran to 430px against a 393px
    // viewport, so the end of the sentence was unreadable. Clamp the centre
    // so the bubble always lands inside the viewport.
    //
    // HALF_MAX mirrors the 280px max-width in globals.css. Using the maximum
    // rather than the measured width can nudge a narrow bubble further from
    // its trigger than strictly needed, which is a much smaller problem than
    // text disappearing off the edge.
    const HALF_MAX = 140;
    const MARGIN = 10;
    const raw = rect.left + rect.width / 2;
    const left = Math.min(
      Math.max(raw, HALF_MAX + MARGIN),
      window.innerWidth - HALF_MAX - MARGIN,
    );
    setCoords({ top, left });
  }, [position]);

  useEffect(() => {
    if (!visible) return;
    updatePosition();
    const handleOutside = (e: MouseEvent | TouchEvent) => {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
        setVisible(false);
      }
    };
    document.addEventListener("mousedown", handleOutside);
    document.addEventListener("touchstart", handleOutside);
    window.addEventListener("scroll", () => setVisible(false), true);
    return () => {
      document.removeEventListener("mousedown", handleOutside);
      document.removeEventListener("touchstart", handleOutside);
      window.removeEventListener("scroll", () => setVisible(false), true);
    };
  }, [visible, updatePosition]);

  return (
    <>
      <span
        ref={wrapperRef}
        className="tooltip-wrapper"
        onMouseEnter={() => setVisible(true)}
        onMouseLeave={() => setVisible(false)}
        onClick={(e) => {
          e.stopPropagation();
          setVisible((v) => !v);
        }}
      >
        {children || <span className="tooltip-icon">i</span>}
      </span>
      {visible && coords && typeof document !== "undefined" &&
        createPortal(
          <span
            className={`tooltip-bubble tooltip-${position}`}
            style={{
              position: "fixed",
              top: position === "top" ? coords.top : coords.top,
              left: coords.left,
              transform: position === "top"
                ? "translateX(-50%) translateY(-100%)"
                : "translateX(-50%)",
            }}
          >
            {text}
          </span>,
          document.body
        )
      }
    </>
  );
}
