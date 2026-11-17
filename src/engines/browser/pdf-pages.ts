// Counting the pages of a PDF Chromium wrote, for the tool result. Each page is one object of
// type /Page (the page tree's own objects are /Pages), and Chromium writes them uncompressed.

export function pdfPageCount(pdf: Buffer): number {
  return pdf.toString("latin1").match(/\/Type\s*\/Page(?!s)/g)?.length ?? 0;
}
