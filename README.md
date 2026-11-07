# Archive Lore · 아카이브 로어

[Memory Books](https://github.com/aikohanasaki/SillyTavern-MemoryBooks)를 기반으로 UI와 실행 흐름을 개편한 포크입니다.

- 채팅방에서 마지막 수집 위치 다음부터 버튼 한 번으로 수집
- 메시지 수·토큰 수 기준 자동 수집 · 버퍼 없음 · 지난 대화 범위 분할 수집
- 수집·임베딩 성공 후 자동 숨김 · 최근 수집 메시지 보존 개수 입력
- 기억 → 아크 → 통합 아크 · 짧게 다듬기·원문으로 다시 만들기 · 초안 확인 후 적용
- 수집 후 별도 API 키로 자동 임베딩 · 실패한 임베딩만 재시도
- **대화로 검색 / 질문으로 검색** 후 필요한 원문만 선별해 주입
- 영어 기억 요약: 제목 + 날짜·장소 한 줄 + 사건 문단
- 관계·약속·취향·감정·전환점·계획을 **6개 개별 사이드 항목**으로 저장하고 변경된 내용만 갱신
- 사이드별 프롬프트·이름 편집, 켜기·끄기, 사용자 항목 추가 · 켠 항목은 기억 수집과 같은 요청으로 실행
- 관계·이별·재회 D+를 RP 날짜로 계산 · 날짜 직접 수정 가능
- 변경 전 사이드 기록 보존 · 기본 프롬프트 편집 및 가져오기/내보내기
- AI Studio / Vertex 임베딩 키 직접 입력 · 기본 모델 자동 적용 · 실제 API 오류 표시
- 서버 플러그인: 브라우저 종료 후에도 접수된 수집·임베딩·검색·기억 정리 계속 실행
- 서버 작업·벡터·진단·초안 저장 및 재접속 후 확인
- 턴별 검색·선별·주입 진단 기록과 TXT 다운로드
- 로어북 매니저의 기존 번역 표시 · 프롬프트 전체화면 편집
- SillyTavern 테마를 따르는 모바일 UI · 슬래시 명령어

설치 주소: `https://github.com/foreverharibo-boop/archive-lore`

[설치·동작·제한 사항](userguides/1%20Memory_Books_AI_Reference_Manual.md) · [기본 프롬프트](prompts/archive-lore-defaults.json)

**0.3.1:** 자동화·브라우저 모의 검사는 완료했으며, 실제 모델의 기억 수집 품질과 사용자 SillyTavern 환경에서의 검증은 아직 필요합니다.

서버 플러그인은 같은 저장소를 SillyTavern의 `plugins/archive-lore-server`에도 설치합니다. 확장과 서버 복사본을 함께 업데이트해 주세요. [설치 명령·서버 모드 안내](userguides/1%20Memory_Books_AI_Reference_Manual.md#server-plugin-installation-and-lifecycle)

**0.3.1 정정:** Vertex 임베딩을 일괄 차단한 0.3.0 처리를 제거했습니다. AI Studio는 API 키, Vertex는 API 키·Google Cloud 프로젝트 ID·리전(기본 `global`)으로 요청합니다. 기존 아카이브의 요청 경로를 확인해 Archive Lore 안에 독립적으로 구현했습니다. 기억 작성·검색 프로필과 임베딩 설정도 구분했습니다. 두 제공자의 요청·응답 모의 검사를 통과했으며 실제 키 권한·한도는 연결 확인으로 점검해 주세요.

Original Memory Books © 2024–2026 Aiko Hanasaki. Archive Lore modifications © 2026 foreverharibo-boop. [AGPL-3.0-only](LICENSE).
