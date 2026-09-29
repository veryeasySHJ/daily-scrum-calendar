# VinylC Calendar (데일리 스크럼 캘린더)

A month calendar for daily work cards. Each card is one note, color-coded by work category and tagged with a status and an output path (internal / external network).

> The plugin interface is in Korean only. A Korean guide follows the English sections below.

## Features

- Month view: cards stack on the day they were created; tap a stack to spread it.
- Create a card by clicking a date: title, work category, summary, status, and output path.
- Work category is pre-selected from the previous card with the same title or from keywords you set. No AI or network service is used.
- Edit a card from the pencil button in the note header, by right-clicking (long-pressing on mobile) a card, or with the command palette.
- Pick the work category and status from a list in the note's Properties panel (can be turned off in settings).
- Phones: date cells show category-color dots, and tapping a date lists that day's cards below the calendar.

## Installation

- **From Obsidian**: Settings → Community plugins → Browse → search for "VinylC Calendar" → Install → Enable.
- **Manually**: download `main.js`, `manifest.json`, and `styles.css` from the latest [release](../../releases), put them in `<your vault>/.obsidian/plugins/daily-scrum-calendar/`, then enable the plugin under Settings → Community plugins.

## Usage

1. Open the calendar with the calendar icon in the left ribbon or the command "데일리 캘린더 열기" (Open daily calendar).
2. Click a date to create a card.
3. Click a card to open its note beside the calendar. Write details under "## 상세 업무내용" (details) and "## 세부일정" (schedule).
4. Cards are saved in the folder set in settings (default `Daily Scrum/`) as `YYYY-MM-DD title.md`. The text under "## 요약" (summary) appears on the card.

## Privacy

The plugin makes no network requests and does not send any data outside your vault. It only reads and writes notes inside the card folder.

---

## 한국어 안내

하루 단위 업무 카드를 월간 달력에 쌓아 보는 옵시디언 플러그인입니다.
카드 1장은 노트 1개이고, 업무 분류 색 · 상태값 · 산출경로(내부망/외부망)로 정리합니다.

## 할 수 있는 것

- **월간 달력**: 날짜마다 그날 만든 카드가 쌓입니다. 여러 장이면 겹쳐 보이고, 누르면 펼쳐집니다.
- **카드 만들기**: 날짜를 누르면 새 카드 창이 열립니다. 타이틀 · 업무 분류 · 요약 · 상태값 · 산출경로를 넣습니다.
  - 이전에 쓴 타이틀을 목록에서 고를 수 있습니다.
  - 업무 분류는 같은 타이틀의 이전 카드, 또는 분류마다 정한 단어로 먼저 골라 둡니다 (인공지능·외부 서비스 없이 동작).
- **카드 색**: 업무 분류마다 색을 정하면 카드 바탕색으로 보입니다.
- **칩**: 카드 위에 상태값(진행중 · 대기중 · 완료 등)과 산출경로(내부망 · 외부망)가 값마다 다른 색으로 보입니다.
- **카드 수정**: 카드 노트 오른쪽 위 연필 버튼, 달력 카드 우클릭(휴대폰은 길게 누르기), 명령 "지금 열린 카드 수정".
- **노트 속성 칸**: 카드 노트의 업무분류 · 상태값을 목록에서 고를 수 있습니다 (설정에서 끌 수 있음).
- **휴대폰**: 화면이 좁으면 날짜 칸에 업무 분류 색 점만 보이고, 날짜를 누르면 아래에 그날 카드 목록이 나옵니다.

## 설치

옵시디언 설정 → 커뮤니티 플러그인 → 둘러보기에서 "VinylC Calendar"를 검색해 설치합니다.

직접 설치할 때는 [배포판](../../releases)에서 `main.js` · `manifest.json` · `styles.css`를 받아
볼트의 `.obsidian/plugins/daily-scrum-calendar/` 폴더에 넣고, 커뮤니티 플러그인에서 켭니다.

## 사용법

1. 왼쪽 달력 아이콘 또는 명령 "데일리 캘린더 열기"로 달력을 엽니다.
2. 날짜를 눌러 카드를 만듭니다.
3. 카드를 누르면 옆에 카드 노트가 열립니다. 본문에 상세 업무내용과 세부일정을 적습니다.

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

## 요약

지난주 진행 상황과 다음 할 일 정리

## 상세 업무내용

## 세부일정
```

- `내부망`: 체크하면 내부망, 해제하면 외부망입니다.
- `## 요약` 아래 내용이 달력 카드에 두 줄까지 보입니다.
- `created`는 같은 날 카드의 순서(맨 위 = 최근)에 쓰이며 노트 속성 칸에서는 숨겨집니다.
- 예전 형식(`date` · `title` · `work-category` · `states` · `network` · `summary`)도 읽습니다.
  명령 "예전 형식 카드 노트를 새 형식으로 바꾸기"로 한 번에 바꿀 수 있습니다.

## 설정

- **저장 폴더**: 카드 노트를 저장할 폴더
- **노트 속성 칸에서 선택하기**: 카드 노트의 업무분류 · 상태값 칸을 목록 선택으로 바꿉니다
- **자동 분류**: 타이틀로 업무 분류를 먼저 골라 둡니다
- **업무 분류**: 분류마다 색 · 이름 · 알아볼 단어

## 알아 둘 점

- "노트 속성 칸에서 선택하기"는 옵시디언 속성 칸 화면 위에 선택 버튼을 덧씌우는 방식입니다.
  옵시디언 업데이트로 화면 구조가 바뀌면 버튼이 보이지 않을 수 있으며, 그때도 노트 값은 그대로이고 기본 글자 입력칸으로 보입니다.
- 이 플러그인은 인터넷에 연결하지 않고, 볼트 밖으로 데이터를 보내지 않습니다.
- 화면 글자는 한국어만 지원합니다.

## 사용 허락

MIT — [LICENSE](LICENSE) 참고.
