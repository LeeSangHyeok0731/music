import { describe, expect, it } from "vitest";

import { POPOVER_WIDTH, popoverPosition } from "./popover";

describe("popoverPosition", () => {
  it("앵커 아래 4px에 놓고 가로는 뷰포트 안(여백 8px)으로 가둔다", () => {
    expect(popoverPosition({ left: 200, bottom: 100 }, 1000)).toEqual({
      left: 200,
      top: 104,
    });
    expect(popoverPosition({ left: 5000, bottom: 100 }, 1000)).toEqual({
      left: 1000 - POPOVER_WIDTH - 8,
      top: 104,
    });
    expect(popoverPosition({ left: -50, bottom: 100 }, 1000).left).toBe(8);
  });
});
