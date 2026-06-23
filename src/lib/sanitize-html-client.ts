// Client-side HTML sanitizer - defense-in-depth for the Medium article
// HTML rendered via dangerouslySetInnerHTML in FeedItemPanel. The server
// (/api/today/feed) already runs an allowlist sanitizer; this is a second
// independent pass on the client so a server-side regression can't become
// a stored-XSS sink. Uses DOMParser (browser-only) and walks the tree,
// dropping disallowed tags/attributes and unsafe URLs.

const ALLOWED_TAGS = new Set([
  "p", "br", "hr",
  "h1", "h2", "h3", "h4", "h5", "h6",
  "ul", "ol", "li",
  "a", "img",
  "strong", "b", "em", "i", "u",
  "blockquote", "pre", "code",
  "figure", "figcaption",
  "span", "div",
]);
// Per-tag attribute allowlist. Everything else (incl. all on* handlers,
// style, class, id) is stripped.
const ALLOWED_ATTRS: Record<string, Set<string>> = {
  a: new Set(["href", "target", "rel"]),
  img: new Set(["src", "alt", "loading"]),
};
// Tags whose content is also removed (not just unwrapped).
const STRIP_WITH_CONTENT = new Set(["script", "style", "iframe", "object", "embed", "link", "meta"]);

const HTTP_URL = /^https?:\/\//i;

export function sanitizeHtmlClient(html: string): string {
  if (typeof window === "undefined" || typeof DOMParser === "undefined") {
    // SSR / no-DOM environment: the server already sanitized, so pass
    // through. (FeedItemPanel is a client component, so in practice this
    // path isn't hit during interaction.)
    return html ?? "";
  }
  if (!html) return "";

  const doc = new DOMParser().parseFromString(html, "text/html");

  const sanitizeElement = (el: Element) => {
    // Depth-first: process children first (snapshot the live list).
    Array.from(el.children).forEach((child) => sanitizeElement(child));

    const tag = el.tagName.toLowerCase();

    if (STRIP_WITH_CONTENT.has(tag)) {
      el.remove();
      return;
    }

    if (!ALLOWED_TAGS.has(tag)) {
      // Unwrap: keep the (already-sanitized) children, drop the wrapper.
      const parent = el.parentNode;
      if (parent) {
        while (el.firstChild) parent.insertBefore(el.firstChild, el);
        el.remove();
      }
      return;
    }

    // Strip every attribute not in this tag's allowlist (kills on*,
    // style, class, id, srcset, etc).
    const allowed = ALLOWED_ATTRS[tag] ?? new Set<string>();
    Array.from(el.attributes).forEach((attr) => {
      if (!allowed.has(attr.name.toLowerCase())) el.removeAttribute(attr.name);
    });

    if (tag === "a") {
      const href = el.getAttribute("href") || "";
      if (!HTTP_URL.test(href)) {
        el.removeAttribute("href");
      } else {
        el.setAttribute("target", "_blank");
        el.setAttribute("rel", "noopener noreferrer");
      }
    }
    if (tag === "img") {
      const src = el.getAttribute("src") || "";
      if (!HTTP_URL.test(src)) {
        el.remove();
        return;
      }
      el.setAttribute("loading", "lazy");
    }
  };

  Array.from(doc.body.children).forEach((child) => sanitizeElement(child));
  return doc.body.innerHTML;
}
