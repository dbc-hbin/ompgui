# ompweb

[English](./README.md) | [한국어](./README.ko.md) | [日本語](./README.ja.md) | [简体中文](./README.zh-CN.md)

[oh-my-pi (omp) 코딩 에이전트](https://github.com/can1357/oh-my-pi)를 위한 로컬 웹 UI입니다. ompweb은 로컬 omp 세션 파일을 읽어 브라우저에서 세션 탐색, 실시간 채팅, 모델 설정, 스킬 관리, 프로젝트 파일 미리보기를 제공하는 워크스페이스를 엽니다.

![ompweb — 라이트 테마](docs/screenshot-light.png)

<details>
<summary>다크 테마</summary>

![ompweb — 다크 테마](docs/screenshot-dark.png)

</details>

## 요구 사항

- [omp](https://github.com/can1357/oh-my-pi)가 설치되어 `PATH`에 있어야 합니다(또는 `OMP_WEB_OMP_BIN`으로 바이너리를 지정).
- Node.js 22.19.0 이상(`node --version`)

## 빠른 시작

**설치 없이 실행:**

```bash
npx ompweb@latest
```

**또는 전역 설치:**

```bash
npm install -g ompweb
ompweb
```

그다음 [http://127.0.0.1:30177](http://127.0.0.1:30177)을 여세요. 서버가 준비되면 CLI가 브라우저를 자동으로 열려고 시도합니다. ompweb은 기본적으로 `127.0.0.1`에서 수신합니다.

**옵션:**

```bash
ompweb --port 8080              # 포트 지정
ompweb --hostname 0.0.0.0       # 신뢰할 수 있는 네트워크에 노출
ompweb -p 8080 -H 0.0.0.0       # 옵션 조합
ompweb --no-open                # 브라우저 자동 열기 안 함
ompweb --password "a-long-random-password" # POSIX 인라인 환경 변수 없이 비밀번호만으로 로그인

PORT=8080 ompweb                # 환경 변수도 지원
OMP_WEB_HOSTNAME=0.0.0.0 ompweb # 네트워크에 명시적으로 노출
OMP_WEB_PASSWORD='a-long-random-password' ompweb # 환경 변수 방식(POSIX: 인라인 또는 export)
OMP_WEB_NO_OPEN=1 ompweb        # 백그라운드 서비스로 실행할 때 유용

# Windows (PowerShell / CMD)
# $env:OMP_WEB_PASSWORD="a-long-random-password"; ompweb
# 또는
# ompweb --password "a-long-random-password"
```

`OMP_WEB_PASSWORD`를 설정하거나 `--password`를 전달하면 테마가 적용된 비밀번호 전용 로그인 화면으로 인터페이스와 모든 API 엔드포인트를 보호합니다. 로그인에 성공하면 30일 동안 유효한 HTTP 전용 서명 세션 쿠키가 생성됩니다. 설정된 비밀번호를 변경하면 기존 세션이 무효화됩니다. 변수를 설정하지 않으면 인증이 비활성화됩니다. 원격 사용 시 비밀번호와 세션 쿠키가 가로채이지 않도록 신뢰할 수 있는 리버스 프록시나 VPN을 통해 HTTPS를 사용해야 합니다. Windows 환경 변수 문법은 `$env:OMP_WEB_PASSWORD="..."`이며, `ompweb --password "..."`는 별도 문법 없이 모든 셸에서 작동합니다.

## 원격 및 모바일 접속 (Tailscale 권장)

외부나 모바일 기기(iPhone, iPad, Android)에서 로컬 PC의 `ompweb`에 접속할 때는 **[Tailscale](https://tailscale.com/) 가상 사설망(VPN)을 사용하는 것을 강력히 권장**합니다. 포트 포워딩이나 공인 IP 노출 없이 종단간 암호화(P2P)를 통해 가장 안전하게 원격 접속할 수 있습니다.

### 1. 비밀번호 설정 (보안 필수)

외부 네트워크에 바인딩할 때는 인증 보호를 위해 반드시 비밀번호를 설정해야 합니다:

```bash
# CLI 옵션으로 비밀번호 설정 및 전체 네트워크 바인딩
ompweb -H 0.0.0.0 --password "your-strong-password"

# 또는 환경 변수로 설정
OMP_WEB_HOSTNAME=0.0.0.0 OMP_WEB_PASSWORD="your-strong-password" ompweb
```

### 2. Tailscale 연결 단계

1. **Tailscale 설치**: 호스트 PC와 모바일 기기에 [Tailscale](https://tailscale.com/download)을 설치하고 동일한 계정으로 로그인합니다.
2. **호스트 PC에서 ompweb 실행**:
   ```bash
   ompweb --hostname 0.0.0.0 --password "your-strong-password"
   ```
3. **모바일 브라우저에서 접속**:
   - 호스트 PC의 Tailscale IP(예: `100.x.y.z`) 또는 MagicDNS 머신 이름으로 접속합니다:
     ```text
     http://100.x.y.z:30177
     # 또는 MagicDNS 활성화 시
     http://my-macbook:30177
     ```
4. **로그인**: 설정한 비밀번호를 입력하면 모바일에서도 안전하게 실시간 코딩 에이전트와 대화하고 작업할 수 있습니다.

### 보안 및 문제 해결

- 서버는 기본적으로 `127.0.0.1`에 바인딩됩니다. 루프백이 아닌 호스트 이름은 명시적으로 선택해야 하며 신뢰할 수 있는 네트워크 경계 뒤에서만 사용하세요. ompweb을 공개적으로 노출하는 것은 안전하지 않습니다.
- 파일 API는 선택한 워크스페이스, 유효한 Git worktree, 세션에서 참조된 디렉터리, 명시적으로 선택한 루트만 허용합니다. 경로를 정규화하여 경로 탈출과 심볼릭 링크 탈출을 차단합니다.
- `omp`는 먼저 `OMP_WEB_OMP_BIN`, 다음으로 `PATH`에서 확인합니다. 실시간 채팅을 시작할 수 없으면 같은 터미널에서 `omp --version`을 실행하거나 실행 파일의 절대 경로를 `OMP_WEB_OMP_BIN`에 설정하세요.
- 세션 기록은 기본 OMP JSONL 형식으로 유지됩니다. 실시간 세션 쓰기는 OMP가 담당하며, ompweb은 직접 파일을 읽고 실시간 OMP 쓰기와 충돌하지 않을 때만 명시적인 제목·보관·삭제 작업을 수행합니다.
- 세션 보관은 OMP의 기본 `archive/sessions/<cwd>/<file>.jsonl.gz` 레이아웃을 사용하며, 트랜스크립트와 함께 관련 아티팩트를 이동합니다. 원본 JSONL 바이트는 gzip 안에 보존됩니다.

## 기능

- **이전 작업 이어가기**: 터미널 기록이나 세션 경로를 뒤지지 않고 프로젝트별로 이전 omp 대화를 탐색합니다.
- **안전하게 다른 방향 시도하기**: 이전 메시지에서 계속하거나 세션을 별도 경로로 포크합니다.
- **깔끔한 사이드바 유지**: 기본 트랜스크립트를 삭제하지 않고 비활성 세션을 보관하거나, 더 이상 필요하지 않을 때 명시적으로 삭제합니다.
- **브랜치 간 작업**: 사이드바에서 Git worktree를 전환하면 새 세션과 Explorer가 선택한 체크아웃을 따릅니다.
- **프로젝트 옆에서 채팅**: 왼쪽에서 파일을 탐색하고 오른쪽에서 소스, 문서, 이미지, 오디오, PDF를 미리 보면서 에이전트의 작업을 확인합니다.
- **정확한 Markdown 미리보기**: YAML frontmatter를 요약 카드(제목 및 키/값 행)로 렌더링하고, 수식 펜스를 목록 안에서도 정렬하며, `5~7U` 같은 CJK 범위를 올바르게 표시합니다(GFM에서는 취소선에 이제 `~~`가 필요합니다).
- **Windows에서 자연스럽게 프로젝트 선택**: 파일 시스템 루트의 드라이브 선택기와 대소문자 무시·심볼릭 링크 인식 프로젝트 식별자로 드라이브와 worktree 사이에서도 사이드바를 안정적으로 유지합니다.
- **세션 상태 명확히 확인**: 상단 바에서 컨텍스트 사용량, 비용, 압축 상태, 시스템 프롬프트 세부 정보를 확인합니다.
- **터미널 설정 줄이기**: 웹 UI에서 모델, 로그인/API 키, 모델 테스트, OMP 기본 제어(어드바이저, 승인, Bash 정책, 추론, 압축, 메모리, 자동 학습, 재시도/폴백), 스킬, 플러그인, 프로젝트 MCP 서버를 관리합니다.
- **Settings에서 MCP 관리**: 전용 MCP 탭에서 설치된 프로젝트 서버의 상태(활성화/비활성화/잘못됨)를 확인하고 추가·편집·이름 변경·검증·삭제를 수행하며 설정 오류를 코너 토스트로 표시합니다.
- **OMP 최신 상태 유지**: Settings에서 설치된 런타임 버전을 확인하고 업데이트하거나 필요할 때 활성 세션을 재시작합니다.
- **완료 알림 받기**: 에이전트가 작업을 마치면 브라우저 알림을 받도록 선택하고 설치된 스킬의 업데이트를 확인합니다.
- **⌘K로 어디서든 이동**: 명령 팔레트(⌘K / Ctrl+K)로 세션 전환, 새 세션 시작, 테마 변경을 수행합니다.
- **따뜻한 종이 느낌의 디자인**: 세리프 디스플레이 글꼴과 WCAG AA 검증 대비를 사용하는 라이트/다크 테마를 토큰 기반 UI 키트(Base UI primitives, cmdk, lucide 아이콘)로 구현했습니다.

## 설정

| 변수 | 의미 |
| --- | --- |
| `PORT` | 서버 포트(기본 `30177`; `-p/--port`가 우선) |
| `OMP_WEB_HOSTNAME` | 바인딩할 호스트 이름(기본 `127.0.0.1`; `-H/--hostname`이 우선) |
| `OMP_WEB_PASSWORD` / `--password` | 로그인 화면의 비밀번호. `--password`는 PowerShell/CMD에서도 `$env:` 문법 없이 사용 가능 |
| `OMP_WEB_NO_OPEN` | `1` 또는 `true`로 설정하면 브라우저 자동 열기 건너뜀 |
| `OMP_WEB_OMP_BIN` | `PATH`에 `omp`가 없을 때 사용할 절대 경로 |
| `PI_CODING_AGENT_DIR` | 다른 omp 에이전트 디렉터리 지정(기본 `~/.omp/agent`) |
| `HTTP_PROXY` / `HTTPS_PROXY` / `NO_PROXY` | 서버 측 요청에 사용하는 표준 프록시 변수 |

## 아키텍처

ompweb은 Node가 호스팅하는 Next.js 앱으로, 설치된 `omp` 바이너리를 구동합니다. 에이전트를 내장하지 않습니다.

- **실시간 세션**: `omp --mode rpc-ui`(stdio 기반 NDJSON)를 실행하며 활성 세션마다 자식 프로세스를 하나씩 사용합니다. 설치된 OMP가 RPC v2를 알리면 v2를 협상하고, 큰 프레임은 제한된 청크 재조립을 사용하며, 구버전은 v1로 폴백합니다. 실행 전 호스트 환경(`PORT`, `NEXT_*`, `NODE_ENV`)을 제거하고 POSIX(프로세스 그룹)와 Windows(`taskkill /t`) 모두 정상 종료를 지원합니다.
- **세션 탐색**: omp 세션 파일(`~/.omp/agent/sessions/<encoded-cwd>/<timestamp>_<uuid>.jsonl`)을 직접 읽습니다. 제목·보관·삭제는 실시간 OMP 쓰기를 보호하는 제한적인 기본 파일 유지보수 작업입니다. 프로젝트는 안정적인 `projectKey`(Windows 대소문자 무시, 심볼릭 링크 해석)로 묶어 사이드바가 드라이브나 worktree 사이에서 이동하지 않게 합니다.
- **모델 및 인증**: 엄격한 페이로드 검증(알 수 없는 형태 차단, 안전한 폴백)을 적용한 RPC 명령으로 omp 자식 프로세스와 통신합니다. Models 패널은 omp 에이전트 디렉터리의 `models.yml`을 편집하며 빈 자리 행을 제거하고 모호한 `enabledModels` 항목을 거부합니다.
- **기본 설정**: General/MCP 설정 패널은 `~/.omp/agent/config.yml`(또는 `config.yaml` 폴백)의 허용 목록에 포함된 항목을 읽고 씁니다. 관련 없는 키와 주석은 보존하며 변경 사항은 새 세션과 재시작한 세션에 적용됩니다.
- **스킬 및 플러그인**: omp 스킬 디렉터리(`~/.omp/agent/skills`, 프로젝트 `.omp/skills`, 호환 디렉터리)를 검색하고 플러그인 관리는 `omp plugin`을 호출합니다.
- **MCP 서버**: 프로젝트 서버는 Git 최상위의 OMP 기본 위치(`.omp/mcp.json`, 이후 호환 파일)를 통해 관리하며 stdio/http/sse 스키마를 검증하고 원자적으로 기록합니다.
- **파일 접근**: 파일 탐색과 미리보기는 선택한 프로젝트 디렉터리 및 세션에 나타난 작업 디렉터리로 제한됩니다. `isWindowsAbsolutePath`/`samePath` 단일 헬퍼로 경로를 정규화하고 `realpath` 해석 뒤 심볼릭 링크 탈출을 거부합니다. Windows에서는 루트에서 드라이브 목록을 제공하는 디렉터리 선택기를 사용합니다.
- **포크와 세션 내 브랜치**: 포크는 새 `.jsonl` 파일을 만듭니다. “여기서 편집”은 같은 세션 파일 안에 다른 브랜치를 만듭니다.

## 개발

```bash
npm install
npm run dev
```

로컬 개발 서버는 [http://127.0.0.1:30178](http://127.0.0.1:30178)에서 실행됩니다.

일반적인 검사:

```bash
npm run typecheck      # 타입 검사
npm run lint           # ESLint(경고 0개 적용)
npm test               # 테스트 스위트 실행
npm run build          # 프로덕션 빌드
```

로컬 개발 중에는 `next build`/`npm run build`를 실행하지 마세요. `.next/`에 기록하여 개발 서버에 간섭할 수 있으므로 빌드는 릴리스 작업으로 남겨 두세요.

## 국제화

ompweb은 영어, 중국어 간체(简体中文), 일본어(日本語), 한국어(한국어)를 지원하며 모든 언어에서 전체 UI 문자열을 번역합니다. 언어는 `navigator.language`에서 자동 감지하고 상단 바의 언어 메뉴에서 실행 중 전환할 수 있습니다. 선택한 언어는 세션 간 유지됩니다.

- 사전: `lib/i18n/locales/{en,zh-CN,ja,ko}.json`
- 프레임워크: `lib/i18n/index.tsx` — `{var}` 보간과 복수형(`.one`/`.other`)을 지원하는 `useSyncExternalStore` 기반 경량 스토어
- API 오류 메시지: 안정적인 오류 코드(`errors.<code>`)를 클라이언트에서 조회해 번역

## 품질

- **접근성**: WCAG AA 준수 — Lighthouse 접근성 점수 100/100, 전면 키보드 탐색, focus-visible 링, ARIA 역할
- **성능**: 메모이제이션된 목록 컴포넌트, RAF로 제한한 스크롤/마우스 핸들러, 디바운스 검색, 스트리밍 JSONL 리더, ETag 캐시 세션 목록
- **복원력**: omp 자식 프로세스의 정상 종료(프로세스 그룹 종료), 오류 경계, 원자적 세션 파일 재작성
- **테스트**: 세션 파싱, 터미널 입력, Markdown 렌더링, 메시지 표시, 기본 설정, MCP 구성을 다루는 집중 테스트 스위트

## 크레딧

ompweb은 [earendil-works/pi](https://github.com/earendil-works/pi) pi 코딩 에이전트의 웹 UI인 [agegr/pi-web](https://github.com/agegr/pi-web)(MIT)을 포크하여 [can1357/oh-my-pi](https://github.com/can1357/oh-my-pi)에 맞게 수정한 프로젝트입니다.

## 라이선스

MIT
