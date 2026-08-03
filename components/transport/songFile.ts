"use client";

import { serializeSong } from "@/lib/score/serialize";
import type { Song } from "@/lib/score/types";

/** Song에 이름 필드가 없다. 중복은 브라우저가 (1)을 붙여 준다. */
const FILE_NAME = "bandline-song.json";

export function downloadSong(song: Song): void {
  const blob = new Blob([serializeSong(song)], {
    type: "application/json",
  });
  const url = URL.createObjectURL(blob);

  // 앵커를 문서에 붙였다가 클릭 후 뗀다. Chrome은 문서에 없는 앵커도
  // click()만으로 다운로드를 시작하지만, Firefox와 Safari는 그 경우
  // 조용히 무시한다 — 사용자는 저장됐다고 믿는데 파일이 없는, 이 기능에서
  // 가장 나쁜 실패다.
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = FILE_NAME;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();

  // revokeObjectURL을 다음 틱으로 미룬다. 같은 틱에서 바로 부르면 Firefox·
  // Safari에서는 다운로드가 아직 URL을 읽는 중이라 취소된다(Chrome은 다운로드를
  // 동기적으로 시작해 우연히 버틴다). "다음 틱까지 미룰 이유가 없어 보인다"고
  // setTimeout을 걷어내면 두 브라우저에서 다시 조용히 깨진다 — 지우지 말 것.
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

/** 읽지 못하면 null. 호출부가 문구를 정한다. */
export async function readFileText(file: File): Promise<string | null> {
  try {
    return await file.text();
  } catch {
    return null;
  }
}
