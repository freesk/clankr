// Excel stores a date as a serial number: days since its 1900 epoch, with the time of day as
// the fraction. Both directions work in UTC, so a date never shifts with the machine's time
// zone. Reading (`.xls`, D36) and writing (`.xlsx` output) share these.

const millisecondsPerDay = 86_400_000;
/** Days from Excel's 1900 epoch (as Excel counts, with its 1900 leap-year bug) to 1970-01-01. */
const unixEpochSerial1900 = 25_569;
const epochShift1904 = 1_462;
/** 1900-03-01. Earlier serials are off by one because Excel believes 1900 was a leap year. */
const firstReliableSerial = 61;

const isoDatePattern = /^(\d{4})-(\d{2})-(\d{2})$/;
const isoDateTimePattern = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})(\.\d+)?Z?$/;

/** Whole days become "2024-01-15"; a time of day adds " 10:30:00". */
export function serialToIsoDate(serial: number, uses1904: boolean): string {
  const daysSince1970 = serial - unixEpochSerial1900 + (uses1904 ? epochShift1904 : 0);
  const milliseconds = Math.round(daysSince1970 * millisecondsPerDay);
  const iso = new Date(milliseconds).toISOString();
  const date = iso.slice(0, 10);
  const time = iso.slice(11, 19);
  return time === "00:00:00" ? date : `${date} ${time}`;
}

export interface ExcelDate {
  serial: number;
  /** False for a plain date such as "2024-01-15". */
  hasTime: boolean;
}

/**
 * The serial for "2024-01-15" or "2024-01-15 10:30:00" (the forms DuckDB writes). Undefined
 * for anything else, for a date that does not exist, and for dates Excel cannot hold.
 */
export function isoDateToSerial(text: string): ExcelDate | undefined {
  const match = isoDatePattern.exec(text) ?? isoDateTimePattern.exec(text);
  if (!match) return undefined;
  const [year, month, day, hour = 0, minute = 0, second = 0] = match.slice(1, 7).map(Number) as [
    number,
    number,
    number,
    number?,
    number?,
    number?,
  ];
  const fraction = match[7] ? Number(match[7]) : 0;
  const milliseconds =
    Date.UTC(year, month - 1, day, hour, minute, second) + Math.round(fraction * 1000);
  const parsed = new Date(milliseconds);
  // Date.UTC rolls 2024-02-31 over into March; such a string is text, not a date.
  if (parsed.getUTCMonth() !== month - 1 || parsed.getUTCDate() !== day) return undefined;
  const serial = milliseconds / millisecondsPerDay + unixEpochSerial1900;
  if (serial < firstReliableSerial) return undefined;
  return { serial, hasTime: match.length > 4 && match[4] !== undefined };
}
