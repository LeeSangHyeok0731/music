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
          // 실제 StudioProvider로 렌더하는 통합 테스트는 한 건이 1~4초이고, 스위트가 병렬로 돌거나
          // 다른 프로세스(개발 서버 등)가 CPU를 쓰면 5초 기본값을 넘는다. 로직 오류가 아니라 경합이다.
          testTimeout: 20_000,
          include: [
            "state/**/*.test.{ts,tsx}",
            "components/**/*.test.{ts,tsx}",
          ],
        },
      },
    ],
  },
});
