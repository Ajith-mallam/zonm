// Builders for test files. Used by unit tests and the end-to-end suite, so no
// binary fixtures need to live in the repository.
import JSZip from "jszip";

/** A minimal valid .docx with one paragraph per entry. */
export async function buildDocx(paragraphs: string[]): Promise<Buffer> {
  const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const zip = new JSZip();
  zip.file(
    "[Content_Types].xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`,
  );
  zip.file(
    "_rels/.rels",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`,
  );
  zip.file(
    "word/document.xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${paragraphs
      .map((p) => `<w:p><w:r><w:t xml:space="preserve">${esc(p)}</w:t></w:r></w:p>`)
      .join("")}</w:body></w:document>`,
  );
  return zip.generateAsync({ type: "nodebuffer" });
}

/** A minimal valid single-page PDF showing each line (ASCII only). */
export function buildPdf(lines: string[]): Buffer {
  const esc = (s: string) => s.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
  const content = `BT /F1 12 Tf 72 720 Td 14 TL ${lines.map((l) => `(${esc(l)}) Tj T*`).join(" ")} ET`;
  const objs = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
    `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  let out = "%PDF-1.4\n";
  const offsets: number[] = [];
  objs.forEach((o, i) => {
    offsets.push(out.length);
    out += `${i + 1} 0 obj\n${o}\nendobj\n`;
  });
  const xref = out.length;
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, "0")} 00000 n \n`).join("")}`;
  out += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, "latin1");
}

export const WHATSAPP_ANDROID = [
  "19/11/2026, 09:58 - Messages and calls are end-to-end encrypted. No one outside of this chat can read them.",
  "19/11/2026, 10:15 - Marie: Bonzour tout dimoun!",
  "19/11/2026, 10:16 - Jean-Paul: Ki manyer?",
  "Mon pe vini aswar.",
  "19/11/2026, 10:17 - Marie: <Media omitted>",
  "19/11/2026, 22:05 - Jean-Paul: This message was deleted",
  "20/11/2026, 07:30 - Marie added Ravi",
  "20/11/2026, 07:31 - Ravi: Morning all <This message was edited>",
].join("\n");

export const WHATSAPP_IOS = [
  "[03/02/2026, 8:05:09\u202fPM] Nadia: Ou la?",
  "[03/02/2026, 8:06:12\u202fPM] Lisa: Wi mon la",
  "[03/02/2026, 8:07:00\u202fPM] Nadia: \u200eimage omitted",
].join("\n");
