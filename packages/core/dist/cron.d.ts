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
export declare class CronError extends Error {
    constructor(message: string);
}
export declare function parseCron(source: string): CronExpr;
export declare function isValidTimeZone(timeZone: string): boolean;
export declare function zonedParts(date: Date, timeZone: string): ZonedParts;
/** Convert a wall time in `timeZone` to an instant. Returns null for DST gaps. */
export declare function zonedToUtc(timeZone: string, year: number, month: number, day: number, hour: number, minute: number, second?: number): Date | null;
export declare function matchesCron(expr: CronExpr, date: Date, timeZone: string): boolean;
/**
 * Next matching minute strictly after `from`.
 * Returns null if none exists within about four years.
 */
export declare function nextCronOccurrence(expr: CronExpr, from: Date, timeZone: string, horizonMs?: number): Date | null;
/**
 * Latest matching minute at or before `at`.
 * Returns null if none exists within about four years.
 */
export declare function latestCronOccurrenceAtOrBefore(expr: CronExpr, at: Date, timeZone: string, horizonMs?: number): Date | null;
