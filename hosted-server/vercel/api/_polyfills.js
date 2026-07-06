// 🔴 RUNTIME POLYFILLS — must be imported BEFORE any other import in api/mcp.ts.
//
// pdfjs-dist (transitively imported via pdf-parse → vendor/novada-mcp/tools/extract.js)
// references DOMMatrix / ImageData / Path2D at module top-level. Node.js Functions
// runtime has none of these globals, so the import phase crashes with
//   ReferenceError: DOMMatrix is not defined
// before our auth/KV/dispatch code ever runs.
//
// We don't actually USE PDF rendering on the hosted server (extract treats PDFs
// as opaque blobs and never invokes pdfjs render APIs), so empty class stubs
// are sufficient to satisfy the module-init type references. PDF parsing falls
// back to text-only extraction via pdf-parse's lower path.
//
// CRITICAL: this file MUST be imported as a side-effect import BEFORE any other
// import in api/mcp.ts:
//
//   import "./_polyfills.js";       // ← side-effect import, runs first
//   import { Server } from "@modelcontextprotocol/sdk/...";
//   ...
//
// ESM hoists imports to the top of evaluation, but resolves them in source
// order. Listing this file first guarantees the polyfills are in place before
// pdfjs-dist's module body runs.

const g = globalThis;
if (typeof g.DOMMatrix === "undefined") {
  g.DOMMatrix = class DOMMatrix {
    constructor() {}
    static fromMatrix() { return new g.DOMMatrix(); }
  };
}
if (typeof g.ImageData === "undefined") {
  g.ImageData = class ImageData {
    constructor() {}
  };
}
if (typeof g.Path2D === "undefined") {
  g.Path2D = class Path2D {
    constructor() {}
    addPath() {}
  };
}
