// A one-page PDF with a few lines of text (S1: "find the lease PDF"). Also the
// reference for what the pdf-created assertion accepts as a valid PDF.

import { z } from "zod";

export const pdfOptions = z.object({ lines: z.array(z.string()).min(1) });

export function renderPdf(options: z.infer<typeof pdfOptions>): Buffer {
  const textCommands = options.lines
    .map((line, index) => `BT /F1 12 Tf 72 ${720 - index * 18} Td (${escapePdfText(line)}) Tj ET`)
    .join("\n");
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
    `<< /Length ${Buffer.byteLength(textCommands)} >>\nstream\n${textCommands}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  let body = "%PDF-1.4\n";
  const offsets: number[] = [];
  for (const [index, object] of objects.entries()) {
    offsets.push(Buffer.byteLength(body));
    body += `${index + 1} 0 obj\n${object}\nendobj\n`;
  }
  const crossReferenceOffset = Buffer.byteLength(body);
  const entries = offsets.map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`);
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${entries.join("")}`;
  body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${crossReferenceOffset}\n%%EOF\n`;
  return Buffer.from(body, "latin1");
}

function escapePdfText(text: string): string {
  return text.replaceAll("\\", "\\\\").replaceAll("(", "\\(").replaceAll(")", "\\)");
}

/** Header and end-of-file marker: enough to tell a real PDF from a mislabelled file. */
export function looksLikePdf(content: Buffer): boolean {
  const head = content.subarray(0, 5).toString("latin1");
  const tail = content.subarray(Math.max(0, content.length - 1024)).toString("latin1");
  return head === "%PDF-" && tail.includes("%%EOF");
}
