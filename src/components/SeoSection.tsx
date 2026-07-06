import { SEO_PAGES } from "@/lib/seo-content";

// Renders a page's SEO content: a visible intro + FAQ (server-rendered, so
// search engines and non-JS/agentic crawlers read it), plus matching
// FAQPage + BreadcrumbList JSON-LD for rich results. Dropped at the bottom of
// each main tab. No hooks, so it server-renders cleanly inside client tabs.

const BASE = "https://tx.silknodes.io";

export default function SeoSection({ page }: { page: keyof typeof SEO_PAGES }) {
  const data = SEO_PAGES[page];
  if (!data) return null;

  const jsonLd = {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "BreadcrumbList",
        itemListElement: [
          { "@type": "ListItem", position: 1, name: "ALL in ONE TX", item: BASE },
          ...(data.path === "/"
            ? []
            : [{ "@type": "ListItem", position: 2, name: data.heading, item: `${BASE}${data.path}` }]),
        ],
      },
      {
        "@type": "FAQPage",
        mainEntity: data.faqs.map((f) => ({
          "@type": "Question",
          name: f.q,
          acceptedAnswer: { "@type": "Answer", text: f.a },
        })),
      },
    ],
  };

  return (
    <section className="seo-content" aria-label="About this page">
      <div className="seo-content-inner">
        <h2 className="seo-content-heading">{data.heading}</h2>
        {data.intro.map((p, i) => (
          <p key={i} className="seo-content-p">{p}</p>
        ))}
        <div className="seo-faq">
          {data.faqs.map((f, i) => (
            <div key={i} className="seo-faq-item">
              <h3 className="seo-faq-q">{f.q}</h3>
              <p className="seo-faq-a">{f.a}</p>
            </div>
          ))}
        </div>
      </div>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />
    </section>
  );
}
