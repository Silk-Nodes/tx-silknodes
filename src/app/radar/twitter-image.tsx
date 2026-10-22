// X reads twitter:image before og:image. Same reasoning as /stablecoins:
// segment config is written out, a re-export of it fails the build.
export const runtime = "nodejs";
export const revalidate = 3600;
export { default, size, contentType, alt } from "./opengraph-image";
