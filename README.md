# VinylC Calendar (데일리 스크럼 캘린더)

A month calendar for daily work cards. Each card is one note, color-coded by work category and tagged with a status and an output path (internal / external network).

> The plugin interface is in Korean only. A Korean guide follows the English sections below.

## Features

- Month view: cards stack on the day they were created; tap a stack to spread it.
- Create a card by clicking a date. New and edit windows share one layout: title, date, work category, status, output path, and a single Markdown content field.
- Date ranges: pick a start and an end day in the inline date picker. On narrow screens a range is drawn as one bar across the date cells, and list cards show the range under the title.
- Work category is pre-selected from the previous card with the same title or from keywords you set. No AI or network service is used.
- Edit a card from the pencil button in the note header, by right-clicking a card, or with the command palette.
- Pick the work category and status from a list in the note's Properties panel (can be turned off in settings).
- Phones: date cells show small event bars (status dot + title, category color), and tapping a date lists that day's cards below the calendar.
- Phones: tap a card to edit it in a bottom sheet; long-press a card to delete it. While editing the content, format buttons add a heading, list item, to-do, or the current time.
- The card shows the first heading of the content, or the first line if there is no heading.

## Installation

- **From Obsidian**: Settings → Community plugins → Browse → search for "VinylC Calendar" → Install → Enable.
- **Manually**: download `main.js`, `manifest.json`, and `styles.css` from the latest [release](../../releases), put them in `<your vault>/.obsidian/plugins/daily-scrum-calendar/`, then enable the plugin under Settings → Community plugins.

## Usage

1. Open the calendar with the calendar icon in the left ribbon or the command "데일리 캘린더 열기" (Open daily calendar).
2. Click a date to create a card.
3. Click a card to open its note beside the calendar (on phones, the edit sheet opens). Right-click a card to edit or delete it.
4. Cards are saved in the folder set in settings (default `Daily Scrum/`) as `YYYY-MM-DD title.md`. The whole note body is the content; a date range is stored as `종료일` (end date).
5. Older notes with "## 요약" / "## 상세 업무내용" / "## 세부일정" sections are still read, and are merged into one content field when saved.

## Privacy

The plugin makes no network requests and does not send any data outside your vault. It only reads and writes notes inside the card folder.

## Authors

Hyunjoo Shin, Suyeon Hwang

---

## 한국어 안내

하루 단위 업무 카드를 월간 달력에 쌓아 보는 옵시디언 플러그인입니다.
카드 1장은 노트 1개이고, 업무 분류 색 · 상태값 · 산출경로(내부망/외부망)로 정리합니다.

## 할 수 있는 것

- **월간 달력**: 날짜마다 그날 만든 카드가 쌓입니다. 여러 장이면 겹쳐 보이고, 누르면 펼쳐집니다.
- **일정 만들기 · 수정**: 날짜를 누르면 새 일정 창이 열립니다. 새 일정과 일정 수정은 같은 화면입니다 (타이틀 · 날짜 · 업무 분류 · 상태값 · 산출경로 · 내용).
  - 내용은 한 칸이고 마크다운으로 자유롭게 씁니다. 평소에는 서식이 적용된 모양으로 보이고, 누르면 입력칸으로 바뀝니다.
  - 상태값 줄 끝 "+ 추가"로 그 자리에서 새 값을 넣습니다.
  - 이전에 쓴 타이틀을 목록에서 고를 수 있습니다.
  - 업무 분류는 같은 타이틀의 이전 카드, 또는 분류마다 정한 단어로 먼저 골라 둡니다 (인공지능·외부 서비스 없이 동작).
- **기간**: 날짜 줄을 누르면 달력이 펼쳐집니다. 시작일과 끝나는 날을 차례로 누르면 기간이 됩니다 (같은 날을 두 번 누르면 하루 일정).
  - 좁은 화면 달력에서는 날짜 칸을 가로지르는 막대로, 목록 카드에서는 타이틀 아래 "9월 23일 ~ 25일"로 보입니다.
