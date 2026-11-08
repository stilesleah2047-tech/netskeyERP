import { test } from "node:test";
import assert from "node:assert/strict";
import { businessDate, businessDayRange, isBusinessDateString } from "../src/lib/server/businessDay";

test("a sale at 01:30 EAT belongs to that Nairobi day, not the previous UTC day", () => {
  // 2026-10-12 01:30 EAT == 2026-10-11 22:30 UTC
  assert.equal(businessDate(new Date("2026-10-11T22:30:00Z")), "2026-10-12");
});

test("business day range is 00:00-24:00 EAT expressed in UTC", () => {
  const { start, end } = businessDayRange("2026-10-12");
  assert.equal(start.toISOString(), "2026-10-11T21:00:00.000Z");
  assert.equal(end.toISOString(), "2026-10-12T21:00:00.000Z");
});

test("date string validation", () => {
  assert.ok(isBusinessDateString("2026-10-12"));
  assert.ok(!isBusinessDateString("2026-02-30"));
  assert.ok(!isBusinessDateString("12/10/2026"));
  assert.ok(!isBusinessDateString(null));
});
