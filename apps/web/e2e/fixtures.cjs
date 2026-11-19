// Test files for the evidence suite (JS twins of src/lib/ingest/fixtures.ts).
const JSZip = require("jszip");

async function buildDocx(paragraphs) {
  const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const zip = new JSZip();
  zip.file("[Content_Types].xml", '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>');
  zip.file("_rels/.rels", '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>');
  zip.file("word/document.xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${paragraphs.map((p) => `<w:p><w:r><w:t xml:space="preserve">${esc(p)}</w:t></w:r></w:p>`).join("")}</w:body></w:document>`);
  return zip.generateAsync({ type: "nodebuffer" });
}

function buildPdf(lines) {
  const esc = (s) => s.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
  const content = `BT /F1 12 Tf 72 720 Td 14 TL ${lines.map((l) => `(${esc(l)}) Tj T*`).join(" ")} ET`;
  const objs = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
    `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  let out = "%PDF-1.4\n";
  const offsets = [];
  objs.forEach((o, i) => {
    offsets.push(out.length);
    out += `${i + 1} 0 obj\n${o}\nendobj\n`;
  });
  const xref = out.length;
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, "0")} 00000 n \n`).join("")}`;
  out += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, "latin1");
}

/** A group chat: Marie writes Kreol, Jean-Paul writes English, plus noise to skip. */
function whatsappChat(tag) {
  const lines = ["19/11/2026, 09:58 - Messages and calls are end-to-end encrypted. No one outside of this chat can read them."];
  const marie = ["Bonzour tout dimoun", "Mon pa konnen kifer zot pe fer sa", "Lakaz la i vreman sal", "Zot pa ti dir nou nanryen", "Mon pa pou retourn laba zanmen"];
  const jp = ["Good morning everyone", "I must say the service was poor", "We were promised a sea view", "Honestly the price is too high", "I would not recommend it"];
  for (let i = 0; i < 5; i++) {
    lines.push(`19/11/2026, 10:${String(10 + i * 2).padStart(2, "0")} - Marie: ${marie[i]} ${tag}`);
    lines.push(`19/11/2026, 10:${String(11 + i * 2).padStart(2, "0")} - Jean-Paul: ${jp[i]} ${tag}`);
  }
  lines.push("19/11/2026, 10:30 - Jean-Paul: and a second line follows", "on the next line");
  lines.push("19/11/2026, 10:31 - Marie: <Media omitted>");
  lines.push("19/11/2026, 10:32 - Ravi: ok " + tag);
  lines.push("20/11/2026, 07:30 - Marie added Lisa");
  return lines.join("\n");
}

module.exports = { buildDocx, buildPdf, whatsappChat };