- **카드 색**: 업무 분류마다 색을 정하면 카드 바탕색으로 보입니다.
- **플래그**: 카드 위에 상태값(색 점: 진행중 초록 · 대기중 주황 · 완료 회색)과 산출경로(내부망 · 외부망)가 보입니다.
- **일정 수정**: 일정 노트 오른쪽 위 연필 버튼, 달력 카드 우클릭, 명령 "지금 열린 일정 수정".
- **노트 속성 칸**: 카드 노트의 업무분류 · 상태값을 목록에서 고를 수 있습니다 (설정에서 끌 수 있음).
- **휴대폰**: 화면이 좁으면 날짜 칸에 일정 막대(상태값 색 점 + 타이틀, 업무 분류 색)가 보이고, 날짜를 누르면 아래에 그날 일정 목록이 나옵니다.
  - 카드를 누르면 아래에서 올라오는 시트에서 바로 수정합니다. 내용을 쓰는 동안 서식 버튼(제목 · 목록 · 할 일 · 시간)을 쓸 수 있습니다.
  - 카드를 꾹 누르면 삭제할 수 있습니다. PC에서는 달력 카드를 우클릭해 삭제합니다.

## 설치

옵시디언 설정 → 커뮤니티 플러그인 → 둘러보기에서 "VinylC Calendar"를 검색해 설치합니다.

직접 설치할 때는 [배포판](../../releases)에서 `main.js` · `manifest.json` · `styles.css`를 받아
볼트의 `.obsidian/plugins/daily-scrum-calendar/` 폴더에 넣고, 커뮤니티 플러그인에서 켭니다.

## 사용법

1. 왼쪽 달력 아이콘 또는 명령 "데일리 캘린더 열기"로 달력을 엽니다.
2. 날짜를 눌러 일정을 만듭니다.
3. 카드를 누르면 옆에 일정 노트가 열립니다 (휴대폰은 수정 시트). 노트 본문 전체가 일정 내용입니다.

## 카드 노트 형식

카드는 설정의 저장 폴더(기본 `Daily Scrum/`)에 `YYYY-MM-DD 타이틀.md` 이름으로 저장됩니다.

```markdown
---
날짜: 2026-09-23
업무분류: "업무1"
상태값: "진행중"
내부망: true
타이틀: "주간 회의록 정리"
created: 2026-09-23T10:30
---

### 지난주 진행 상황 정리
- 다음 할 일 정리
- [ ] 회의록 공유
10:00 팀 회의
```

- `내부망`: 체크하면 내부망, 해제하면 외부망입니다.
- 본문 전체가 내용입니다. 달력 카드에는 첫 제목 줄(없으면 첫 줄)이 두 줄까지 보입니다. 빈 줄과 시간으로 시작하는 줄은 건너뜁니다.
- 기간 일정은 `날짜` 아래에 `종료일: YYYY-MM-DD`가 붙습니다. 하루 일정은 없습니다.
- 예전 형식(`## 요약` · `## 상세 업무내용` · `## 세부일정`)도 그대로 읽고, 저장할 때 칸 제목을 빼고 한 칸으로 합칩니다.
- `created`는 같은 날 카드의 순서(맨 위 = 최근)에 쓰이며 노트 속성 칸에서는 숨겨집니다.
- 예전 형식(`date` · `title` · `work-category` · `states` · `network` · `summary`)도 읽습니다.
  명령 "예전 형식 일정 노트를 새 형식으로 바꾸기"로 한 번에 바꿀 수 있습니다.

## 설정

- **저장 폴더**: 카드 노트를 저장할 폴더
- **노트 속성 칸에서 선택하기**: 카드 노트의 업무분류 · 상태값 칸을 목록 선택으로 바꿉니다
- **자동 분류**: 타이틀로 업무 분류를 먼저 골라 둡니다
- **업무 분류**: 분류마다 색 · 이름 · 알아볼 단어
- **상태값**: 일정 창에서 "+ 추가"로 넣은 값 목록. 여기서 지웁니다

## 알아 둘 점

- "노트 속성 칸에서 선택하기"는 옵시디언 속성 칸 화면 위에 선택 버튼을 덧씌우는 방식입니다.
  옵시디언 업데이트로 화면 구조가 바뀌면 버튼이 보이지 않을 수 있으며, 그때도 노트 값은 그대로이고 기본 글자 입력칸으로 보입니다.
- 이 플러그인은 인터넷에 연결하지 않고, 볼트 밖으로 데이터를 보내지 않습니다.
- 화면 글자는 한국어만 지원합니다.

## 만든 사람

Hyunjoo Shin, Suyeon Hwang

## 사용 허락

MIT — [LICENSE](LICENSE) 참고.
