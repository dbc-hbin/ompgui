# ompweb의 Worktree

ompweb은 하나의 프로젝트에 속한 Git의 메인 체크아웃과 연결된 worktree를 사이드바에서 함께 보여줍니다. 프로젝트의 세션 목록은 하나로 유지하면서 브랜치별로 별도의 체크아웃을 사용할 수 있습니다.

## Worktree 컨트롤이 표시되는 경우

선택한 디렉터리가 Git 저장소 루트이면 프로젝트 선택기 아래에 worktree 전환기가 표시됩니다.

다음 경우에는 표시되지 않습니다.

- 선택한 디렉터리가 Git 저장소가 아닙니다.
- 선택한 디렉터리가 저장소 안에 있지만 저장소 루트가 아닙니다.
- Git에서 저장소의 worktree 목록을 읽을 수 없습니다.

저장소 하위 디렉터리에 있다면 프로젝트 선택기에서 저장소 루트를 열어 worktree를 관리하세요.

## Worktree 전환

worktree 전환기에서 해당 프로젝트의 새 작업에 사용할 체크아웃을 선택하세요.

전환하면 다음 항목이 영향을 받습니다.

- 사이드바에서 새로 시작하는 세션
- 파일 Explorer
- Explorer에서 입력창에 삽입하는 파일 멘션

기존 세션은 같은 프로젝트 아래에 계속 묶여 있습니다. 기존 세션을 열면 실제 작업 디렉터리가 해당 세션의 체크아웃으로 돌아갑니다.

## Worktree 만들기

worktree 메뉴에서 `New worktree...`를 선택하고 브랜치 이름을 입력하세요.

ompweb은 다음 위치에 체크아웃을 만듭니다.

```text
<repo>-worktrees/<branch>
```

예를 들어 메인 체크아웃이 다음과 같고,

```text
/Users/alex/Documents/Workspace/my-project
```

`codex/worktree-help` 브랜치를 만들면 다음 위치에 worktree가 생성됩니다.

```text
/Users/alex/Documents/Workspace/my-project-worktrees/codex-worktree-help
```

브랜치가 이미 있으면 ompweb은 해당 브랜치에 worktree를 추가합니다. 브랜치가 없으면 현재 `HEAD`에서 브랜치를 만든 뒤 추가합니다.

## Worktree 삭제

메인이 아닌 worktree 옆의 삭제 버튼을 사용하면 해당 체크아웃이 삭제됩니다.

worktree를 삭제해도 다음은 삭제되지 않습니다.

- Git 브랜치
- ompweb 세션 기록
- 메인 체크아웃

worktree에 커밋되지 않은 파일이나 추적되지 않는 파일이 있으면 Git은 삭제를 거부합니다. 그러면 ompweb이 강제 삭제를 제공합니다. 강제 삭제는 해당 체크아웃의 커밋되지 않은 파일을 버리므로, 변경 사항이 더 이상 필요하지 않을 때만 사용하세요.

## 세션과 Worktree의 관계

ompweb은 프로젝트 루트별로 세션을 묶으므로 메인 체크아웃과 연결된 worktree의 세션이 함께 표시됩니다.

각 세션은 생성 당시의 작업 디렉터리를 기억합니다. 따라서:

- worktree에서 시작한 세션은 계속 해당 worktree 경로를 사용합니다.
- 메인 체크아웃에서 시작한 세션은 계속 메인 체크아웃을 사용합니다.
- worktree를 삭제해도 해당 worktree의 기존 세션은 프로젝트 아래에 계속 표시되므로 기록을 확인할 수 있습니다.

## 문제 해결

**Worktree 전환기가 보이지 않습니다.**  
현재 선택한 디렉터리가 Git 저장소 루트인지 확인하세요. Git이 아닌 디렉터리와 저장소 하위 디렉터리에는 전환기 대신 짧은 안내가 표시됩니다.

**브랜치를 worktree로 추가할 수 없습니다.**  
Git에서는 한 번에 하나의 worktree에서만 브랜치를 체크아웃할 수 있습니다. 해당 브랜치의 기존 worktree로 전환하거나 먼저 기존 worktree를 삭제하세요.

**삭제한 worktree가 Git에 계속 표시됩니다.**  
체크아웃이 사라진 뒤에도 Git에 정리 대상(prunable) worktree 기록이 남을 수 있습니다. ompweb은 이를 전환기에서 필터링합니다.

**Explorer와 현재 채팅의 브랜치가 서로 다르게 보입니다.**  
Explorer는 선택한 worktree를 따르고, 채팅은 열려 있는 세션을 따릅니다. 세션을 다시 클릭하면 사이드바가 해당 세션의 체크아웃으로 돌아갑니다.
