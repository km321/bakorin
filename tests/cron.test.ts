import { describe, expect, test } from "bun:test";
import {
  CronError,
  compileAppYaml,
  isValidTimeZone,
  latestCronOccurrenceAtOrBefore,
  matchesCron,
  nextCronOccurrence,
  parseCron,
  zonedToUtc,
  SchemaError,
} from "@bakorin/core";

const ENV = { env: { JWT_SECRET: "test-jwt-secret-0123456789-abcdefghijklmnop" }, production: false };

const MINI = `
app:
  name: mini
runtime:
  dialect: sqlite
  sqlite:
    path: ./data/app.db
  jwt:
    secret: ${ENV.env.JWT_SECRET}
auth:
  entity: users
entities:
  users:
    auth: true
    fields:
      email: { type: email, unique: true, required: true }
      password: { type: password, required: true }
      role: { type: enum, values: [user, admin], default: user }
`;

describe("cron parser", () => {
  test("parses wildcards, lists, ranges, steps, and names", () => {
    const everyFive = parseCron("*/5 * * * *");
    expect([...everyFive.minute].sort((a, b) => a - b)).toEqual([0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55]);
    const weekdays = parseCron("0 9 * * mon-fri");
    expect([...weekdays.dow].sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5]);
    const months = parseCron("0 0 1 JAN,jul *");
    expect([...months.month].sort((a, b) => a - b)).toEqual([1, 7]);
    const sundaySeven = parseCron("0 0 * * 7");
    expect([...sundaySeven.dow]).toEqual([0]);
  });

  test("rejects the wrong number of fields and out of range values", () => {
    expect(() => parseCron("* * * *")).toThrow(CronError);
    expect(() => parseCron("* * * * * *")).toThrow(CronError);
    expect(() => parseCron("60 * * * *")).toThrow(CronError);
    expect(() => parseCron("0 24 * * *")).toThrow(CronError);
  });

  test("finds the next and latest occurrence in UTC", () => {
    const expr = parseCron("0 0 1 1 *");
    const from = new Date("2026-12-31T12:00:00.000Z");
    expect(nextCronOccurrence(expr, from, "UTC")?.toISOString()).toBe("2027-01-01T00:00:00.000Z");
    const at = new Date("2026-03-02T12:00:00.000Z");
    expect(latestCronOccurrenceAtOrBefore(expr, at, "UTC")?.toISOString()).toBe("2026-01-01T00:00:00.000Z");
    const hourly = parseCron("0 * * * *");
    const justAfter = new Date("2026-06-01T10:00:00.000Z");
    expect(latestCronOccurrenceAtOrBefore(hourly, justAfter, "UTC")?.toISOString()).toBe("2026-06-01T10:00:00.000Z");
    expect(nextCronOccurrence(hourly, justAfter, "UTC")?.toISOString()).toBe("2026-06-01T11:00:00.000Z");
  });

  test("uses Vixie OR when both day-of-month and day-of-week are restricted", () => {
    const expr = parseCron("0 12 15 * 1");
    const monday = zonedToUtc("UTC", 2026, 6, 15, 12, 0)!; // Monday 15 Jun 2026
    const tuesday = zonedToUtc("UTC", 2026, 6, 16, 12, 0)!;
    const nextMonday = zonedToUtc("UTC", 2026, 6, 22, 12, 0)!;
    expect(monday.getUTCDay()).toBe(1);
    expect(matchesCron(expr, monday, "UTC")).toBe(true);
    expect(matchesCron(expr, tuesday, "UTC")).toBe(false);
    expect(matchesCron(expr, nextMonday, "UTC")).toBe(true);
  });

  test("honors America/New_York and skips the spring-forward gap", () => {
    expect(isValidTimeZone("America/New_York")).toBe(true);
    expect(isValidTimeZone("Not/A_Zone")).toBe(false);
    const expr = parseCron("30 2 * * *");
    // 2026-03-08 02:00 EST jumps to 03:00 EDT; 02:30 does not exist.
    const before = new Date("2026-03-08T06:00:00.000Z"); // 01:00 EST
    const next = nextCronOccurrence(expr, before, "America/New_York");
    expect(next?.toISOString()).toBe("2026-03-09T06:30:00.000Z"); // 02:30 EDT the next day
    const nineAm = parseCron("0 9 * * 1-5");
    const sundayEvening = new Date("2026-03-08T20:00:00.000Z");
    const nextWeekdayNine = nextCronOccurrence(nineAm, sundayEvening, "America/New_York");
    expect(nextWeekdayNine?.toISOString()).toBe("2026-03-09T13:00:00.000Z"); // 09:00 EDT Monday
  });
});

describe("jobs in app.yaml", () => {
  test("compiles a job list with defaults", () => {
    const ast = compileAppYaml(
      `${MINI}
jobs:
  - name: refresh_stats
    cron: "0 */6 * * *"
    timezone: America/New_York
`,
      ENV,
    );
    expect(ast.jobs).toEqual([
      {
        name: "refresh_stats",
        cron: "0 */6 * * *",
        handler: "refresh_stats",
        timezone: "America/New_York",
        dryRun: false,
        timeoutSeconds: 300,
        enabled: true,
      },
    ]);
    expect(ast.runtime.jobsRetainDays).toBe(30);
  });

  test("rejects a bad cron, a duplicate name, and jobs as an entity name", () => {
    expect(() =>
      compileAppYaml(
        `${MINI}
jobs:
  - name: bad
    cron: "not a cron"
`,
        ENV,
      ),
    ).toThrow(SchemaError);
    expect(() =>
      compileAppYaml(
        `${MINI}
jobs:
  - name: twice
    cron: "* * * * *"
  - name: twice
    cron: "0 * * * *"
`,
        ENV,
      ),
    ).toThrow(/duplicate job name/);
    expect(() =>
      compileAppYaml(
        MINI.replace(
          "      role: { type: enum, values: [user, admin], default: user }\n",
          "      role: { type: enum, values: [user, admin], default: user }\n  jobs:\n    fields:\n      title: text\n",
        ),
        ENV,
      ),
    ).toThrow(/reserved/);
  });
});
