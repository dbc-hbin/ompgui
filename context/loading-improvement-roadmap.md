# ompgui 로딩 개선 로드맵

기준 커밋: `5ed94e7` (`Improve home and session loading`)

이 문서는 홈 진입과 기존 세션 열기의 후속 개선 후보를 우선순위와 안전 조건 중심으로 정리한다. 구현 계획을 고정하는 문서가 아니라, 다음 작업에서 같은 문제를 다시 조사하거나 이미 거부된 지름길을 반복하지 않기 위한 컨텍스트다.

## 완료된 안전 개선

- 홈에서 `ChatWindow`를 정적으로 포함하지 않고 필요할 때 동적 로드한다.
- 직접 session/cwd 복원과 세션 행 intent에서 `ChatWindow` 청크를 prewarm한다.
- speculative preload 실패는 처리하되 실제 dynamic render 실패는 숨기지 않는다.
- OMP·ompgui 업데이트 확인은 첫 paint 이후 실행한다.
- 숨겨진 모바일 사이드바는 `FileExplorer`의 최초 mount를 지연한다.
- 초기 running SSE가 첫 `/api/sessions` 요청을 중단하지 않도록 refresh를 buffer한다.
- sidebar unmount와 React Strict Mode replay에서 stale fetch/timer/SSE callback을 lifecycle generation으로 차단한다.
- session list에서 소비하지 않는 status용 32KiB tail read를 제거했다.

## 우선순위 1 — 기록 표시와 runtime 준비 분리

### 문제

기존 세션을 열 때 현재 흐름은 대략 다음과 같다.

```text
GET /api/sessions/:id
→ 전체 기록 수신
→ GET /api/sessions/:id/state
→ state 응답 이후 loading 해제
```

대화 기록이 이미 도착했는데도 원격/Funnel 왕복이 필요한 `/state` 때문에 화면 공개가 늦어진다.

### 목표

```ts
type SessionReadiness = {
  history: "idle" | "loading" | "ready" | "error";
  runtime: "idle" | "loading" | "ready" | "error";
};
```

- history와 state 요청을 동시에 시작한다.
- history가 먼저 도착하면 transcript를 즉시 표시한다.
- runtime이 준비되기 전에는 상태를 변경하는 모든 기능을 비활성화한다.
- state 실패를 idle로 간주하지 않는다. 기록은 read-only로 유지하고 명시적인 재시도를 제공한다.

### runtime 준비 전 반드시 비활성화할 기능

- 메시지 전송
- fork
- branch 이동
- 모델·thinking 변경
- compaction
- attachment 변경
- 기타 RPC mutation

### 필수 fence

모든 history/state 응답은 최소한 다음 키로 현재 요청인지 확인해야 한다.

```text
sessionId + requestGeneration
```

A 세션을 여는 중 B 세션으로 전환했을 때 A의 늦은 응답이 B를 덮어쓰면 안 된다.

### 하지 말 것

- 기존 `includeState=1`을 초기 open에 그대로 사용하지 않는다. 현재 route는 `get_state`를 await하므로 transcript 응답까지 다시 막는다.
- state 실패 시 기본값인 `agentRunning=false`를 신뢰하지 않는다.

### 검증 조건

- 실행 중인 세션과 bash 실행 중인 세션에서 state 전 mutation이 불가능하다.
- state 실패 시 기록은 보이지만 입력은 read-only다.
- 빠른 A → B 전환에서 A의 history/state 응답이 폐기된다.
- SSE 재연결과 host tool/URI 등록은 runtime 준비 후 기존 동작을 유지한다.

## 우선순위 2 — 세션 JSONL 중복 파싱 제거

### 문제

초기 세션 open과 subagent history hydration이 같은 parent JSONL을 각각 파싱할 수 있다. 큰 세션에서는 서버 CPU·메모리와 응답 시작 시간이 함께 증가한다.

### 방향

이미 존재하는 raw-entry cache를 확장해서 session open과 subagent history가 공유하도록 한다.

캐시 불변조건:

- key는 canonical path와 file identity/version을 포함한다.
- 캐시된 raw entry는 immutable로 취급한다.
- UI projection과 blob resolution은 response-owned copy에서 수행한다.
- rename/delete/import/title 변경과 외부 append를 올바르게 무효화한다.
- cache에 resolved base64를 보관하지 않는다.

### 하지 말 것

- 별도의 두 번째 parsed-session cache를 만들지 않는다.
- `resolveBlobRefsInEntries()`처럼 entry를 mutate하는 작업을 shared cache object에 수행하지 않는다.
- path + size + mtime만으로 blob store 변경까지 유효하다고 가정하지 않는다.

### 검증 조건

- 같은 세션의 동시 open/subagent 요청이 raw parse를 공유한다.
- full-media open 후 deferred-media open의 응답이 base64로 오염되지 않는다.
- append, rename, delete 후 stale entry가 반환되지 않는다.
- 반복 open에서 cache의 base64 메모리가 증가하지 않는다.

## 우선순위 3 — session-bound lazy media

### 문제

현재 `deferMedia`는 tool-result image 일부만 제외한다. user/assistant image와 다른 blob은 세션 open 응답에 base64로 포함될 수 있어 초기 payload가 커진다.

### API 방향

전역 hash endpoint 대신 세션의 실제 entry/block reference에 바인딩한다.

```http
GET /api/sessions/:sessionId/entries/:entryId/media/:blockIndex
```

서버는 다음을 검증해야 한다.

