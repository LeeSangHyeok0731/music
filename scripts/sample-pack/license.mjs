// 샘플 출처의 라이선스 확인. CC0 1.0 Universal이 아니면 빌드를 멈춘다.

const EXPECTED_LINES = ["Creative Commons Legal Code", "CC0 1.0 Universal"];

/**
 * LICENSE 본문의 처음 두 비어 있지 않은 줄이 CC0 1.0 Universal 법률 문안의
 * 첫 줄들인지 확인한다. 아니면 던진다.
 *
 * @param {string} text LICENSE 파일 내용
 * @param {string} label 오류 메시지에 쓸 출처 이름
 */
export function assertCc0LicenseText(text, label) {
  const lines = text
    .replace(/^﻿/, "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .slice(0, EXPECTED_LINES.length);
  const ok =
    lines.length === EXPECTED_LINES.length &&
    lines.every((line, i) => line === EXPECTED_LINES[i]);
  if (!ok) {
    throw new Error(
      `${label}: LICENSE가 CC0 1.0 Universal이 아닙니다 (처음 줄: ${JSON.stringify(lines)}). 빌드를 멈춥니다.`,
    );
  }
}

/**
 * GitHub API가 알려 준 SPDX id가 CC0-1.0인지 확인한다. 아니면 던진다.
 *
 * @param {string} spdx
 * @param {string} label
 */
export function assertCc0Spdx(spdx, label) {
  if (spdx.trim() !== "CC0-1.0") {
    throw new Error(
      `${label}: GitHub API의 라이선스 SPDX가 CC0-1.0이 아닙니다 (${JSON.stringify(spdx)}). 빌드를 멈춥니다.`,
    );
  }
}
