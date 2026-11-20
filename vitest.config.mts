import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const rootDir = fileURLToPath(new URL(".", import.meta.url));

export default defineConfig({
  resolve: {
    alias: { "@": rootDir },
  },
  test: {
    projects: [
      {
        // lib/**는 브라우저 없이 돌아야 한다 — 그게 이 레이어의 계약이다.
        extends: true,
        test: {
          name: "node",
          environment: "node",
          include: ["lib/**/*.test.ts"],
        },
      },
      {
        extends: true,
        test: {
          name: "dom",
          environment: "jsdom",
          include: [
            "state/**/*.test.{ts,tsx}",
            "components/**/*.test.{ts,tsx}",
          ],
        },
      },
    ],
  },
});
