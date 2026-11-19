// Decode uploaded text files. Handles UTF-8 (with or without BOM) and UTF-16
// with a BOM, and falls back to Windows-1252 for legacy files. Line endings are
// normalised to \n so the same text always hashes the same.
export function decodeText(buf: Uint8Array): { text: string; encoding: string } {
  let text: string;
  let encoding: string;
  if (buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) {
    text = new TextDecoder("utf-8").decode(buf.subarray(3));
    encoding = "utf-8 (BOM)";
  } else if (buf[0] === 0xff && buf[1] === 0xfe) {
    text = new TextDecoder("utf-16le").decode(buf.subarray(2));
    encoding = "utf-16le";
  } else if (buf[0] === 0xfe && buf[1] === 0xff) {
    text = new TextDecoder("utf-16be").decode(buf.subarray(2));
    encoding = "utf-16be";
  } else {
    try {
      text = new TextDecoder("utf-8", { fatal: true }).decode(buf);
      encoding = "utf-8";
    } catch {
      text = new TextDecoder("windows-1252").decode(buf);
      encoding = "windows-1252";
    }
  }
  return { text: normaliseNewlines(text), encoding };
}

export function normaliseNewlines(text: string): string {
  return text.replace(/\r\n?/g, "\n");
}

/** Split on blank lines; trims each paragraph and drops empty ones. */
export function paragraphs(text: string): { text: string; position: number }[] {
  return text
    .split(/\n\s*\n/)
    .map((p, i) => ({ text: p.trim(), position: i + 1 }))
    .filter((p) => p.text.length > 0);
}
