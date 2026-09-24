// X reads twitter:image before og:image. The layout declares a large-image
// card, so without this the page would ask X for a picture it never names.
//
// runtime and revalidate are written out here rather than re-exported: Next
// reads route segment config statically at compile time, and a re-export of
// them fails the build with "It mustn't be reexported".
export const runtime = "nodejs";
export const revalidate = 300;
export { default, size, contentType, alt } from "./opengraph-image";
