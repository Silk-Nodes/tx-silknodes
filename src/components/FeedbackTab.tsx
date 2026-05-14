"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

type Status = "open" | "planned" | "in_progress" | "shipped" | "declined";

interface FeatureRequest {
  id: number;
  title: string;
  description: string;
  status: Status;
  voteCount: number;
  createdAt: string;
  hasVoted: boolean;
}

const STATUS_LABELS: Record<Status, string> = {
  open: "Open",
  planned: "Planned",
  in_progress: "In Progress",
  shipped: "Shipped",
  declined: "Declined",
};

const STATUS_FILTERS: { id: "all" | Status; label: string }[] = [
  { id: "all", label: "All" },
  { id: "open", label: "Open" },
  { id: "planned", label: "Planned" },
  { id: "in_progress", label: "In Progress" },
  { id: "shipped", label: "Shipped" },
];

const SORT_OPTIONS: { id: "votes" | "newest"; label: string }[] = [
  { id: "votes", label: "Most voted" },
  { id: "newest", label: "Newest" },
];

// hCaptcha site key is exposed at build time. Optional in dev — if
// unset, the form just doesn't render the captcha widget. Production
// MUST set both NEXT_PUBLIC_HCAPTCHA_SITE_KEY and HCAPTCHA_SECRET_KEY.
const HCAPTCHA_SITE_KEY = process.env.NEXT_PUBLIC_HCAPTCHA_SITE_KEY || "";

function formatRelativeTime(iso: string): string {
  const then = new Date(iso).getTime();
  const sec = Math.max(0, Math.floor((Date.now() - then) / 1000));
  if (sec < 60) return `${sec}s ago`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.floor(hr / 24);
  if (day < 30) return `${day}d ago`;
  const mo = Math.floor(day / 30);
  if (mo < 12) return `${mo}mo ago`;
  return `${Math.floor(mo / 12)}y ago`;
}

