# ompgui 모바일 우선 UI 정돈·성능 리팩토링 플랜

기준: 2026-09-01 코드베이스 전수 감사 (모바일 UX / 채팅 렌더링 / 네트워크·데이터 / 디자인 시스템 4개 영역).

이 문서는 폰 원격 사용(Tailscale Funnel 등 고지연 터널 + Capacitor WebView/PWA)을 최우선으로, UI를 상용 에이전트(Codex 데스크탑, Cursor 데스크탑) 수준으로 끌어올리기 위한 우선순위와 안전 조건을 정리한다. `context/loading-improvement-roadmap.md`(이하 "로딩 로드맵")를 대체하지 않고 확장한다.

## 현재 상태 요약 — 이미 잘 되어 있는 것

- 로딩 로드맵 P1(history/runtime 준비 분리)은 구현됨: 병렬 fetch, `SessionReadiness`, `matchesStateLoadFence`, runtime 준비 전 mutation 비활성.
- 로딩 로드맵 P2(raw-entry 파싱 캐시 공유)는 구현됨: `getSessionDocument` file-identity 키 + frozen entries, subagent history와 공유.
- 스트리밍은 프레임당 1회 setState로 억제됨: 서버 33ms coalescing(`lib/sse-message-update-coalescer.ts`) + 클라이언트 rAF coalescing(`lib/message-update-coalescer.ts`). 커밋된 히스토리는 토큰마다 재렌더되지 않는다(`CommittedTranscript` memo + 라이브 버블 분리, `ChatWindow.tsx:966-990`).
- 코드 하이라이트는 스트림 중 plain `<pre>`, 종료 후 1회 Prism(`MermaidBlock.tsx:271-282`). Mermaid/KaTeX는 lazy chunk.
- 팔레트/스페이싱/모션 토큰 계층이 `app/globals.css`에 존재하고 `components/ui/field.tsx`에 표준 폼 킷이 있다 — 문제는 이를 우회하는 화면들이다.

로딩 로드맵 P3(session-bound lazy media), P4(서버 pagination), P5(홈 metadata 정리)는 **미구현**으로 확인됨. 본 문서의 배치 2·3이 이와 맞물린다.

---

## 배치 1 — 모바일 퀵윈 (체감 최우선, 회귀 위험 낮음)

### 1-1. IME(가상 키보드)가 composer를 가림 [P0, M]

- 셸이 `height: 100dvh; overflow: hidden` 고정(`app/layout.tsx:61`, `globals.css:304-318`, `AppShell.tsx:1056`). `dvh`는 IME를 추적하지 않는다.
- `visualViewport`는 모델 드롭다운 위치 계산에만 사용(`ChatInput.tsx:2214-2216`). 채팅 컬럼 축소·textarea scroll-into-view 없음.
- Android: `MainActivity.kt:18-46`이 `systemBars|displayCutout` 인셋만 적용하고 `Type.ime()` 미적용. `AndroidManifest.xml`에 `windowSoftInputMode` 없음.

방향:
- viewport meta에 `interactive-widget=resizes-content` + `visualViewport.height` 기반 레이아웃 높이 바인딩(웹 공통).
- Android는 `windowSoftInputMode=adjustResize` + 인셋 리스너에 `Type.ime()` 추가. CSS safe-area와 네이티브 패딩이 **이중 적용되지 않도록** 한쪽으로 정리.
- 검증: 키보드 열림 상태에서 전송 버튼 노출, 키보드 닫힘 시 레이아웃 복원, iOS PWA/Android WebView/모바일 브라우저 3곳.

### 1-2. Android 뒤로가기 미처리 [P0, S/M]

- 드로어는 backdrop 클릭으로만 닫힘(`AppShell.tsx:1058-1070`). `MainActivity.kt`에 back 오버라이드 없음. `remote-bootstrap.js`는 `location.replace` 사용으로 히스토리 스택도 없음.
- 방향: back 우선순위 = 열린 다이얼로그/시트 → 드로어 → 파일 패널 → (셸에서) 원격 이탈 확인 → 종료. 웹은 `popstate` 기반, 셸은 `OnBackPressedCallback`.

### 1-3. 터치 타깃·입력 줌·터치 피드백 [P1, S]

