/**
 * 편집 화면의 공유 치수. 헤더 열(좌)과 타임라인(우)이 같은 행 높이 상수를 써야
 * 행이 어긋나지 않는다. 격자의 가로 좌표는 `geometry.ts`가 맡는다.
 */

/** 좌측 헤더 열 폭(px). 코드 레인 라벨과 트랙 헤더가 쓴다. */
export const HEADER_WIDTH = 96;

/** 눈금자 높이(px). 헤더 열에도 같은 높이의 빈 칸을 둔다. */
export const RULER_HEIGHT = 28;

/** 코드 레인 행 높이(px). */
export const CHORD_LANE_HEIGHT = 40;

/** 트랙 레인 한 줄 높이(px). */
export const TRACK_LANE_HEIGHT = 56;

/**
 * 행 구분선. `border`는 박스 높이를 1px 먹어 헤더 열과 타임라인이 아래로 갈수록
 * 어긋나므로 행 아래쪽 안쪽 `boxShadow`로 긋는다(`style={{ boxShadow: ROW_DIVIDER }}`).
 */
export const ROW_DIVIDER = "inset 0 -1px 0 rgb(255 255 255 / 0.07)";
