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

  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = FILE_NAME;
  anchor.click();

  // 이걸 빼면 곡 하나가 탭이 닫힐 때까지 메모리에 남는다.
  URL.revokeObjectURL(url);
}

/** 읽지 못하면 null. 호출부가 문구를 정한다. */
export async function readFileText(file: File): Promise<string | null> {
  try {
    return await file.text();
  } catch {
    return null;
  }
}