- 전송 34px(`--composer-send-size`), 컨트롤 32px(`--composer-control-h`), 링 28px(`globals.css:1823-1831, 2310-2321`), 탭 닫기 24px + `onMouseEnter` hover(`TabBar.tsx:24,144-166`), 세션 복사 22px(`AppShell.tsx:1425-1445`).
- textarea 14px(`ChatInput.tsx:2130`) + `maximum-scale` 없음(`layout.tsx:29-36`) → iOS 포커스 줌.
- `touch-action: manipulation`이 일부 composer 버튼에만 있음. `:active` 상태 거의 없음.
- 방향: ≤640px에서 composer 토큰을 44px로, 입력 폰트 16px, `html/button/a`에 `touch-action: manipulation` + `-webkit-tap-highlight-color`, hover 페인팅을 `:active`/`:focus-visible`로 대체.
- 주의: `maximum-scale=1`은 접근성(핀치 줌) 문제를 만들므로 입력 16px로 해결하고 스케일 제한은 넣지 않는다.

### 1-4. safe-area·PWA·셸 정합 [P1→P2, S]

- 상단 topbar/드로어에 `safe-area-inset-top` 없음(하단 composer만 처리, `ChatInput.tsx:1546`). iOS standalone에서 노치 밑으로 그려짐(`appleWebApp.statusBarStyle: "default"` + `viewportFit: cover`).
- manifest `theme_color: #0f0a14`가 실제 팔레트(`#FAF9F6`/`#1B1916`)와 불일치, maskable 아이콘 없음(`app/manifest.ts:10-11`).
- `remote-bootstrap.css`가 `100vh` 사용(`:13-21`). Capacitor에 StatusBar/Keyboard 플러그인 미도입(`capacitor.config.ts`).

### 1-5. 데스크톱형 팝오버 → 모바일 시트 [P1, M]

- 모델/thinking/슬래시/@/히스토리 피커가 composer 위 `position:absolute` 팝오버(`ChatInput.tsx:1811-1820, 2213-2228, 2348-2354`) — 가로모드+IME에서 잘림.
- 커맨드 팔레트는 Cmd/Ctrl+K 전용(`CommandPalette.tsx:42-55`) + `paddingTop: 20vh`(`:62`) — 터치 진입 수단 없음.
- 방향: ≤640px에서 피커를 bottom sheet 렌더로 전환(내용/상태 로직 공유, 컨테이너만 분기), topbar에 검색/팔레트 버튼 추가, 팔레트를 하단 정렬로.

---

## 배치 2 — 네트워크 회복력 (고지연 터널 대응)

### 2-1. 딥링크 세션 열기가 전체 세션 목록을 대기 [P0, M]

- URL 복원 시 `allSessions.length`가 찰 때까지 `onSelectSession`을 미룸(`SessionSidebar.tsx:1181-1189`) → 그 후에야 `load()`(`useAgentSession.ts:3416-3424`). Funnel 1왕복(전 세션 `firstMessage` 포함 목록 JSON)이 첫 트랜스크립트 페인트 앞에 낭비된다.
- 방향: 세션 id 복원은 목록과 독립적으로 즉시 history+state fetch를 시작. 사이드바 목록은 병렬로 채운다. 목록 의존 데이터(제목 등)는 도착 후 보강.
- fence: 기존 `sessionId + sessionLoadGeneration` 계약 유지.

### 2-2. visibility 기반 SSE/폴링 수명주기 [P1, M]

- 백그라운드 복귀 시 EventSource를 재생성하지 않음. 재연결은 `agentRunning`일 때 1000ms 고정뿐(`useAgentSession.ts:841-860`). idle 세션의 `session_closed`는 자동 재연결 없음(`:1522-1530`).
- 15s reconcile(`:2072-2093`), subagent 5s, bash 1s, MessageView 300ms tick 등이 `document.hidden`에서도 지속 — 셀룰러 radio tail 배터리 소모.
- running SSE에 `X-Accel-Buffering: no` 없음(`app/api/agent/running/events/route.ts:74-80`).
- 방향: `visibilitychange=visible`/`online`에서 현재 세션 SSE `ensure()` 무조건 수행 + 지수 백오프(상한), hidden 동안 클라이언트 interval 일시정지, 복귀 시 1회 reconcile로 따라잡기.
- 검증: 백그라운드 5분 후 복귀 시 놓친 `agent_end`/`sessions-changed` 반영, running badge 정확성 유지.

### 2-3. replica 첫 페인트 [P2, M — 로딩 로드맵 장기 후보와 동일 원칙]

- `lib/remote-replica.ts` 스냅샷은 저장만 되고 읽는 곳이 없음(persist: `useAgentSession.ts:3442-3456`).
- 방향: `history: loading` 동안 replica tail을 display-only로 표시. **runtime 활성화 금지, 서버 데이터 도착 시 전량 교체** — 로딩 로드맵의 "캐시=표시용, 서버=권위" 원칙 그대로.

