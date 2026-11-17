PDF.js 6.2.108 (Apache-2.0, Mozilla). Used to turn PDF slides into lesson pictures.
Copied from the pdfjs-dist npm package: build/pdf.min.mjs and build/pdf.worker.min.mjs.

polyfills.mjs and worker.mjs are ours, not part of PDF.js. PDF.js 6 uses a few
JavaScript features newer than the Chromium inside Electron (for example
Map.getOrInsertComputed and Uint8Array.toHex). polyfills.mjs adds them only
when missing; worker.mjs loads it before the PDF.js worker. When updating
PDF.js, run the Mac app self-check (GitHub Actions) to catch new ones.
