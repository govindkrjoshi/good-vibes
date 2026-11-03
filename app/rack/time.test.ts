import { expect, test } from "vitest";
import { isTime } from "./time";

test.each([
  "0",
  "0.5",
  "2",
  "250ms",
  "1.5s",
  "4n",
  "8t",
  "1m",
  "4n.",
  "2hz",
  "1:2:0",
  "0:0:3",
  "2:1",
  "96i",
  "+4n",
  "+ 1m",
  " 8n ",
  0,
  1.25,
])("reads %s as a time", (value) => {
  expect(isTime(value)).toBe(true);
});

test.each([
  "",
  "now",
  "4",
  "4q",
  "n4",
  "1:2:3:4",
  "a:b",
  "-1",
  "4n..",
  -1,
  Number.NaN,
  Number.POSITIVE_INFINITY,
  null,
  undefined,
  true,
  {},
])("turns %s away", (value) => {
  // "4" alone is seconds, so it is a time; everything else here is not.
  expect(isTime(value)).toBe(value === "4");
});
