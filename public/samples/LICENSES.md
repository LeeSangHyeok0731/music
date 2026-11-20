# 샘플 출처와 라이선스

이 파일은 `scripts/build-sample-pack.mjs`가 만든다 — 손으로 고치지 말고 `scripts/sample-pack.config.mjs`를 고친 뒤 `pnpm build:samples`를 다시 돌린다.
모든 원본은 아래 고정 커밋의 파일이고, 빌드가 그 커밋의 LICENSE 본문(CC0 1.0 Universal)과 GitHub API의 SPDX(`CC0-1.0`)를 확인한다.

## piano

- 팩 이름: VCSL (Versilian Community Sample Library) — Grand Piano, Steinway B
- 출처 URL: https://github.com/sgossner/VCSL/tree/c1ea7bcc3c7309650ab0da9d15c9cd1fbc4a4c7e/Chordophones/Zithers/Grand%20Piano%2C%20Steinway%20B (저장소 `sgossner/VCSL`, 커밋 `c1ea7bcc3c7309650ab0da9d15c9cd1fbc4a4c7e`)
- 라이선스: CC0 1.0 Universal
- 라이선스 확인 URL: https://github.com/sgossner/VCSL/blob/c1ea7bcc3c7309650ab0da9d15c9cd1fbc4a4c7e/LICENSE
- 내려받은 날짜: 2026-11-20
- 가공: 원본 44100Hz 2채널 → 채널 평균으로 모노 → 온셋(피크의 1%를 처음 넘는 곳) 5ms 앞에서 시작 → 2.5s로 자름 → 끝 150ms 코사인 페이드아웃 → 22050Hz로 재샘플링(카이저 창 sinc 저역통과, 컷오프 9923Hz) → 존마다 피크 0.85로 정규화 → 16비트 PCM 모노 WAV. 사용한 원본: `Chordophones/Zithers/Grand Piano, Steinway B/Sus/JHPiano_Sus_Close_C2_vl3_rr1.wav` → `p36.wav`, `Chordophones/Zithers/Grand Piano, Steinway B/Sus/JHPiano_Sus_Close_F#2_vl3_rr1.wav` → `p42.wav`, `Chordophones/Zithers/Grand Piano, Steinway B/Sus/JHPiano_Sus_Close_C3_vl3_rr1.wav` → `p48.wav`, `Chordophones/Zithers/Grand Piano, Steinway B/Sus/JHPiano_Sus_Close_F#3_vl3_rr1.wav` → `p54.wav`, `Chordophones/Zithers/Grand Piano, Steinway B/Sus/JHPiano_Sus_Close_C4_vl3_rr1.wav` → `p60.wav`, `Chordophones/Zithers/Grand Piano, Steinway B/Sus/JHPiano_Sus_Close_F#4_vl3_rr1.wav` → `p66.wav`, `Chordophones/Zithers/Grand Piano, Steinway B/Sus/JHPiano_Sus_Close_C5_vl3_rr1.wav` → `p72.wav`, `Chordophones/Zithers/Grand Piano, Steinway B/Sus/JHPiano_Sus_Close_F#5_vl3_rr1.wav` → `p78.wav`, `Chordophones/Zithers/Grand Piano, Steinway B/Sus/JHPiano_Sus_Close_C6_vl3_rr1.wav` → `p84.wav`, `Chordophones/Zithers/Grand Piano, Steinway B/Sus/JHPiano_Sus_Close_F#6_vl3_rr1.wav` → `p90.wav`, `Chordophones/Zithers/Grand Piano, Steinway B/Sus/JHPiano_Sus_Close_C7_vl3_rr1.wav` → `p96.wav`
- 사용한 녹음: 아티큘레이션 `Sus`(서스테인), 마이크 `Close`, 셈여림 `vl3`, 라운드로빈 `rr1`
- 원문: README.md: "The Versilian Community Sample Library is an open CC0 general-purpose sample library created by Versilian Studios LLC"
- 원문: README.md: "This collection is under a Creative Commons 0 license. Essentially it's Public Domain- you can do whatever you want with these sounds (even make commercial software), no royalties, no credit, no special terms."
- 원문: NORMALIZED.txt: "The sustain and non-sustain articulations for this instrument have been normalized."