### 2-4. 홈/모델 중복 fetch 정리 [P2, S/M]

- `AppShell.tsx:775`(ETag 없는 목록 fetch), `CommandPalette.tsx:35`(별도 fetch), 모델 `cache: "no-store"` 매 세션 fetch(`useAgentSession.ts:3069`). 방향: 클라이언트 공용 세션 목록 스토어 + 구독, 모델 클라이언트 SWR. `loadModels`/`hydrateSelectedSession`에 세션 generation fence 추가.

로딩 로드맵 P3(lazy media)·P4(pagination)는 별도 대형 작업으로 로드맵 문서의 계약을 따른다. 본 배치와 동시 진행하지 않는다.

---

## 배치 3 — 렌더링 성능 (저사양 WebView CPU)

### 3-1. 스트리밍 중 누적 마크다운 전체 재파싱 [P1, M/L]

- coalesced 프레임마다 `normalizeDisplayMath(전체 누적 텍스트)` + 전체 `ReactMarkdown` 재파싱(`MarkdownBody.tsx:20,127-135`, `lib/markdown.ts:99+`). 답변 길이에 비례해 프레임당 비용 증가 — 저사양 폰의 지배적 CPU 비용.
- 방향(안전 순서): (a) 스트리밍 텍스트를 "안정 구간(마지막 완결 블록 경계 이전)"과 "성장 꼬리"로 분할해 안정 구간은 memo, 꼬리만 재파싱. 블록 경계는 빈 줄/펜스 닫힘 기준의 보수적 분할이어야 하며, 열린 코드펜스·수식 내부에서 자르지 않는다. (b) 그 전 단계 퀵윈: 스트리밍 중 remark-gfm/rehype-raw/sanitize 파이프라인 축소 여부 검토(출력 차이 없음이 증명될 때만).
- 검증: 분할 렌더 결과가 스트림 종료 후 전체 파싱 결과와 시각적으로 동일(펜스/표/수식 걸침 케이스 포함).

### 3-2. DOM 누적 — 위로 페이징 시 언마운트 없음 [P1, M]

- 윈도우는 `startIndex..end` slice라 +50 페이징마다 mounted node가 **증가**만 함(`ChatWindow.tsx:392-418`, `lib/chat-lazy-load.ts`). 최악에는 전체 트랜스크립트가 DOM 상주.
- 방향: 완전 가상화 이전 단계로, 뷰포트에서 멀어진 하단/상단 그룹을 창 밖으로 내리는 양방향 윈도우(현 페이징 구조 유지) + scroll anchor 보존. 서버 pagination(로딩 로드맵 P4)과 계약이 겹치지 않도록 클라이언트 windowing만 담당.

### 3-3. 프레임당 scrollIntoView·부수 setState [P2, S]

- follow-scroll effect가 streamState 등 광범위 deps로 매 프레임 `scrollIntoView` 호출(`useAgentSession.ts:3341-3350, 3495-3544`). 방향: 이미 바닥에 붙어 있으면 `scrollTop` 직접 설정 + 픽셀 변화 없을 때 skip, deps 축소.
- 라이브 버블의 TPS `setInterval` 300ms(`MessageView.tsx:456-510`) → 1s로 완화하거나 rAF-정렬. `agentPhase` null 재설정(`useAgentSession.ts:2166`) bail-out 확인.
- ChatInput/ComposerPanels가 토큰 프레임마다 부모 재조정에 끌려감 — props 안정화 + memo 경계 점검.

### 3-4. 하이라이터 부하 [P2, S]

- `lib/syntax-highlight.ts`가 32개 grammar를 하이라이터 chunk에 eager 포함(과거 lazy가 Turbopack에서 깨진 이력 코멘트 존재 — 재시도 시 반드시 재검증). `showLineNumbers`가 라인당 DOM을 배가 — 모바일에서 긴 펜스는 라인 넘버 생략 검토.

---

## 배치 4 — 디자인 시스템 정돈 (Codex/Cursor 수준)

### 4-1. 트랜스크립트 chrome [P0, M]

