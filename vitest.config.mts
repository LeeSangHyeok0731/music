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
          // scripts/**: 샘플 팩 빌드 스크립트의 순수 함수(라이선스 확인·DSP)
          include: ["lib/**/*.test.ts", "scripts/**/*.test.ts"],
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
