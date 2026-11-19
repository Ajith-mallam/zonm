import type { Platform, SourceType } from "@prisma/client";

/** One text unit found in a file: a whole document, a paragraph, a message, a row. */
export type Unit = {
  text: string;
  authorLabel?: string;
  authoredAt?: Date;
  externalId?: string;
  sourceUrl?: string;
  /** Position in the file, 1-based (line, row or paragraph number). */
  position: number;
};

export type SplitMode = "none" | "paragraph";

export type ExtractOptions = {
  split?: SplitMode;
  /** Field names for CSV / JSON. Detected automatically when not given. */
  textField?: string;
  authorField?: string;
  dateField?: string;
  /** Offset of local times in exports without a timezone (WhatsApp). Default +240 (Seychelles, UTC+4). */
  tzOffsetMinutes?: number;
};

export type Extraction = {
  sourceType: SourceType;
  units: Unit[];
  /** True when units carry author labels (WhatsApp, CSV/JSON with an author field). */
  hasAuthors: boolean;
  /** For CSV/JSON: the available fields and the ones used. */
  fields?: string[];
  used?: { textField?: string; authorField?: string; dateField?: string };
  /** Platform implied by the format, if any. */
  platform?: Platform;
  warnings: string[];
};

export class ExtractionError extends Error {
  /** For CSV/JSON: the fields that were found, so the user can pick the text column. */
  constructor(message: string, readonly fields?: string[]) {
    super(message);
  }
}

export const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;
export const MAX_UNITS = 20_000;
