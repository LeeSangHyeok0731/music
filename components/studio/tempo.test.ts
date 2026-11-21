import { describe, expect, it } from "vitest";

import { parseTempoInput } from "./tempo";

describe("parseTempoInput", () => {
  it.each([
    ["120", 120],
    ["90", 90],
    ["120.4", 120.4],
    ["999", 999],
    [" 75 ", 75],
  ])("%j → %j (범위 자르기는 하지 않는다)", (raw, expected) => {
    expect(parseTempoInput(raw)).toBe(expected);
  });

  it.each(["", "   ", "abc", "NaN", "Infinity", "-Infinity", "12abc", "1e999"])(
    "%j → null",
    (raw) => {
      expect(parseTempoInput(raw)).toBeNull();
    },
  );
});
