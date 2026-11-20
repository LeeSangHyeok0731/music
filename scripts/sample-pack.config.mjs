// 실제 샘플 팩의 출처와 존 구성. `scripts/build-sample-pack.mjs`가 읽는다.
//
// 모든 출처는 GitHub 저장소의 고정 커밋이다(재현성). 저장소의 LICENSE 본문과
// GitHub API의 SPDX(CC0-1.0)는 빌드할 때마다 다시 확인한다.
//
// 여기 적힌 사실(팩 이름·연주자·녹음 정보·원문 표기)은 각 저장소의 README /
// readme.txt / notes.txt / SFZ 프로그램을 직접 읽고 옮긴 것이다. 고칠 때도 원문을
// 읽고 고친다.

/** 출력 샘플레이트. Chrome·Firefox·Safari 모두 decodeAudioData로 읽는 PCM WAV. */
export const OUTPUT_RATE = 22050;

/** 피치 악기는 존마다 이 피크로 맞춘다. 드럼은 세 소리에 같은 게인을 써서 가장 큰 피크가 이 값. */
export const TARGET_PEAK = 0.85;

export const SOURCES = {
  vcsl: {
    owner: "sgossner",
    repo: "VCSL",
    sha: "c1ea7bcc3c7309650ab0da9d15c9cd1fbc4a4c7e",
  },
  emily: {
    owner: "sfzinstruments",
    repo: "karoryfer.emilyguitar",
    sha: "b4920dc662fd9cad6dcaccdeecffdd91c8725d8c",
  },
  growly: {
    owner: "sfzinstruments",
    repo: "karoryfer.growlybass",
    sha: "4f483268fc66b5a6d5781d421c0d11b8d08d3fc6",
  },
  virtuosity: {
    owner: "sfzinstruments",
    repo: "virtuosity_drums",
    sha: "9f04cf9a734527edfbb0a4eee1f674e45bbf71bc",
  },
};

const PIANO_DIR = "Chordophones/Zithers/Grand Piano, Steinway B/Sus";

/**
 * - `soundingOffset`: 파일 이름의 음(C4=60 규약)과 실제로 울리는 음의 차이(반음).
 *   존의 centerPitch는 실제로 울리는 음이다 — `manifest.ts`에서 centerPitch는
 *   재생 속도 1로 나는 음이다. 빌드가 기본 주파수를 추정해 ±50센트 안인지 확인한다.
 * - `seconds`: 온셋부터 자르는 길이. `fadeMs`: 끝 페이드아웃 길이.
 */
