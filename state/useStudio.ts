"use client";

import { createContext, useContext } from "react";

import type { StudioApi } from "./types";

/** `StudioProvider`만 값을 넣는다. 바깥에서는 null이다. */
export const StudioContext = createContext<StudioApi | null>(null);

export function useStudio(): StudioApi {
  const studio = useContext(StudioContext);
  if (!studio) {
    throw new Error("useStudio는 StudioProvider 안에서만 쓸 수 있습니다");
  }
  return studio;
}
