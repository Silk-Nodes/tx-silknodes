"use client";

interface InfoPanelProps {
  blockHeight?: number;
  chainId?: string;
}

export default function InfoPanel({ blockHeight, chainId }: InfoPanelProps) {
  return (
    <div className="cell area-info" style={{ padding: 14, background: "var(--bg-secondary)" }}>
      <div className="cell-content">
        <div className="cell-header" style={{ marginBottom: 4 }}>
          <span className="label">TX Network</span>
        </div>

        {blockHeight ? (
          <div style={{ marginBottom: 6 }}>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 2 }}>
              <span className="label" style={{ fontSize: 7 }}>Block</span>
              <span className="mono" style={{ fontSize: 9, color: "var(--accent-dark)", fontWeight: 600 }}>
                #{blockHeight.toLocaleString()}
              </span>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between" }}>
              <span className="label" style={{ fontSize: 7 }}>Chain</span>
              <span className="mono" style={{ fontSize: 9 }}>{chainId}</span>
            </div>
          </div>
        ) : null}

        <div className="text-body" style={{ fontSize: 9, lineHeight: 1.5 }}>
          <p style={{ marginBottom: 4 }}>
            TX is a 3rd gen L1 enterprise blockchain with smart tokens, IBC interop, and institutional infrastructure.
          </p>
          <p style={{ marginBottom: 6 }}>
            PSE distributes 100B TX over 84 months to long-term stakers. Your reward = your stake x duration.
          </p>
        </div>

        <div style={{ marginTop: "auto" }}>
          <a
            href="https://tx.org/"
            target="_blank"
            rel="noopener noreferrer"
            className="label"
            style={{ textDecoration: "underline", cursor: "pointer", color: "var(--accent-dark)", fontSize: 8 }}
          >
            TX DOCS &rarr;
          </a>
        </div>
      </div>
    </div>
  );
}
