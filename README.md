# Archive Lore · 아카이브 로어

[Memory Books](https://github.com/aikohanasaki/SillyTavern-MemoryBooks)를 기반으로 UI와 실행 흐름을 개편한 포크입니다.

- 채팅방에서 마지막 수집 위치 다음부터 버튼 한 번으로 수집
- 수집 후 별도 API 키로 자동 임베딩 · 실패한 임베딩만 재시도
- **대화로 검색 / 질문으로 검색** 후 필요한 원문만 선별해 주입
- 영어 기억 요약: 제목 + 날짜·장소 한 줄 + 사건 문단
- 관계·약속·취향·감정·전환점·계획을 **6개 개별 사이드 항목**으로 저장하고 변경된 내용만 갱신
- 관계·이별·재회 D+를 RP 날짜로 계산 · 날짜 직접 수정 가능
- 변경 전 사이드 기록 보존 · 기본 프롬프트 편집 및 가져오기/내보내기
- SillyTavern 테마를 따르는 모바일 UI · 슬래시 명령어

설치 주소: `https://github.com/foreverharibo-boop/archive-lore`

[설치·동작·제한 사항](userguides/1%20Memory_Books_AI_Reference_Manual.md) · [기본 프롬프트](prompts/archive-lore-defaults.json)

**0.1.1:** 자동화·브라우저 모의 검사는 완료했으며, 실제 모델의 기억 수집 품질과 사용자 SillyTavern 환경에서의 검증은 아직 필요합니다.

Original Memory Books © 2024–2026 Aiko Hanasaki. Archive Lore modifications © 2026 foreverharibo-boop. [AGPL-3.0-only](LICENSE).