export default function FeedbackTab() {
  const [items, setItems] = useState<FeatureRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<"all" | Status>("all");
  const [sort, setSort] = useState<"votes" | "newest">("votes");
  const [formOpen, setFormOpen] = useState(false);
  const [submitState, setSubmitState] = useState<"idle" | "submitting" | "ok" | "error">("idle");
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [hCaptchaToken, setHCaptchaToken] = useState<string | null>(null);
  const captchaRef = useRef<HTMLDivElement | null>(null);
  const captchaWidgetId = useRef<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const qs = new URLSearchParams();
      if (statusFilter !== "all") qs.set("status", statusFilter);
      qs.set("sort", sort);
      const res = await fetch(`/api/feedback/list?${qs.toString()}`, { cache: "no-store" });
      const data = await res.json();
      setItems(Array.isArray(data.items) ? data.items : []);
    } finally {
      setLoading(false);
    }
  }, [statusFilter, sort]);

  useEffect(() => {
    void load();
  }, [load]);

  // hCaptcha script load + widget mount on form open.
  useEffect(() => {
    if (!formOpen || !HCAPTCHA_SITE_KEY) return;
    const w = window as unknown as { hcaptcha?: { render: (el: HTMLElement, opts: object) => string; reset: (id: string) => void } };
    const mount = () => {
      if (!captchaRef.current || captchaWidgetId.current) return;
      if (!w.hcaptcha) return;
      captchaWidgetId.current = w.hcaptcha.render(captchaRef.current, {
        sitekey: HCAPTCHA_SITE_KEY,
        theme: "dark",
        callback: (token: string) => setHCaptchaToken(token),
        "expired-callback": () => setHCaptchaToken(null),
        "error-callback": () => setHCaptchaToken(null),
      });
    };
    if (w.hcaptcha) {
      mount();
    } else {
      const s = document.createElement("script");
      s.src = "https://js.hcaptcha.com/1/api.js?render=explicit";
      s.async = true;
      s.defer = true;
      s.onload = mount;
      document.head.appendChild(s);
    }
  }, [formOpen]);

  const handleVote = async (id: number) => {
    // Optimistic UI: flip locally, then reconcile with server response.
    setItems((prev) =>
      prev.map((it) =>
        it.id === id
          ? { ...it, hasVoted: !it.hasVoted, voteCount: it.voteCount + (it.hasVoted ? -1 : 1) }
          : it,
      ),
    );
    try {
      const res = await fetch("/api/feedback/vote", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ requestId: id }),
      });
      const data = await res.json();
      if (res.ok && typeof data.voteCount === "number") {
        setItems((prev) =>
          prev.map((it) =>
            it.id === id ? { ...it, voteCount: data.voteCount, hasVoted: data.hasVoted } : it,
          ),
        );
      } else {
        // Reload on failure to recover the true count.
        void load();
      }
    } catch {
      void load();
    }
  };

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setSubmitState("submitting");
    setSubmitError(null);
    const fd = new FormData(e.currentTarget);
    const payload = {
      title: String(fd.get("title") || "").trim(),
      description: String(fd.get("description") || "").trim(),
      // Honeypot — real users leave it blank; bots fill every field.
      website: String(fd.get("website") || ""),
      hcaptchaToken: hCaptchaToken,
    };
    try {
      const res = await fetch("/api/feedback/submit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        setSubmitState("error");
        setSubmitError(err.message || err.error || `submit failed (${res.status})`);
        return;
      }
      setSubmitState("ok");
      e.currentTarget.reset();
      setHCaptchaToken(null);
      const w = window as unknown as { hcaptcha?: { reset: (id: string) => void } };
      if (captchaWidgetId.current && w.hcaptcha) w.hcaptcha.reset(captchaWidgetId.current);
      // Pull fresh list so the new item appears (it's `open` and will be
      // last by default sort=votes; switching sort=newest puts it first).
      void load();
      setTimeout(() => {
        setFormOpen(false);
        setSubmitState("idle");
      }, 1500);
    } catch (err) {
      setSubmitState("error");
      setSubmitError(err instanceof Error ? err.message : "network error");
    }
  };

  const itemsList = useMemo(() => items, [items]);

  return (
    <div className="feedback-tab">
      <header className="feedback-header">
        <div>
          <h1 className="feedback-title">Feature Requests</h1>
          <p className="feedback-sub">
            Got an idea for TX All-in-One? Submit it. Vote on what matters most. The team checks
            this board weekly.
          </p>
        </div>
        <button
          type="button"
          className="feedback-submit-btn"
          onClick={() => setFormOpen((v) => !v)}
        >
          {formOpen ? "Cancel" : "+ Submit an idea"}
        </button>
      </header>

      {formOpen && (
        <form className="feedback-form" onSubmit={handleSubmit}>
          <label className="feedback-form-row">
            <span>Title</span>
            <input
              type="text"
              name="title"
              required
              minLength={10}
              maxLength={120}
              placeholder="Short summary — 10 to 120 characters"
            />
          </label>
          <label className="feedback-form-row">
            <span>Description</span>
            <textarea
              name="description"
              required
              minLength={20}
              maxLength={2000}
              rows={5}
              placeholder="What's the problem? Why does this matter? Any context helps."
            />
          </label>
          {/*
            Honeypot: a real-looking field hidden from sighted users + assistive
            tech via aria-hidden + tabIndex=-1 + inline display:none.
            Bots that auto-fill every input give themselves away here.
          */}
          <input
            type="text"
            name="website"
            tabIndex={-1}
            autoComplete="off"
            aria-hidden="true"
            style={{ position: "absolute", left: "-9999px", top: "-9999px" }}
          />
          {HCAPTCHA_SITE_KEY && (
            <div ref={captchaRef} className="feedback-form-captcha" />
          )}
          <div className="feedback-form-actions">
            <button
              type="submit"
              disabled={submitState === "submitting" || (Boolean(HCAPTCHA_SITE_KEY) && !hCaptchaToken)}
              className="feedback-submit-confirm"
            >
              {submitState === "submitting" ? "Submitting..." : submitState === "ok" ? "Submitted ✓" : "Submit"}
            </button>
            {submitError && <span className="feedback-form-error">{submitError}</span>}
          </div>
        </form>
      )}

      <div className="feedback-filter-row">
        <div className="feedback-status-filter">
          {STATUS_FILTERS.map((f) => (
            <button
              key={f.id}
              type="button"
              className={`feedback-status-chip ${statusFilter === f.id ? "active" : ""}`}
              onClick={() => setStatusFilter(f.id)}
            >
              {f.label}
            </button>
          ))}
        </div>
        <div className="feedback-sort">
          <span>Sort:</span>
          {SORT_OPTIONS.map((s) => (
            <button
              key={s.id}
              type="button"
              className={`feedback-sort-btn ${sort === s.id ? "active" : ""}`}
              onClick={() => setSort(s.id)}
            >
              {s.label}
            </button>
          ))}
        </div>
      </div>

      <div className="feedback-list">
        {loading && itemsList.length === 0 && (
          <div className="feedback-empty">Loading...</div>
        )}
        {!loading && itemsList.length === 0 && (
          <div className="feedback-empty">
            No feature requests yet — be the first to submit one! 💡
          </div>
        )}
        {itemsList.map((item) => (
          <FeedbackCard key={item.id} item={item} onVote={() => handleVote(item.id)} />
        ))}
      </div>
    </div>
  );
}

function FeedbackCard({ item, onVote }: { item: FeatureRequest; onVote: () => void }) {
  const [expanded, setExpanded] = useState(false);
  const shouldClamp = item.description.length > 200;
  const display = expanded || !shouldClamp ? item.description : item.description.slice(0, 200) + "…";

  return (
    <div className={`feedback-card status-${item.status}`}>
      <button
        type="button"
        className={`feedback-vote ${item.hasVoted ? "voted" : ""}`}
        onClick={onVote}
        aria-pressed={item.hasVoted}
        aria-label={item.hasVoted ? "Remove vote" : "Upvote"}
      >
        <span className="feedback-vote-arrow">▲</span>
        <span className="feedback-vote-count">{item.voteCount}</span>
      </button>
      <div className="feedback-card-body">
        <div className="feedback-card-head">
          <h3 className="feedback-card-title">{item.title}</h3>
          <span className={`feedback-status-badge status-${item.status}`}>
            {STATUS_LABELS[item.status]}
          </span>
        </div>
        <p className="feedback-card-desc">{display}</p>
        {shouldClamp && (
          <button
            type="button"
            className="feedback-card-expand"
            onClick={() => setExpanded((v) => !v)}
          >
            {expanded ? "Show less" : "Show more"}
          </button>
        )}
        <div className="feedback-card-meta">{formatRelativeTime(item.createdAt)}</div>
      </div>
    </div>
  );
}
