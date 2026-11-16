/** Five-field cron expressions (minute hour day-of-month month day-of-week). */

export type CronFieldName = "minute" | "hour" | "day" | "month" | "dow";

export interface CronExpr {
  source: string;
  minute: Set<number>;
  hour: Set<number>;
  day: Set<number>;
  month: Set<number>;
  dow: Set<number>;
  dayRestricted: boolean;
  dowRestricted: boolean;
}

export interface ZonedParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
  dow: number;
}

export class CronError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CronError";
  }
}

const MONTHS: Record<string, number> = {
  jan: 1,
  feb: 2,
  mar: 3,
  apr: 4,
  may: 5,
  jun: 6,
  jul: 7,
  aug: 8,
  sep: 9,
  oct: 10,
  nov: 11,
  dec: 12,
};

const WEEKDAYS: Record<string, number> = {
  sun: 0,
  mon: 1,
  tue: 2,
  wed: 3,
  thu: 4,
  fri: 5,
  sat: 6,
};

const RANGES: Record<CronFieldName, { min: number; max: number }> = {
  minute: { min: 0, max: 59 },
  hour: { min: 0, max: 23 },
  day: { min: 1, max: 31 },
  month: { min: 1, max: 12 },
  dow: { min: 0, max: 7 },
};

const DOW_FROM_NAME: Record<string, number> = {
  sun: 0,
  mon: 1,
  tue: 2,
  wed: 3,
  thu: 4,
  fri: 5,
  sat: 6,
};

export function parseCron(source: string): CronExpr {
  const trimmed = source.trim();
  const parts = trimmed.split(/\s+/);
  if (parts.length !== 5) {
    throw new CronError(`Cron expression must have 5 fields (minute hour day month weekday), got ${parts.length}.`);
  }
  const [minuteSrc, hourSrc, daySrc, monthSrc, dowSrc] = parts as [string, string, string, string, string];
  const minute = parseField(minuteSrc, "minute");
  const hour = parseField(hourSrc, "hour");
  const day = parseField(daySrc, "day");
  const month = parseField(monthSrc, "month");
  const dowRaw = parseField(dowSrc, "dow");
  const dow = new Set<number>();
  for (const value of dowRaw) {
    dow.add(value === 7 ? 0 : value);
  }
  return {
    source: trimmed,
    minute,
    hour,
    day,
    month,
    dow,
    dayRestricted: daySrc !== "*",
    dowRestricted: dowSrc !== "*",
  };
}

function parseField(src: string, field: CronFieldName): Set<number> {
  const { min, max } = RANGES[field];
  const out = new Set<number>();
  for (const item of src.split(",")) {
    if (!item) {
      throw new CronError(`Empty item in ${field} field.`);
    }
    const slash = item.indexOf("/");
    const rangePart = slash === -1 ? item : item.slice(0, slash);
    const stepPart = slash === -1 ? undefined : item.slice(slash + 1);
    const step = stepPart === undefined ? 1 : parseIntStrict(stepPart, field);
    if (step <= 0) {
      throw new CronError(`Step in ${field} must be a positive integer.`);
    }
    let start: number;
    let end: number;
    if (rangePart === "*") {
      start = min;
      end = max;
    } else if (rangePart.includes("-")) {
      const bits = rangePart.split("-");
      if (bits.length !== 2 || !bits[0] || !bits[1]) {
        throw new CronError(`Invalid range "${item}" in ${field}.`);
      }
      start = parseNameOrNumber(bits[0], field);
      end = parseNameOrNumber(bits[1], field);
      if (start > end) {
        throw new CronError(`Range start is after end in ${field}: "${item}".`);
      }
    } else {
      start = parseNameOrNumber(rangePart, field);
      end = start;
    }
    if (start < min || end > max) {
      const sunday = field === "dow" ? ", or 7 for Sunday" : "";
      throw new CronError(`Value out of range in ${field}: "${item}" (allowed ${min}-${max}${sunday}).`);
    }
    for (let n = start; n <= end; n += step) {
      out.add(n);
    }
  }
  if (out.size === 0) {
    throw new CronError(`No values produced for ${field} field "${src}".`);
  }
  return out;
}

function parseIntStrict(raw: string, field: CronFieldName): number {
  if (!/^\d+$/.test(raw)) {
    throw new CronError(`Invalid number "${raw}" in ${field}.`);
  }
  return Number(raw);
}