## guitar

- 팩 이름: Karoryfer Emily Guitar (karoryfer.emilyguitar)
- 출처 URL: https://github.com/sfzinstruments/karoryfer.emilyguitar/tree/b4920dc662fd9cad6dcaccdeecffdd91c8725d8c (저장소 `sfzinstruments/karoryfer.emilyguitar`, 커밋 `b4920dc662fd9cad6dcaccdeecffdd91c8725d8c`)
- 라이선스: CC0 1.0 Universal
- 라이선스 확인 URL: https://github.com/sfzinstruments/karoryfer.emilyguitar/blob/b4920dc662fd9cad6dcaccdeecffdd91c8725d8c/LICENSE
- 내려받은 날짜: 2026-11-20
- 가공: 원본 44100Hz 1채널 → 채널 평균으로 모노 → 온셋(피크의 1%를 처음 넘는 곳) 5ms 앞에서 시작 → 1.6s로 자름 → 끝 150ms 코사인 페이드아웃 → 22050Hz로 재샘플링(카이저 창 sinc 저역통과, 컷오프 9923Hz) → 존마다 피크 0.85로 정규화 → 16비트 PCM 모노 WAV. 사용한 원본: `notes/e2_mf_rr1.wav` → `p40.wav`, `notes/a2_mf_rr1.wav` → `p45.wav`, `notes/eb3_mf_rr1.wav` → `p51.wav`, `notes/a3_mf_rr1.wav` → `p57.wav`, `notes/eb4_mf_rr1.wav` → `p63.wav`, `notes/a4_mf_rr1.wav` → `p69.wav`, `notes/eb5_mf_rr1.wav` → `p75.wav`, `notes/a5_mf_rr1.wav` → `p81.wav`
- 비고: 일렉트릭 기타 직결 녹음이다(어쿠스틱 아님). CC0 어쿠스틱 기타 단음 샘플을 찾지 못해 이 팩을 쓴다.
- 사용한 녹음: `notes/`의 셈여림 `mf`, 라운드로빈 `rr1`
- 원문: readme.txt: "Epiphone Emily the Strange guitar played and mapped by D. Smolken."
- 원문: readme.txt: "All samples recorded direct, using both pickups and all knobs on ten."
- 원문: readme.txt: "Royalty-free for all commercial and non-commercial use. Copyright 2014 Karoryfer Lecolds." (저장소의 LICENSE 파일은 CC0 1.0 Universal)

## bass

