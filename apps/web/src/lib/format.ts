// Dates are shown in UTC everywhere so records read the same for every user.
export function fmtDateTime(d: Date | null | undefined): string {
  return d ? `${d.toISOString().slice(0, 16).replace("T", " ")} UTC` : "—";
}

export function fmtDate(d: Date | null | undefined): string {
  return d ? d.toISOString().slice(0, 10) : "—";
}

/** Parse a YYYY-MM-DD form value as a UTC date, or null. */
export function parseDateInput(v: FormDataEntryValue | null): Date | null {
  if (typeof v !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return null;
  const d = new Date(`${v}T00:00:00Z`);
  return Number.isNaN(d.getTime()) ? null : d;
}