function parseNameOrNumber(raw: string, field: CronFieldName): number {
  const key = raw.toLowerCase();
  if (field === "month" && key in MONTHS) {
    return MONTHS[key]!;
  }
  if (field === "dow" && key in WEEKDAYS) {
    return WEEKDAYS[key]!;
  }
  return parseIntStrict(raw, field);
}

export function isValidTimeZone(timeZone: string): boolean {
  try {
    Intl.DateTimeFormat("en-US", { timeZone });
    return true;
  } catch {
    return false;
  }
}

export function zonedParts(date: Date, timeZone: string): ZonedParts {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    weekday: "short",
    hourCycle: "h23",
  });
  const map: Record<string, string> = {};
  for (const part of fmt.formatToParts(date)) {
    if (part.type !== "literal") {
      map[part.type] = part.value;
    }
  }
  return {
    year: Number(map.year),
    month: Number(map.month),
    day: Number(map.day),
    hour: Number(map.hour),
    minute: Number(map.minute),
    second: Number(map.second),
    dow: DOW_FROM_NAME[map.weekday!.slice(0, 3).toLowerCase()] ?? 0,
  };
}

/** Convert a wall time in `timeZone` to an instant. Returns null for DST gaps. */
export function zonedToUtc(
  timeZone: string,
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  second = 0,
): Date | null {
  const guess = Date.UTC(year, month - 1, day, hour, minute, second);
  const parts = zonedParts(new Date(guess), timeZone);
  const asUtc = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
  const instant = new Date(guess + (guess - asUtc));
  const check = zonedParts(instant, timeZone);
  if (
    check.year !== year ||
    check.month !== month ||
    check.day !== day ||
    check.hour !== hour ||
    check.minute !== minute ||
    check.second !== second
  ) {
    return null;
  }
  return instant;
}

export function matchesCron(expr: CronExpr, date: Date, timeZone: string): boolean {
  const parts = zonedParts(date, timeZone);
  return matchesParts(expr, parts);
}

function matchesParts(expr: CronExpr, parts: ZonedParts): boolean {
  if (!expr.minute.has(parts.minute) || !expr.hour.has(parts.hour) || !expr.month.has(parts.month)) {
    return false;
  }
  const dayOk = expr.day.has(parts.day);
  const dowOk = expr.dow.has(parts.dow);
  if (expr.dayRestricted && expr.dowRestricted) {
    return dayOk || dowOk;
  }
  if (expr.dayRestricted) {
    return dayOk;
  }
  if (expr.dowRestricted) {
    return dowOk;
  }
  return true;
}

function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function weekdayOf(timeZone: string, year: number, month: number, day: number): number | null {
  const at =
    zonedToUtc(timeZone, year, month, day, 12, 0) ??
    zonedToUtc(timeZone, year, month, day, 3, 0) ??
    zonedToUtc(timeZone, year, month, day, 0, 0);
  return at ? zonedParts(at, timeZone).dow : null;
}

function dayMatches(expr: CronExpr, timeZone: string, year: number, month: number, day: number): boolean {
  const dim = daysInMonth(year, month);
  if (day < 1 || day > dim) {
    return false;
  }
  const dow = weekdayOf(timeZone, year, month, day);
  const dayOk = !expr.dayRestricted || expr.day.has(day);
  const dowOk = !expr.dowRestricted || (dow !== null && expr.dow.has(dow));
  if (expr.dayRestricted && expr.dowRestricted) {
    return dayOk || dowOk;
  }
  return dayOk && dowOk;
}

function normalizeDate(year: number, month: number, day: number): { year: number; month: number; day: number } | null {
  if (month > 12) {
    month -= 12;
    year += 1;
  }
  if (month < 1) {
    month += 12;
    year -= 1;
  }
  if (year < 1970 || year > 2100) {
    return null;
  }
  return { year, month, day };
}

/**
 * Next matching minute strictly after `from`.
 * Returns null if none exists within about four years.
 */