export const INSTRUMENTS = [
  {
    id: "piano",
    source: "vcsl",
    pitched: true,
    // 데모 곡의 피아노 화음은 120BPM에서 한 마디(2.0s) + 릴리스 0.08s 동안 울리고,
    // 존 안의 가장 높은 음은 최대 2^(3/12)≈1.19배 빠르게 재생되므로
    // 2.08 × 1.19 ≈ 2.48s가 필요하다.
    seconds: 2.5,
    fadeMs: 150,
    soundingOffset: 0,
    notes: ["C2", "F#2", "C3", "F#3", "C4", "F#4", "C5", "F#5", "C6", "F#6", "C7"],
    path: (note) => `${PIANO_DIR}/JHPiano_Sus_Close_${note}_vl3_rr1.wav`,
    info: {
      packName: "VCSL (Versilian Community Sample Library) — Grand Piano, Steinway B",
      sourceDir: "Chordophones/Zithers/Grand Piano, Steinway B",
      facts: [
        "README.md: \"The Versilian Community Sample Library is an open CC0 general-purpose sample library created by Versilian Studios LLC\"",
        "README.md: \"This collection is under a Creative Commons 0 license. Essentially it's Public Domain- you can do whatever you want with these sounds (even make commercial software), no royalties, no credit, no special terms.\"",
        "NORMALIZED.txt: \"The sustain and non-sustain articulations for this instrument have been normalized.\"",
      ],
      used: "아티큘레이션 `Sus`(서스테인), 마이크 `Close`, 셈여림 `vl3`, 라운드로빈 `rr1`",
    },
  },
  {
    id: "guitar",
    source: "emily",
    pitched: true,
    seconds: 1.6,
    fadeMs: 150,
    soundingOffset: 0,
    notes: ["e2", "a2", "eb3", "a3", "eb4", "a4", "eb5", "a5"],
    path: (note) => `notes/${note}_mf_rr1.wav`,
    info: {
      packName: "Karoryfer Emily Guitar (karoryfer.emilyguitar)",
      sourceDir: "",
      facts: [
        "readme.txt: \"Epiphone Emily the Strange guitar played and mapped by D. Smolken.\"",
        "readme.txt: \"All samples recorded direct, using both pickups and all knobs on ten.\"",
        "readme.txt: \"Royalty-free for all commercial and non-commercial use. Copyright 2014 Karoryfer Lecolds.\" (저장소의 LICENSE 파일은 CC0 1.0 Universal)",
      ],
      used: "`notes/`의 셈여림 `mf`, 라운드로빈 `rr1`",
      note: "일렉트릭 기타 직결 녹음이다(어쿠스틱 아님). CC0 어쿠스틱 기타 단음 샘플을 찾지 못해 이 팩을 쓴다.",
    },
  },
  {
    id: "bass",
    source: "growly",
    pitched: true,
    seconds: 1.4,
    fadeMs: 150,
    // 파일 이름은 한 옥타브 위로 적혀 있다(베이스 기보 관례). readme가 "Regular EADG
    // tuning, though the low E string was also sampled tuned down to C#"라고 하므로
    // 가장 낮은 `db2`는 C#1(MIDI 25)이고, 기본 주파수 추정도 `e2` ≈ 41.9Hz(E1)로
    // 같은 결론이다. SFZ(`growlybass_clean.sfz`)는 `db2`를 pitch_keycenter=37로
    // 매핑하는데, 그것은 연주 건반 관례이지 녹음된 음이 아니다.
    soundingOffset: -12,
    notes: ["db2", "gb2", "c3", "gb3", "c4", "gb4", "c5"],
    path: (note) => `sustain/${note}_f_rr1.wav`,
    info: {
      packName: "Karoryfer Growly Bass (karoryfer.growlybass)",
      sourceDir: "",
      facts: [
        "readme.txt: \"Sample library of a Squier Jazz Bass played by a bassist with very good hair, edited and mapped by a bassist with a shaved head.\"",
        "readme.txt: \"Regular EADG tuning, though the low E string was also sampled tuned down to C#.\" / \"All samples recorded direct, using both pickups and all knobs on 10.\"",
        "readme.txt: \"Royalty-free for all commercial and non-commercial use.\" / \"Copyright 2014 Karoryfer Lecolds.\" (저장소의 LICENSE 파일은 CC0 1.0 Universal)",
      ],
      used: "`sustain/`의 셈여림 `f`, 라운드로빈 `rr1`",
      note: "원본 파일 이름(과 SFZ의 pitch_keycenter)은 실제로 울리는 음보다 한 옥타브 위다(베이스 기보 관례). readme의 \"low E string was also sampled tuned down to C#\"대로 가장 낮은 `db2`는 C#1이다. 존의 centerPitch는 실제로 울리는 음(파일 이름 − 12)이고, 빌드가 존마다 기본 주파수를 추정해 ±50센트 안인지 확인한다.",
    },
  },
  {
    id: "drums",
    source: "virtuosity",
    pitched: false,
    fadeMs: 40,
    // 근거: Programs/keymaps/keymap.sfz(KICK_SNRIGHT_KEY 36, SNARE_CENTER_KEY 38,
    // HH_CLOSED_KEY 42)와 Programs/mappings/mid_all.sfz(36 + hicc21=100 → kick_snon_map,
    // 38 → snare_center_map, 42 → hh_closed_map; 06-mid-mic.sfz는 cc21을 설정하지
    // 않으므로 기본은 스네어 켜짐). 셈여림은 MIDI 벨로시티 100 근처의 층이다.
    hits: [
      {
        name: "kick",
        pitch: 36,
        seconds: 0.5,
        path: "Samples/mid/kick/mid_kick_snon_vl4_rr1.flac",
        why: "kick - Snares On, mid 마이크, vl4(lovel=96) rr1 — 기본 키맵의 36번(KICK_SNRIGHT_KEY)",
      },
      {
        name: "snare",
        pitch: 38,
        seconds: 0.5,
        path: "Samples/mid/snare/mid_snare_center_vl29.flac",
        why: "snare - Center Hit, mid 마이크, vl29(lovel=99, hivel=102) — 기본 키맵의 38번(SNARE_CENTER_KEY)",
      },
      {
        name: "hihat",
        pitch: 42,
        seconds: 0.3,
        path: "Samples/mid/hh/mid_hh_closed_vl4_rr1.flac",
        why: "hi-hat - Closed Hit, mid 마이크, vl4(lovel=96) rr1 — 기본 키맵의 42번(HH_CLOSED_KEY)",
      },
    ],
    info: {
      packName: "Virtuosity Drums",
      sourceDir: "",
      facts: [
        "README.md: \"Contemporary Jazz drum kit library, performed with sticks, recorded at Virtuosity Musical Instruments in Boston, MA.\" (원문의 링크 표기 생략)",
        'README.md: "It features performances by drummer Austin McMahon on the shop\'s “house kit”" (원문의 큰따옴표를 바꿔 적음)',
        "README.md: \"For more information please contact Versilian Studios\"",
      ],
      used: "마이크 위치 `mid`(스테레오)",
    },
  },
];
