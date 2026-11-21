"use client";

import { VELOCITY_LANE_HEIGHT } from "./geometry";

/** 아래 세기 레인 자리. Task 5가 막대를 채운다. */
export function VelocityLane() {
  return (
    <div
      data-testid="roll-velocity"
      className="shrink-0 border-t border-white/10 bg-[#141519]"
      style={{ height: VELOCITY_LANE_HEIGHT }}
    />
  );
}