export function nextCronOccurrence(expr: CronExpr, from: Date, timeZone: string, horizonMs = 4 * 365 * 24 * 60 * 60 * 1000): Date | null {
  const parts = zonedParts(from, timeZone);
  let year = parts.year;
  let month = parts.month;
  let day = parts.day;
  let hour = parts.hour;
  let minute = parts.minute + 1;
  let guard = 0;
  while (guard++ < 50_000) {
    while (minute > 59) {
      minute -= 60;
      hour += 1;
    }
    while (hour > 23) {
      hour -= 24;
      day += 1;
    }
    while (day > daysInMonth(year, month)) {
      day -= daysInMonth(year, month);
      month += 1;
      if (month > 12) {
        month = 1;
        year += 1;
      }
    }
    const normalized = normalizeDate(year, month, day);
    if (!normalized) {
      return null;
    }
    year = normalized.year;
    month = normalized.month;
    day = normalized.day;

    const candidate = zonedToUtc(timeZone, year, month, day, hour, minute);
    if (candidate && candidate.getTime() - from.getTime() > horizonMs) {
      return null;
    }

    if (!expr.month.has(month)) {
      month += 1;
      day = 1;
      hour = 0;
      minute = 0;
      continue;
    }
    if (!dayMatches(expr, timeZone, year, month, day)) {
      day += 1;
      hour = 0;
      minute = 0;
      continue;
    }
    if (!expr.hour.has(hour)) {
      const nextHour = nextInSet(expr.hour, hour + 1, 23) ?? null;
      if (nextHour === null) {
        day += 1;
        hour = 0;
        minute = 0;
      } else {
        hour = nextHour;
        minute = 0;
      }
      continue;
    }
    if (!expr.minute.has(minute)) {
      const nextMinute = nextInSet(expr.minute, minute, 59);
      if (nextMinute === null) {
        hour += 1;
        minute = 0;
      } else {
        minute = nextMinute;
      }
      continue;
    }
    if (!candidate) {
      minute += 1;
      continue;
    }
    return candidate;
  }
  return null;
}

/**
 * Latest matching minute at or before `at`.
 * Returns null if none exists within about four years.
 */
export function latestCronOccurrenceAtOrBefore(
  expr: CronExpr,
  at: Date,
  timeZone: string,
  horizonMs = 4 * 365 * 24 * 60 * 60 * 1000,
): Date | null {
  const parts = zonedParts(at, timeZone);
  let year = parts.year;
  let month = parts.month;
  let day = parts.day;
  let hour = parts.hour;
  let minute = parts.minute;
  let guard = 0;
  while (guard++ < 50_000) {
    while (minute < 0) {
      minute += 60;
      hour -= 1;
    }
    while (hour < 0) {
      hour += 24;
      day -= 1;
    }
    while (day < 1) {
      month -= 1;
      if (month < 1) {
        month = 12;
        year -= 1;
      }
      day += daysInMonth(year, month);
    }
    const normalized = normalizeDate(year, month, day);
    if (!normalized) {
      return null;
    }
    year = normalized.year;
    month = normalized.month;
    day = normalized.day;

    const candidate = zonedToUtc(timeZone, year, month, day, hour, minute);
    if (candidate && at.getTime() - candidate.getTime() > horizonMs) {
      return null;
    }

    if (!expr.month.has(month)) {
      month -= 1;
      if (month < 1) {
        month = 12;
        year -= 1;
      }
      day = daysInMonth(year, month);
      hour = 23;
      minute = 59;
      continue;
    }
    if (!dayMatches(expr, timeZone, year, month, day)) {
      day -= 1;
      hour = 23;
      minute = 59;
      continue;
    }
    if (!expr.hour.has(hour)) {
      const prevHour = prevInSet(expr.hour, hour - 1, 0);
      if (prevHour === null) {
        day -= 1;
        hour = 23;
        minute = 59;
      } else {
        hour = prevHour;
        minute = 59;
      }
      continue;
    }
    if (!expr.minute.has(minute)) {
      const prevMinute = prevInSet(expr.minute, minute, 0);
      if (prevMinute === null) {
        hour -= 1;
        minute = 59;
      } else {
        minute = prevMinute;
      }
      continue;
    }
    if (!candidate) {
      minute -= 1;
      continue;
    }
    if (candidate.getTime() > at.getTime()) {
      minute -= 1;
      continue;
    }
    return candidate;
  }
  return null;
}

function nextInSet(set: Set<number>, current: number, max: number): number | null {
  for (let n = current; n <= max; n++) {
    if (set.has(n)) {
      return n;
    }
  }
  return null;
}

function prevInSet(set: Set<number>, current: number, min: number): number | null {
  for (let n = current; n >= min; n--) {
    if (set.has(n)) {
      return n;
    }
  }
  return null;
}
