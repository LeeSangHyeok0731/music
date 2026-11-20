import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

afterEach(cleanup);

describe("dom 환경", () => {
  it("jsdom에서 컴포넌트를 렌더한다", () => {
    render(<p>hello</p>);
    expect(screen.getByText("hello")).toBeTruthy();
    expect(typeof document).toBe("object");
  });
});
