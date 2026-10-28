import assert from "node:assert/strict";
import { validateDay, applyHalf, employedOn, isCurrent, weeksWithoutLeave, planWindowOpen, approverRole } from "./rules";
import { dateRange, shiftInstants } from "./time";

assert.equal(validateDay([{ start: 540, end: 1020 }], false), null);
assert.match(validateDay([{ start: 540, end: 900 }], false)!, /8 hours/);
assert.equal(validateDay([{ start: 1320, end: 1800 }], false), null); // 22:00 -> 06:00 next day
assert.equal(validateDay([{ start: 540, end: 780 }, { start: 1020, end: 1260 }], true), null); // 9-13 + 17-21 split
assert.match(validateDay([{ start: 540, end: 780 }, { start: 1020, end: 1260 }], false)!, /remote/);
assert.match(validateDay([{ start: 540, end: 900 }, { start: 840, end: 1200 }], true)!, /overlap/);
assert.deepEqual(applyHalf([{ start: 540, end: 1080 }], "pm"), [{ start: 540, end: 810 }]);
assert.deepEqual(applyHalf([{ start: 540, end: 780 }, { start: 1020, end: 1260 }], "am"), [{ start: 1020, end: 1260 }]);
assert.equal(employedOn({ joinedOn: "2026-11-01", leftOn: null }, "2026-10-31"), false);
assert.equal(employedOn({ joinedOn: null, leftOn: "2026-10-15" }, "2026-10-15"), true);
assert.equal(employedOn({ joinedOn: null, leftOn: "2026-10-15" }, "2026-10-16"), false);

// Nov 2026: full Mon-Sun weeks inside the month start on 2, 9, 16, 23
assert.deepEqual(weeksWithoutLeave("2026-11", new Set(["2026-11-04", "2026-11-25"])), ["2026-11-09", "2026-11-16"]);

assert.equal(planWindowOpen("2026-10-26", "2026-11", 5), true);
assert.equal(planWindowOpen("2026-11-05", "2026-11", 5), true);
assert.equal(planWindowOpen("2026-11-06", "2026-11", 5), false);

assert.equal(approverRole("employee"), "hr");
assert.equal(approverRole("hr"), "admin");

const { start, end } = shiftInstants("2026-11-01", { start: 1320, end: 1800 }, "Asia/Kolkata");
assert.equal(start.toISOString(), "2026-11-01T16:30:00.000Z");
assert.equal(end.toISOString(), "2026-11-02T00:30:00.000Z");
assert.equal(isCurrent({ active: true, leftOn: "2026-12-31" }, "2026-10-26"), true); // notice period
assert.equal(isCurrent({ active: true, leftOn: "2026-10-25" }, "2026-10-26"), false);
assert.equal(isCurrent({ active: false, leftOn: null }, "2026-10-26"), false);
assert.deepEqual(dateRange("2026-02-27", "2026-03-02"), ["2026-02-27", "2026-02-28", "2026-03-01", "2026-03-02"]);
assert.deepEqual(dateRange("2026-03-02", "2026-03-01"), []);
console.log("rules ok");