- 팩 이름: Karoryfer Growly Bass (karoryfer.growlybass)
- 출처 URL: https://github.com/sfzinstruments/karoryfer.growlybass/tree/4f483268fc66b5a6d5781d421c0d11b8d08d3fc6 (저장소 `sfzinstruments/karoryfer.growlybass`, 커밋 `4f483268fc66b5a6d5781d421c0d11b8d08d3fc6`)
- 라이선스: CC0 1.0 Universal
- 라이선스 확인 URL: https://github.com/sfzinstruments/karoryfer.growlybass/blob/4f483268fc66b5a6d5781d421c0d11b8d08d3fc6/LICENSE
- 내려받은 날짜: 2026-11-20
- 가공: 원본 44100Hz 1채널 → 채널 평균으로 모노 → 온셋(피크의 1%를 처음 넘는 곳) 5ms 앞에서 시작 → 1.4s로 자름 → 끝 150ms 코사인 페이드아웃 → 22050Hz로 재샘플링(카이저 창 sinc 저역통과, 컷오프 9923Hz) → 존마다 피크 0.85로 정규화 → 16비트 PCM 모노 WAV. 사용한 원본: `sustain/db2_f_rr1.wav` → `p25.wav`, `sustain/gb2_f_rr1.wav` → `p30.wav`, `sustain/c3_f_rr1.wav` → `p36.wav`, `sustain/gb3_f_rr1.wav` → `p42.wav`, `sustain/c4_f_rr1.wav` → `p48.wav`, `sustain/gb4_f_rr1.wav` → `p54.wav`, `sustain/c5_f_rr1.wav` → `p60.wav`
- 비고: 원본 파일 이름(과 SFZ의 pitch_keycenter)은 실제로 울리는 음보다 한 옥타브 위다(베이스 기보 관례). readme의 "low E string was also sampled tuned down to C#"대로 가장 낮은 `db2`는 C#1이다. 존의 centerPitch는 실제로 울리는 음(파일 이름 − 12)이고, 빌드가 존마다 기본 주파수를 추정해 ±50센트 안인지 확인한다.
- 사용한 녹음: `sustain/`의 셈여림 `f`, 라운드로빈 `rr1`
- 원문: readme.txt: "Sample library of a Squier Jazz Bass played by a bassist with very good hair, edited and mapped by a bassist with a shaved head."
- 원문: readme.txt: "Regular EADG tuning, though the low E string was also sampled tuned down to C#." / "All samples recorded direct, using both pickups and all knobs on 10."
- 원문: readme.txt: "Royalty-free for all commercial and non-commercial use." / "Copyright 2014 Karoryfer Lecolds." (저장소의 LICENSE 파일은 CC0 1.0 Universal)

## drums

- 팩 이름: Virtuosity Drums
- 출처 URL: https://github.com/sfzinstruments/virtuosity_drums/tree/9f04cf9a734527edfbb0a4eee1f674e45bbf71bc (저장소 `sfzinstruments/virtuosity_drums`, 커밋 `9f04cf9a734527edfbb0a4eee1f674e45bbf71bc`)
- 라이선스: CC0 1.0 Universal
- 라이선스 확인 URL: https://github.com/sfzinstruments/virtuosity_drums/blob/9f04cf9a734527edfbb0a4eee1f674e45bbf71bc/LICENSE
- 내려받은 날짜: 2026-11-20
- 가공: 원본 48000Hz 2채널 → 채널 평균으로 모노 → 온셋(피크의 1%를 처음 넘는 곳) 5ms 앞에서 시작 → 자른 길이 kick 0.5s, snare 0.5s, hihat 0.3s → 끝 40ms 코사인 페이드아웃 → 22050Hz로 재샘플링(카이저 창 sinc 저역통과, 컷오프 9923Hz) → 세 소리에 같은 게인을 적용해 가장 큰 피크 0.85로 정규화 → 16비트 PCM 모노 WAV. 사용한 원본: `Samples/mid/kick/mid_kick_snon_vl4_rr1.flac` → `kick.wav`, `Samples/mid/snare/mid_snare_center_vl29.flac` → `snare.wav`, `Samples/mid/hh/mid_hh_closed_vl4_rr1.flac` → `hihat.wav`
- 고른 근거(kick.wav): kick - Snares On, mid 마이크, vl4(lovel=96) rr1 — 기본 키맵의 36번(KICK_SNRIGHT_KEY)
- 고른 근거(snare.wav): snare - Center Hit, mid 마이크, vl29(lovel=99, hivel=102) — 기본 키맵의 38번(SNARE_CENTER_KEY)
- 고른 근거(hihat.wav): hi-hat - Closed Hit, mid 마이크, vl4(lovel=96) rr1 — 기본 키맵의 42번(HH_CLOSED_KEY)
- 사용한 녹음: 마이크 위치 `mid`(스테레오)
- 원문: README.md: "Contemporary Jazz drum kit library, performed with sticks, recorded at Virtuosity Musical Instruments in Boston, MA." (원문의 링크 표기 생략)
- 원문: README.md: "It features performances by drummer Austin McMahon on the shop's “house kit”" (원문의 큰따옴표를 바꿔 적음)
- 원문: README.md: "For more information please contact Versilian Studios"