1. app 인증
2. session ID와 파일 해석
3. entry/block이 요청한 blob을 실제로 참조하는지 확인
4. blob hash 형식과 blob root confinement
5. 허용 MIME과 최대 크기
6. 누락·삭제된 blob의 안전한 404 처리

클라이언트는 viewport에 필요한 이미지부터 요청하고, in-flight dedupe와 bounded LRU를 사용한다. 이미지 크기나 aspect placeholder를 확보해 로딩 중 scroll shift를 막는다.

### 하지 말 것

- `GET /api/blobs/:hash`처럼 인증된 사용자가 임의의 global blob hash를 조회할 수 있게 하지 않는다.
- raw filesystem path를 응답하지 않는다.
- lazy image가 실패했을 때 콘텐츠를 조용히 지우지 않는다.

### 검증 조건

- 정상 reference만 byte를 반환한다.
- forged·unreferenced hash, 다른 세션의 hash, 삭제된 세션과 누락 blob은 bytes를 유출하지 않는다.
- above-fold image만 초기 요청된다.
- 이미지 완료 전후 scroll anchor가 유지된다.

## 우선순위 4 — branch-aware 서버 history pagination

### 문제

클라이언트는 최근 메시지만 mount하지만 서버는 여전히 전체 JSONL을 파싱하고 전체 context를 직렬화해 전송한다. 따라서 긴 세션의 네트워크 payload와 브라우저의 배열 가공 비용은 줄지 않는다.

### 응답 계약 후보

```ts
type SessionHistoryPage = {
  sessionId: string;
  leafId: string;
  fileGeneration: string;
  items: Array<{
    message: AgentMessage;
    entryId: string;
  }>;
  beforeCursor: string | null;
  hasOlder: boolean;
};
```

초기 open은 bounded 최신 page만 반환하고, 과거 기록은 `beforeCursor`로 가져온다. Paseo의 bounded tail/before cursor 구조를 참고하되 OMP session tree와 compaction 의미를 우선한다.

### 페이지 경계

raw JSONL line이나 단순 message count가 아니라 reconstructed turn 단위로 자른다.

```text
user
assistant toolCall
관련 toolResult
assistant final
```

이 묶음이 페이지 경계에서 분리되지 않아야 한다.

### 반드시 보존할 의미

- 선택한 `leafId`의 parent chain
- 최신 active compaction과 `firstKeptEntryId`
- `messages[i]`와 `entryIds[i]`의 정확한 평행 관계
- model/thinking/todo metadata
- fork·navigate target
- live tail append와 older page prepend의 순서

### 클라이언트 merge 조건

- page 요청을 `sessionId + leafId + fileGeneration + requestGeneration`으로 fence한다.
- `{message, entryId}` pair를 원자적으로 prepend한다.
- prepend 전후 scroll distance 또는 visible anchor를 보존한다.
- page 요청 중 branch가 바뀌면 이전 page를 폐기한다.

### 하지 말 것

- 전체 context를 만든 뒤 클라이언트에서 마지막 50개만 자르는 것을 pagination이라고 부르지 않는다.
- raw byte/line pagination을 parent session에 그대로 적용하지 않는다.
- `messages`와 `entryIds`를 독립적으로 slice/merge하지 않는다.

### 검증 조건

- active/superseded compaction
- branch 전환 중 older-page 응답
- tool call/result가 page 경계 근처에 있는 경우
- older page 로드 중 live tail append
- 모바일 prepend 후 scroll anchor
- fork와 branch navigation entry ID 정확성

## 우선순위 5 — 홈 metadata 요청 구조 정리

다음은 먼저 계측한 뒤 진행한다.

### 후보

- `/api/sessions`와 `/api/projects`가 같은 세션 목록 backend 작업을 중복 요구하는지 확인하고 한 요청 또는 명시적인 shared snapshot으로 합친다.
- session list의 unique cwd별 `resolveProject()` Git subprocess 비용을 계측한다.
- 프로젝트 directory observer 또는 더 긴-lived project-resolution cache가 필요한지 판단한다.
- 닫힌/비활성 panel의 polling과 계산을 visibility 기반으로 중지한다.

### 안전 조건

- managed project ordering은 session activity 때문에 바뀌지 않는다.
- hidden project와 explicitly registered empty project가 유지된다.
- worktree가 main project 아래 올바르게 묶인다.
- 새 세션은 cache invalidation 직후 즉시 목록에 나타난다.
- running SSE가 authoritative running badge를 계속 제공한다.

## 선택적 장기 후보 — display-only replica cache

Paseo처럼 마지막 홈 metadata와 짧은 timeline tail을 브라우저에 bounded cache로 저장하면 재접속 체감 속도를 더 줄일 수 있다. 다만 서버 pagination과 generation 계약이 안정된 뒤 검토한다.

원칙:

```text
캐시 = 즉시 표시용
서버 = 권위 상태
```

캐시 복원만으로 runtime mutation을 활성화하지 않는다. canonical coverage를 증명할 수 없는 데이터는 display-only로 취급한다.

## 권장 구현 순서

```text
1. historyReady/runtimeReady 분리
2. immutable raw-entry parse 공유
3. session-bound lazy media
4. branch-aware history pagination
5. 홈 metadata 중복 제거와 선택적 replica cache
```

각 단계는 독립적으로 계측·검증하고 한 번에 묶지 않는다. 특히 pagination, parsed cache, media cache를 동시에 변경하면 branch·compaction·authorization 회귀 원인을 분리하기 어렵다.