- 컬럼 960px(`lib/chat-layout.ts:4-7`) vs Codex/Cursor ~720px. 마크다운 14px/1.7 하드코딩(`globals.css:374-376`). user 버블 accent border+shadow(`MessageView.tsx:244-257`), 툴콜이 성공/실패 색 박스(`:770-777`) — Cursor의 조용한 hairline+mono 칩 대비 시끄러움.
- 복사/포크가 hover 전 opacity 0(`:297-303, 591-601`) — **터치에서 접근 불가**.
- 방향: 컬럼 ~720-760px, prose 13-14px/1.5, 툴 칩은 1px `--border` + mono 이름(오류만 색), coarse pointer에서 액션 row 상시 노출(44px).

### 4-2. 공용 컨트롤 킷 통일 [P0, M]

- `field.tsx` 표준 킷이 있는데 Settings가 자체 `ToggleSwitch`(36×20, 44px 히트 타깃 없음, `SettingsConfig.tsx:231-266`)와 `nativeSelectStyle` 재발명. 로그인 input은 포커스 링 없음(`LoginForm.tsx:47-57`). 탭이 3가지 시각 언어(`SettingsTabs.tsx:113-126` vs `176-183` vs `245`).
- 방향: Button/Input/Switch/Tabs를 field.tsx 기반으로 단일화, 중복 구현 삭제. `ConfirmDialog` primary의 `onMouseLeave` 색 스냅 버그와 미사용 `danger` variant 정리(`field.tsx:678-701`).

### 4-3. 타이포·radius 토큰화 [P1, S/M]

- `html` 14px vs `--text-base` 13px 불일치(`globals.css:218-224, 304-312`). 인라인 10/10.5/11/11.5/12.5/15/28px 산재(SettingsConfig, SettingsTabs, LoginForm, CommandPalette, ChatInput, MessageView). radius 6/7 vs 토큰 8/12.
- 방향: 전 화면 `--text-*`/`--radius-*` 강제, 10~11.5px 제거. 아이콘 규격: chrome 16/2, inline 14/1.75, chip 12/2.

### 4-4. 테마·모션·상태 표현 [P1, S]

- Graphite 팔레트: 앰버 액센트(`--accent: #FEBC38`)에 파란 포커스 링(`--focus-ring-color: #0088FA`, `globals.css:158-183`).
- `prefers-reduced-motion`이 사이드바 전환에만 적용(`:3513-3521`) — live pulse, dialog pop-in, mermaid spin 미적용. 전역 reduce 규칙 추가.
- 토스트 상단 우측 + 20px 닫기(`toast.tsx:109-175`) → 모바일 하단 + safe-area + 44px. coarse pointer에서 hover 툴팁 비활성.
- 스켈레톤 부재: 사이드바/설정/팔레트가 "Loading…" 텍스트뿐. `--bg-hover` 기반 3줄 pulse 스켈레톤 도입. 팔레트의 로딩/빈/오류 상태 구분(`CommandPalette.tsx:33-39,68` — fetch 실패가 빈 목록으로 위장됨).

---

## 권장 실행 순서

```text
1. 배치 1 (모바일 퀵윈) — 1-1 IME, 1-2 back, 1-3 터치, 1-4 safe-area/PWA, 1-5 시트
2. 배치 2 (네트워크) — 2-1 딥링크, 2-2 visibility SSE/폴링, 2-4 중복 fetch, 2-3 replica
3. 배치 4 중 4-4·4-3 (S 항목) — 배치 3보다 먼저 해도 회귀 위험 낮음
4. 배치 3 (렌더링) — 3-3/3-4 퀵윈 → 3-2 windowing → 3-1 증분 마크다운
5. 배치 4 중 4-1·4-2 (트랜스크립트/컨트롤 킷 — 시각 변화가 커서 스크린샷 비교 필수)
6. 로딩 로드맵 P3/P4는 별도 트랙 (본 플랜과 동시 변경 금지)
```

## 공통 안전 조건

- 성능 변경은 저사양 프로파일(Chrome DevTools CPU 4-6x throttle + Fast 3G)로 전후 계측한다. 계측 없는 "최적화" 커밋 금지.
- fence 계약(`sessionId + generation`)을 약화시키는 지름길 금지. replica/캐시는 display-only.
- 렌더링 변경은 스트리밍 중·후 출력 동일성(마크다운/펜스/수식/툴콜)을 확인한다.
- 시각 변경은 라이트/다크 × warm/graphite 4조합 + ≤640px에서 확인한다.
- Android 셸 변경(IME, back)은 APK 재빌드가 필요하므로 웹 측 변경과 커밋을 분리한다.
- `npm run typecheck`, `npm run lint`, `npm test`를 배치 단위로 통과시킨다 (dev 중 `next build` 금지 — AGENTS.md).
