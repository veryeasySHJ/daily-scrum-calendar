/* 데일리 스크럼 캘린더 — 옵시디언 플러그인 (빌드 없음, CommonJS)
 * 기준 문서: 기능정의 · 디자인 규칙표 (제작자 내부 문서)
 */
const { Plugin, Platform, ItemView, MarkdownView, Modal, Menu, PluginSettingTab, Setting, Notice, TFile, TFolder, Vault, normalizePath, setIcon, debounce, moment, parseYaml, stringifyYaml } = require('obsidian');

const VIEW_TYPE = 'daily-scrum-calendar';
const WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토'];
const PRESETS = [
  { hue: 338, sat: 1 }, { hue: 210, sat: 1 }, { hue: 85, sat: 1 }, { hue: 43, sat: 1 },
  { hue: 24, sat: 1 }, { hue: 255, sat: 1 }, { hue: 167, sat: 1 }, { hue: 48, sat: 0.25 },
];
// 상태값 점 색 (2026-09-30 플래그 새 규칙): 진행중 초록 · 대기중 주황 · 완료 회색. 사용자가 추가한 값은 안 쓴 색을 이 순서로
const STATE_TONES = { '진행중': 'go', '대기중': 'wait', '완료': 'done' };
const AUTO_TONES = ['red', 'blue', 'pink', 'yellow', 'cyan'];
// 노트 속성 이름·순서 (2026-09-29 확정: 한국어 이름). 옛 영어 키는 읽기만 한다
const K = { date: '날짜', category: '업무분류', state: '상태값', internal: '내부망', title: '타이틀', created: 'created' };
const CARD_KEYS = [K.date, K.category, K.state, K.internal, K.title, K.created];
const LEGACY_KEYS = ['date', 'work-category', 'state', 'title', 'states', 'network', 'summary'];
const pick = (fm, ...keys) => { for (const k of keys) if (fm[k] != null && fm[k] !== '') return fm[k]; return null; };
const SUMMARY_HEADING = '요약';
const DETAIL_HEADING = '상세 업무내용';
const SCHEDULE_HEADING = '세부일정';
const DEFAULTS = {
  folder: 'Daily Scrum',
  autoClassify: true,
  propSelect: true,     // 일정 노트 속성 칸의 업무분류 · 상태값을 선택 버튼으로
  states: ['진행중', '대기중', '완료'],
  stateTones: {},
  categories: [
    { name: '업무1', hue: 210, sat: 1, words: [] },
    { name: '업무2', hue: 338, sat: 1, words: [] },
    { name: '업무3', hue: 85, sat: 1, words: [] },
  ],
};

/* ---------- helpers ---------- */
const netLabel = (internal) => (internal ? '내부망' : '외부망');
const byNewest = (a, b) => (b.created || '').localeCompare(a.created || '') || b.ctime - a.ctime;
const byOldest = (a, b) => (a.created || '').localeCompare(b.created || '') || a.ctime - b.ctime;
const catStyle = (el, cat) => { if (cat) el.setCssProps({ '--dsc-h': String(cat.hue), '--dsc-s': String(cat.sat ?? 1) }); };
const yamlStr = (s) => JSON.stringify(String(s));
const safeName = (title) => title.replace(/[\\/:*?"<>|#^[\]]/g, ' ').replace(/\s+/g, ' ').trim() || '일정';
const escRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const hashOf = (s) => Array.from(String(s)).reduce((h, ch) => (h * 31 + ch.charCodeAt(0)) >>> 0, 7);
const dateLabel = (iso) => { const d = moment(iso); return `${d.format('YYYY년 M월 D일')} (${WEEKDAYS[d.day()]})`; };
const keyboardHeight = () => parseFloat(getComputedStyle(document.body).getPropertyValue('--keyboard-height')) || 0;
function toDateStr(v) {
  if (!v) return null;
  if (v instanceof Date) return moment(v).format('YYYY-MM-DD');
  const s = String(v).slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null;
}
function farthestHue(cats) {
  if (!cats.length) return 210;
  let best = 0, bestD = -1;
  for (let h = 0; h < 360; h += 5) {
    const d = Math.min(...cats.map((c) => { const x = Math.abs(c.hue - h) % 360; return Math.min(x, 360 - x); }));
    if (d > bestD) { bestD = d; best = h; }
  }
  return best;
}
function splitNote(text) {
  const m = text.match(/^---\r?\n([\s\S]*?)\r?\n---[ \t]*(\r?\n|$)/);
  if (!m) return { fm: {}, body: text };
  let fm = parseYaml(m[1]) || {};
  if (typeof fm !== 'object' || Array.isArray(fm)) fm = {};
  return { fm, body: text.slice(m[0].length) };
}
const headRe = (h) => new RegExp(`^##\\s+${escRe(h)}\\s*$`);
const ANY_HEAD = /^#{1,6}\s/;
const TOP_HEAD = /^#{1,2}\s/; // 상세 시트: "###" 이하 소제목은 칸 안의 글로 본다
// 본문 "## 요약" 아래 내용 (다음 제목 전까지). 제목이 없으면 null → 옛 summary 속성을 읽는다
function extractSummary(text) {
  const { body } = splitNote(text || '');
  const lines = body.split(/\r?\n/);
  const i = lines.findIndex((l) => headRe(SUMMARY_HEADING).test(l));
  if (i < 0) return null;
  const out = [];
  for (let j = i + 1; j < lines.length && !ANY_HEAD.test(lines[j]); j++) {
    const l = lines[j].replace(/^\s*[-*+]\s+/, '').trim();
    if (l) out.push(l);
  }
  return out.join(' ');
}
// "## 제목" 아래 글 그대로 (앞뒤 빈 줄만 뺌). 제목이 없으면 null
function getSection(body, heading) {
  const lines = body.split(/\r?\n/);
  const i = lines.findIndex((l) => headRe(heading).test(l));
  if (i < 0) return null;
  let j = i + 1;
  while (j < lines.length && !TOP_HEAD.test(lines[j])) j++;
  return lines.slice(i + 1, j).join('\n').replace(/^(\s*\n)+/, '').replace(/\s+$/, '');
}
// "## 제목" 아래 글을 바꿔 쓴다. 제목이 없으면 맨 앞(prepend) 또는 맨 뒤에 새로 만든다
function setSection(body, heading, text, { stop = ANY_HEAD, prepend = false } = {}) {
  const lines = body.split(/\r?\n/);
  // 빈 칸은 제목 + 빈 줄 하나 (다시 저장해도 모양이 같게)
  const block = text ? [`## ${heading}`, '', ...text.split(/\r?\n/), ''] : [`## ${heading}`, ''];
  const i = lines.findIndex((l) => headRe(heading).test(l));
  if (i >= 0) {
    let j = i + 1;
    while (j < lines.length && !stop.test(lines[j])) j++;
    lines.splice(i, j - i, ...block);
    return lines.join('\n');
  }
  if (prepend) {
    while (lines.length && lines[0].trim() === '') lines.shift();
    return ['', ...block, ...lines].join('\n');
  }
  while (lines.length && lines[lines.length - 1].trim() === '') lines.pop();
  return [...lines, ...(lines.length ? [''] : []), ...block].join('\n');
}
const setSummarySection = (body, summary) => setSection(body, SUMMARY_HEADING, summary, { prepend: true });

// 스크롤 영역 위·아래 가장자리를 옅게 (스크롤할 글이 더 있는 쪽만)
// 가리기 기능(mask) 대신 시트 바탕색 → 투명 그라데이션 띠 두 개를 영역 위·아래에 겹친다 (옵시디언 예전 버전 호환)
function attachFade(el) {
  const host = el.parentElement;
  host.addClass('dsc-fade-host');
  const top = createDiv({ cls: 'dsc-fade-edge is-top' }), bot = createDiv({ cls: 'dsc-fade-edge is-bottom' });
  el.after(top, bot);
  const update = () => {
    const x = `${el.offsetLeft}px`, w = `${el.clientWidth}px`;
    top.setCssProps({ '--dsc-x': x, '--dsc-w': w, '--dsc-y': `${el.offsetTop}px` });
    bot.setCssProps({ '--dsc-x': x, '--dsc-w': w, '--dsc-y': `${el.offsetTop + el.clientHeight - 24}px` });
    top.toggleClass('is-on', el.scrollTop > 1);
    bot.toggleClass('is-on', el.scrollTop + el.clientHeight < el.scrollHeight - 1);
  };
  el.addEventListener('scroll', update, { passive: true });
  el.addEventListener('input', update);
  const ro = new ResizeObserver(update);
  ro.observe(el);
  setTimeout(update, 0);
  return () => { ro.disconnect(); top.remove(); bot.remove(); };
}

// 누른 자리 바로 아래 작은 팝업 (아래 공간이 모자라면 위). 바깥을 누르거나 Esc로 닫힌다
function popover(anchor, build, { width = 200, align = 'left', cls = '', onClose } = {}) {
  const layer = document.body.createDiv({ cls: 'dsc-pop-layer' });
  const pop = layer.createDiv({ cls: 'dsc-pop' + (cls ? ' ' + cls : '') });
  const close = () => { if (!layer.isConnected) return; layer.remove(); document.removeEventListener('keydown', onKey, true); onClose && onClose(); };
  const onKey = (e) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); } };
  document.addEventListener('keydown', onKey, true);
  layer.addEventListener('click', (e) => { if (e.target === layer) close(); });
  build(pop, close);
  const r = anchor.getBoundingClientRect();
  const w = Math.max(width, 0);
  const left = Math.min(Math.max(8, align === 'right' ? r.right - w : r.left), window.innerWidth - w - 8);
  const h = pop.offsetHeight;
  const bottom = window.innerHeight - keyboardHeight() - 8;
  const top = r.bottom + 4 + h <= bottom ? r.bottom + 4 : Math.max(8, r.top - 4 - h);
  pop.setCssProps({ '--dsc-x': `${left}px`, '--dsc-y': `${top}px`, '--dsc-w': `${w}px` });
  return close;
}
// 팝업 항목: 아이콘 또는 색 점 + 글자 (+ 지금 값이면 초록 체크)
function popItem(pop, { icon, dot, label, checked, warning, empty, onClick }, close) {
  const b = pop.createEl('button', { cls: 'dsc-pop-item' + (checked ? ' is-on' : '') + (warning ? ' is-warning' : '') });
  if (icon) setIcon(b.createSpan({ cls: 'dsc-pop-icon' }), icon);
  if (dot !== undefined) { const d = b.createSpan({ cls: 'dsc-dot dsc-pop-dot' + (dot ? '' : ' is-none') }); catStyle(d, dot); }
  b.createSpan({ cls: 'dsc-pop-label' + (empty ? ' is-empty' : ''), text: label });
  if (checked) setIcon(b.createSpan({ cls: 'dsc-pop-check' }), 'check');
  b.onclick = (e) => { e.stopPropagation(); close(); onClick && onClick(); };
  return b;
}
// 업무분류 고르기 팝업 (상세 시트 · 새 일정 창 공통)
function catPopover(plugin, anchor, current, onPick, width = 200, onClose) {
  popover(anchor, (pop, close) => {
    popItem(pop, { dot: null, label: '분류 없음', empty: true, checked: !current, onClick: () => onPick(null) }, close);
    for (const c of plugin.settings.categories) popItem(pop, { dot: c, label: c.name, checked: c.name === current, onClick: () => onPick(c.name) }, close);
    if (current && !plugin.catOf(current)) popItem(pop, { dot: null, label: current, checked: true, onClick: () => onPick(current) }, close);
  }, { width, onClose });
}

/* ---------- plugin ---------- */
module.exports = class DailyScrumCalendar extends Plugin {
  async onload() {
    await this.loadSettings();
    this.summaries = new Map();
    this.registerView(VIEW_TYPE, (leaf) => new CalendarView(leaf, this));
    this.addRibbonIcon('calendar-days', '데일리 캘린더 열기', () => this.activateView());
    this.addCommand({ id: 'open-daily-scrum-calendar', name: '데일리 캘린더 열기', callback: () => this.activateView() });
    this.addCommand({
      id: 'edit-current-card', name: '지금 열린 일정 수정',
      checkCallback: (checking) => {
        const f = this.app.workspace.getActiveFile();
        if (!f || !this.inFolder(f)) return false;
        if (!checking) this.editCard(f);
        return true;
      },
    });
    this.addCommand({ id: 'migrate-card-notes', name: '예전 형식 일정 노트를 새 형식으로 바꾸기', callback: () => this.migrate() });
    this.addSettingTab(new DscSettingTab(this.app, this));
    this.refreshViews = debounce(() => {
      for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE)) if (leaf.view instanceof CalendarView) leaf.view.render();
    }, 250, true);
    this.registerEvent(this.app.metadataCache.on('changed', (f, data) => {
      if (!this.inFolder(f)) return;
      this.summaries.set(f.path, extractSummary(data));
      this.refreshViews();
      this.updateNoteViews(); // 속성 칸 선택 버튼 값 갱신
    }));
    this.registerEvent(this.app.vault.on('delete', (f) => { if (this.inFolder(f)) { this.summaries.delete(f.path); this.refreshViews(); } }));
    this.registerEvent(this.app.vault.on('rename', (f, old) => {
      if (this.summaries.has(old)) { this.summaries.set(f.path, this.summaries.get(old)); this.summaries.delete(old); }
      for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE)) if (leaf.view instanceof CalendarView && leaf.view.openPath === old) leaf.view.openPath = f.path;
      if (this.inFolder(f) || String(old).startsWith(this.folderPath() + '/')) this.refreshViews();
      this.updateNoteViews();
    }));
    // 일정 노트: 상단 "일정 수정" 버튼 + created 줄 숨김
    const upd = () => this.updateNoteViews();
    this.registerEvent(this.app.workspace.on('layout-change', upd));
    this.registerEvent(this.app.workspace.on('file-open', upd));
    this.registerEvent(this.app.workspace.on('active-leaf-change', upd));
    this.registerEvent(this.app.workspace.on('file-menu', (menu, file) => {
      if (!(file instanceof TFile) || !this.inFolder(file)) return;
      menu.addItem((i) => i.setTitle('일정 수정').setIcon('pencil').onClick(() => this.editCard(file)));
    }));
    this.app.workspace.onLayoutReady(async () => { await this.loadSummaries(); this.refreshViews(); this.updateNoteViews(); });
  }

  onunload() {
    document.querySelectorAll('.dsc-pop-layer, .dsc-press-layer').forEach((el) => el.remove());
    this.app.workspace.iterateAllLeaves((leaf) => {
      const v = leaf.view;
      if (v && v.dscAction) { v.dscAction.remove(); v.dscAction = null; }
      if (v && v.dscObserver) { v.dscObserver.disconnect(); v.dscObserver = null; }
      if (v && v.containerEl) {
        v.containerEl.removeClass('dsc-card-note');
        v.containerEl.querySelectorAll('.dsc-prop-select').forEach((el) => el.remove());
        v.containerEl.querySelectorAll('.dsc-prop-decorated').forEach((el) => el.removeClass('dsc-prop-decorated'));
      }
    });
  }

  async loadSettings() {
    const saved = (await this.loadData()) || {};
    this.settings = Object.assign({}, JSON.parse(JSON.stringify(DEFAULTS)), saved);
    if (!this.settings.stateTones) this.settings.stateTones = {};
    delete this.settings.spoqaFont; // 글꼴 설정 폐기 (0.3.6): 옵시디언 글꼴로 통일
    let changed = false;
    for (const s of this.settings.states) if (this.assignTone(s)) changed = true;
    if (changed) await this.saveData(this.settings);
  }
  async saveSettings() { await this.saveData(this.settings); this.refreshViews && this.refreshViews(); }

  folderPath() { return normalizePath(this.settings.folder || DEFAULTS.folder); }
  inFolder(f) { return f && f.path && f.path.startsWith(this.folderPath() + '/'); }
  catOf(name) { return name ? this.settings.categories.find((c) => c.name === name) || null : null; }

  toneOf(state) {
    return STATE_TONES[state] || this.settings.stateTones[state] || AUTO_TONES[hashOf(state) % AUTO_TONES.length];
  }
  // 새 상태값에 안 쓴 색을 붙인다. 붙였으면 true
  assignTone(state) {
    if (STATE_TONES[state] || this.settings.stateTones[state]) return false;
    const used = new Set(this.settings.states.filter((s) => s !== state).map((s) => this.toneOf(s)));
    this.settings.stateTones[state] = AUTO_TONES.find((t) => !used.has(t)) || AUTO_TONES[this.settings.states.length % AUTO_TONES.length];
    return true;
  }

  // 일정 폴더 안의 노트만 (볼트 전체 목록은 보지 않는다)
  cardFiles() {
    const root = this.app.vault.getAbstractFileByPath(this.folderPath());
    const out = [];
    if (root instanceof TFolder) Vault.recurseChildren(root, (f) => { if (f instanceof TFile && f.extension === 'md') out.push(f); });
    return out;
  }

  async loadSummaries() {
    for (const f of this.cardFiles()) {
      try { this.summaries.set(f.path, extractSummary(await this.app.vault.cachedRead(f))); } catch (e) { /* 읽기 실패 → 옛 summary 속성 사용 */ }
    }
  }

  getCards() {
    const out = [];
    for (const f of this.cardFiles()) {
      const fm = this.app.metadataCache.getFileCache(f)?.frontmatter;
      if (!fm) continue;
      const date = toDateStr(pick(fm, K.date, 'date'));
      if (!date) continue;
      // 상태값: 값 하나. 예전 states 목록은 첫 값
      let state = pick(fm, K.state, 'state');
      if (state == null && fm.states != null) state = Array.isArray(fm.states) ? fm.states.find((s) => s != null && s !== '') : fm.states;
      // 산출경로: 내부망 체크(참/거짓). 예전 network는 external만 외부망
      const iv = fm[K.internal];
      const internal = typeof iv === 'boolean' ? iv : iv != null ? String(iv) !== 'false' : fm.network !== 'external';
      const bodySum = this.summaries.get(f.path);
      const title = pick(fm, K.title, 'title');
      const category = pick(fm, K.category, 'work-category');
      out.push({
        file: f, date,
        title: title != null ? String(title) : f.basename,
        summary: bodySum != null ? bodySum : fm.summary ? String(fm.summary) : '',
        state: state != null ? String(state) : null,
        internal,
        category: category != null ? String(category) : null,
        created: fm[K.created] ? String(fm[K.created]) : '',
        ctime: f.stat.ctime,
        legacy: LEGACY_KEYS.some((k) => k in fm) || !(K.internal in fm) || bodySum == null,
      });
    }
    return out;
  }

  cardOf(file) { return this.getCards().find((c) => c.file.path === file.path) || null; }

  classify(title, summary) {
    if (!this.settings.autoClassify) return null;
    const t = (title || '').trim();
    if (t) {
      const prev = this.getCards().filter((c) => c.title === t && c.category).sort(byNewest)[0];
      if (prev && this.catOf(prev.category)) return prev.category;
    }
    const text = `${t} ${summary || ''}`.toLowerCase();
    let pick = null, best = 0;
    for (const c of this.settings.categories) {
      const n = (c.words || []).filter((w) => w && text.includes(String(w).toLowerCase())).length;
      if (n > best) { best = n; pick = c.name; }
    }
    return pick;
  }

  frontmatterLines({ date, category, state, internal, title, created }) {
    return [
      `${K.date}: ${date}`,
      `${K.category}: ${yamlStr(category || '')}`,
      `${K.state}: ${yamlStr(state || '')}`,
      `${K.internal}: ${internal ? 'true' : 'false'}`,
      `${K.title}: ${yamlStr(title)}`,
      `${K.created}: ${created}`,
    ];
  }

  uniquePath(dir, base, self) {
    let path = normalizePath(`${dir}/${base}.md`), i = 2;
    while (this.app.vault.getAbstractFileByPath(path) && path !== self) path = normalizePath(`${dir}/${base} ${i++}.md`);
    return path;
  }

  async createCard({ date, title, summary, state, internal, category }) {
    const folder = this.folderPath();
    if (!this.app.vault.getAbstractFileByPath(folder)) await this.app.vault.createFolder(folder);
    const path = this.uniquePath(folder, `${date} ${safeName(title)}`);
    const lines = ['---', ...this.frontmatterLines({ date, category, state, internal, title, created: moment().format('YYYY-MM-DDTHH:mm') }), '---', '',
      `## ${SUMMARY_HEADING}`, '', ...(summary ? summary.split(/\r?\n/) : []), '', `## ${DETAIL_HEADING}`, '', '', `## ${SCHEDULE_HEADING}`, '', ''];
    this.summaries.set(path, summary || '');
    const file = await this.app.vault.create(path, lines.join('\n'));
    this.refreshViews();
    return file;
  }

  // 속성을 정해진 순서로 다시 쓰고, 요약은 본문 "## 요약"에 둔다. 다른 속성·본문은 그대로
  // data.sections가 있으면 (상세 시트) 요약 · 상세 업무내용 · 세부일정 세 칸의 글을 그대로 바꿔 쓴다
  async updateCard(file, data, { rename = true } = {}) {
    let summary = data.summary || '';
    await this.app.vault.process(file, (text) => {
      const { fm, body } = splitNote(text);
      const rest = {};
      for (const [k, v] of Object.entries(fm)) if (!CARD_KEYS.includes(k) && !LEGACY_KEYS.includes(k)) rest[k] = v;
      const created = fm.created instanceof Date ? moment(fm.created).format('YYYY-MM-DDTHH:mm')
        : fm.created ? String(fm.created) : moment(file.stat.ctime).format('YYYY-MM-DDTHH:mm');
      const extra = Object.keys(rest).length ? stringifyYaml(rest).replace(/\n$/, '').split('\n') : [];
      const head = ['---', ...this.frontmatterLines({ ...data, created }), ...extra, '---'].join('\n');
      let out = body;
      if (data.sections) {
        const s = data.sections;
        out = setSection(out, SUMMARY_HEADING, s.summary, { stop: TOP_HEAD, prepend: true });
        out = setSection(out, DETAIL_HEADING, s.detail, { stop: TOP_HEAD });
        out = setSection(out, SCHEDULE_HEADING, s.schedule, { stop: TOP_HEAD });
      } else out = setSummarySection(out, summary);
      const next = head + '\n' + out;
      summary = extractSummary(next) || '';
      return next;
    });
    this.summaries.set(file.path, summary);
    if (!rename) return file;
    const base = `${data.date} ${safeName(data.title)}`;
    if (file.basename === base || new RegExp(`^${escRe(base)} \\d+$`).test(file.basename)) return file;
    const dir = file.parent ? file.parent.path : this.folderPath();
    await this.app.fileManager.renameFile(file, this.uniquePath(dir, base, file.path));
    return file;
  }

  // 휴대폰: 일정 상세 시트(바로 수정). PC: 일정 수정 창
  async editCard(file, opts = {}) {
    const card = this.cardOf(file);
    if (!card) { new Notice('일정 형식이 아닌 노트입니다 (날짜 속성 없음)'); return; }
    if (!Platform.isPhone) { new CardModal(this.app, this, { card }).open(); return; }
    let body = '';
    try { body = splitNote(await this.app.vault.read(file)).body; } catch (e) { console.error('[daily-scrum-calendar] read', file.path, e); }
    const sum = getSection(body, SUMMARY_HEADING);
    const sections = {
      summary: sum != null ? sum : card.summary,
      detail: getSection(body, DETAIL_HEADING) || '',
      schedule: getSection(body, SCHEDULE_HEADING) || '',
    };
    const onOpenNote = opts.onOpenNote || ((f) => this.app.workspace.getLeaf(false).openFile(f));
    new DetailSheet(this.app, this, card, sections, onOpenNote).open();
  }

  confirmDelete(file, after) {
    const card = this.cardOf(file);
    new ConfirmModal(this.app, '일정을 삭제할까요?', `'${card ? card.title : file.basename}' 일정 노트를 휴지통으로 옮깁니다.`, '삭제', async () => {
      if (this.app.fileManager.trashFile) await this.app.fileManager.trashFile(file);
      else await this.app.vault.trash(file, true);
      new Notice('일정을 삭제했습니다');
      after && after();
    }, { warning: true }).open();
  }

  migrate() {
    const list = this.getCards().filter((c) => c.legacy);
    if (!list.length) { new Notice('바꿀 일정 노트가 없습니다'); return; }
    new ConfirmModal(this.app, `일정 노트 ${list.length}개를 새 형식으로 바꿀까요?`,
      '속성을 날짜 → 업무분류 → 상태값 → 내부망 → 타이틀 순서의 한국어 이름으로 바꾸고,\n상태값 목록은 첫 값만, network는 내부망 체크로, summary는 본문 "## 요약"으로 옮깁니다.\n상태값이 여러 개였던 일정은 첫 값만 남습니다.', '바꾸기', async () => {
        let ok = 0;
        for (const c of list) {
          try { await this.updateCard(c.file, c, { rename: false }); ok++; } catch (e) { console.error('[daily-scrum-calendar] migrate', c.file.path, e); }
        }
        new Notice(`일정 노트 ${ok}개를 바꿨습니다${ok < list.length ? ` · ${list.length - ok}개 실패 (개발자 콘솔 확인)` : ''}`);
      }).open();
  }

  updateNoteViews() {
    this.app.workspace.iterateAllLeaves((leaf) => {
      const v = leaf.view;
      if (!(v instanceof MarkdownView)) return;
      const isCard = !!(v.file && this.inFolder(v.file));
      v.containerEl.toggleClass('dsc-card-note', isCard);
      if (isCard && !v.dscAction) v.dscAction = v.addAction('pencil', '일정 수정', () => v.file && this.editCard(v.file));
      if (!isCard && v.dscAction) { v.dscAction.remove(); v.dscAction = null; }
      if (isCard && !v.dscObserver) {
        // 옵시디언이 속성 칸을 다시 그릴 때마다 선택 버튼을 다시 붙인다 (일정 노트에서만)
        let queued = false;
        v.dscObserver = new MutationObserver(() => { if (queued) return; queued = true; requestAnimationFrame(() => { queued = false; this.decorateProps(v); }); });
        v.dscObserver.observe(v.containerEl, { childList: true, subtree: true });
      }
      if (!isCard && v.dscObserver) { v.dscObserver.disconnect(); v.dscObserver = null; }
      this.decorateProps(v);
    });
  }

  // 일정 노트 속성 칸의 업무분류 · 상태값을 선택 버튼으로 (값 목록은 플러그인 설정)
  decorateProps(v) {
    const file = v.file;
    const isCard = !!(file && this.inFolder(file));
    for (const row of v.containerEl.querySelectorAll('.metadata-property')) {
      const key = row.getAttribute('data-property-key');
      const want = isCard && this.settings.propSelect && (key === K.category || key === K.state);
      const old = row.querySelector(':scope > .metadata-property-value > .dsc-prop-select');
      if (!want) { if (old) old.remove(); row.removeClass('dsc-prop-decorated'); continue; }
      const cell = row.querySelector(':scope > .metadata-property-value');
      if (!cell) continue;
      const fm = this.app.metadataCache.getFileCache(file)?.frontmatter || {};
      const val = fm[key] != null && fm[key] !== '' ? String(fm[key]) : null;
      const sig = `${key}|${val}|${key === K.category ? JSON.stringify(this.catOf(val)) : this.toneOf(val || '')}`;
      if (old && old.dataset.sig === sig) continue;
      if (old) old.remove();
      row.addClass('dsc-prop-decorated');
      const b = cell.createEl('button', { cls: 'dsc-prop-select', attr: { 'aria-haspopup': 'menu', 'aria-label': `${key} 선택` } });
      b.dataset.sig = sig;
      const dot = b.createSpan({ cls: 'dsc-dot' });
      if (key === K.category) { const cat = this.catOf(val); if (cat) catStyle(dot, cat); else dot.addClass('is-none'); }
      else if (val) { dot.addClass('dsc-tone-dot', `dsc-tone-${this.toneOf(val)}`); } else dot.addClass('is-none');
      b.createSpan({ cls: 'dsc-prop-label' + (val ? '' : ' is-empty'), text: val || (key === K.category ? '분류 선택' : '상태값 선택') });
      setIcon(b.createSpan({ cls: 'dsc-dd-chev' }), 'chevron-down');
      b.onclick = (e) => { e.preventDefault(); e.stopPropagation(); this.propMenu(file, key, val, b); };
    }
  }

  propMenu(file, key, val, anchor) {
    const isCat = key === K.category;
    const opts = isCat ? this.settings.categories.map((c) => c.name) : [...this.settings.states];
    if (val && !opts.includes(val)) opts.push(val); // 목록 밖 값도 그대로 보여 준다
    const menu = new Menu();
    const set = (x) => this.app.fileManager.processFrontMatter(file, (fm) => { fm[key] = x || ''; });
    const add = (label, x) => menu.addItem((i) => {
      i.setTitle(label).setChecked(x === val).onClick(() => set(x));
      const t = i.titleEl || (i.dom && i.dom.querySelector('.menu-item-title'));
      if (t) {
        const d = createSpan({ cls: 'dsc-dot dsc-menu-dot' });
        if (!x) d.addClass('is-none');
        else if (isCat) { const cat = this.catOf(x); if (cat) catStyle(d, cat); else d.addClass('is-none'); }
        else d.addClass('dsc-tone-dot', `dsc-tone-${this.toneOf(x)}`);
        t.prepend(d);
      }
    });
    add(isCat ? '분류 없음' : '없음', null);
    for (const x of opts) add(x, x);
    const r = anchor.getBoundingClientRect();
    menu.showAtPosition({ x: r.left, y: r.bottom + 4 });
  }

  async activateView() {
    let leaf = this.app.workspace.getLeavesOfType(VIEW_TYPE)[0];
    if (!leaf) { leaf = this.app.workspace.getLeaf('tab'); await leaf.setViewState({ type: VIEW_TYPE, active: true }); }
    this.app.workspace.revealLeaf(leaf);
  }
};

/* ---------- calendar view ---------- */
class CalendarView extends ItemView {
  constructor(leaf, plugin) {
    super(leaf);
    this.plugin = plugin;
    this.month = moment().startOf('month');
    this.spread = null;
    this.openPath = null;
    this.noteLeaf = null;
    this.compact = false;
    this.narrow = false;   // 좁음 단계 (휴대폰·사이드바): 날짜 칸에 일정 막대, 아래에 그날 일정 목록
    this.selected = null;  // 좁음 단계에서 고른 날짜
    this.expanded = new Set(); // 목록 카드 중 요약을 펼친 것 (파일 경로)
  }
  getViewType() { return VIEW_TYPE; }
  getDisplayText() { return '데일리 캘린더'; }
  getIcon() { return 'calendar-days'; }

  async onOpen() {
    const c = this.containerEl.children[1];
    c.empty();
    c.addClass('dsc-view');
    this.root = c.createDiv({ cls: 'dsc-root' });
    this.ro = new ResizeObserver(() => this.updateSize());
    this.ro.observe(this.root);
    this.registerDomEvent(document, 'click', (e) => {
      if (this.spread && !(e.target instanceof Element && e.target.closest('.dsc-cell'))) { this.spread = null; this.render(); }
    });
    this.render();
  }
  async onClose() { this.ro && this.ro.disconnect(); this.closePress && this.closePress(); }

  updateSize() {
    if (!this.root) return;
    const cellW = this.root.clientWidth / 7;
    if (!cellW) return;
    const narrow = cellW < 72; // 중간 단계 카드(67px)도 들어가지 않는 폭
    const compact = !narrow && cellW < 120;
    if (compact !== this.compact) { this.compact = compact; this.root.toggleClass('is-compact', compact); }
    if (narrow !== this.narrow) { this.narrow = narrow; this.render(); return; }
    this.fitChips();
    this.fitSummaries();
  }

  render() {
    if (!this.root) return;
    if (this.noteLeaf && !this.noteLeaf.view?.containerEl?.isConnected) { this.noteLeaf = null; this.openPath = null; }
    const root = this.root;
    root.empty();
    const cards = this.plugin.getCards();
    const byDate = new Map();
    for (const c of cards) { if (!byDate.has(c.date)) byDate.set(c.date, []); byDate.get(c.date).push(c); }
    for (const list of byDate.values()) list.sort(byNewest);

    const narrow = this.narrow;
    root.toggleClass('is-narrow', narrow);
    const today = moment().format('YYYY-MM-DD');
    if (!this.selected || !moment(this.selected).isSame(this.month, 'month')) this.selected = moment().isSame(this.month, 'month') ? today : this.month.format('YYYY-MM-DD');

    // 달력 머리: 왼쪽 [‹] 2026년 9월 [›] · 오른쪽 [오늘]
    const bar = root.createDiv({ cls: 'dsc-toolbar' });
    const nav = bar.createDiv({ cls: 'dsc-nav' });
    const arrow = (icon, aria, fn) => { const b = nav.createEl('button', { cls: 'dsc-nav-arrow', attr: { 'aria-label': aria } }); setIcon(b, icon); b.onclick = fn; };
    arrow('chevron-left', '이전 달', () => this.shiftMonth(-1));
    nav.createEl('h2', { text: this.month.format('YYYY년 M월') });
    arrow('chevron-right', '다음 달', () => this.shiftMonth(1));
    const todayBtn = bar.createEl('button', { cls: 'dsc-nav-today', text: '오늘' });
    todayBtn.onclick = () => { this.month = moment().startOf('month'); this.selected = today; this.spread = null; this.render(); };

    const grid = root.createDiv({ cls: 'dsc-grid' + (this.slideDir ? ` dsc-slide-${this.slideDir}` : '') });
    this.slideDir = null;
    // 날짜 칸 영역에서 좌우로 밀면 이전·다음 달. 이 영역에서만 옵시디언의 "밀어서 사이드 메뉴 열기"를 끈다
    grid.dataset.ignoreSwipe = 'true';
    this.attachSwipe(grid);
    for (const w of WEEKDAYS) grid.createDiv({ cls: 'dsc-wd', text: w });
    const start = this.month.clone().subtract(this.month.day(), 'days');
    const weeks = Math.ceil((this.month.day() + this.month.daysInMonth()) / 7);
    for (let i = 0; i < weeks * 7; i++) {
      const d = start.clone().add(i, 'days');
      const iso = d.format('YYYY-MM-DD');
      const out = d.month() !== this.month.month();
      const cell = grid.createDiv({ cls: 'dsc-cell' + (out ? ' is-out' : '') });
      const num = cell.createDiv({ cls: 'dsc-day' });
      const numSpan = num.createSpan({ text: String(d.date()) });
      if (iso === today) numSpan.addClass('dsc-today');
      if (out) continue;
      const list = byDate.get(iso) || [];
      if (narrow) {
        // 일정 1개 = 막대 1개 (등록한 순서). 최대 3개, 4개 이상이면 2개 + "+N"
        if (iso === today) cell.addClass('is-today');
        else if (iso === this.selected) cell.addClass('is-selected');
        if (d.day() === 0 || d.day() === 6) cell.addClass('is-weekend');
        if (list.length) {
          const evs = cell.createDiv({ cls: 'dsc-events' });
          const sorted = [...list].sort(byOldest);
          const shown = sorted.length > 3 ? sorted.slice(0, 2) : sorted;
          for (const c of shown) {
            const cat = this.plugin.catOf(c.category);
            const ev = evs.createDiv({ cls: 'dsc-ev' + (cat ? ' has-cat' : '') });
            catStyle(ev, cat);
            ev.createSpan({ cls: 'dsc-ev-dot' + (c.state ? ` dsc-tone-${this.plugin.toneOf(c.state)}` : '') });
            ev.createSpan({ cls: 'dsc-ev-title', text: c.title });
          }
          if (sorted.length > 3) evs.createDiv({ cls: 'dsc-ev-more', text: '+' + (sorted.length - 2) });
        }
        cell.setAttr('role', 'button');
        cell.setAttr('aria-label', `${d.format('M월 D일')} 일정 ${list.length}개`);
        cell.onclick = () => { if (this.justSwiped()) return; this.selected = iso; this.render(); };
        continue;
      }
      if (list.length === 1) cell.appendChild(this.cardEl(list[0]));
      if (list.length > 1) {
        const st = cell.createDiv({ cls: 'dsc-stack' + (list.length > 2 ? ' is-three' : '') });
        st.createDiv({ cls: 'dsc-back dsc-back-1' });
        if (list.length > 2) st.createDiv({ cls: 'dsc-back dsc-back-2' });
        st.appendChild(this.cardEl(list[0], (e) => { e.stopPropagation(); this.spread = this.spread === iso ? null : iso; this.render(); }));
        st.createSpan({ cls: 'dsc-badge', text: String(list.length) });
        if (this.spread === iso) {
          const sp = cell.createDiv({ cls: 'dsc-spread' + (d.day() >= 4 ? ' is-left' : '') });
          sp.onclick = (e) => e.stopPropagation();
          for (const c of list) sp.appendChild(this.cardEl(c));
        }
      }
      if (!list.length) cell.createDiv({ cls: 'dsc-hint', text: '+ 일정 추가' });
      cell.onclick = () => {
        if (this.justSwiped()) return;
        if (this.spread) { this.spread = null; this.render(); return; }
        new CardModal(this.app, this.plugin, { date: iso }).open();
      };
    }
    if (narrow) this.renderDayList(root, byDate.get(this.selected) || []);
    this.fitSummaries();
    requestAnimationFrame(() => { this.fitChips(); this.fitSummaries(); });
  }

  shiftMonth(n) {
    this.month = this.month.clone().add(n, 'month');
    this.spread = null;
    this.slideDir = n > 0 ? 'next' : 'prev';
    this.render();
  }

  // 밀어서 넘긴 직후에 따라오는 누르기(날짜 선택·일정 열기)는 무시
  justSwiped() { return !!this.swipedAt && Date.now() - this.swipedAt < 400; }

  attachSwipe(el) {
    let sx = 0, sy = 0, st = 0, track = false;
    el.addEventListener('touchstart', (e) => {
      if (e.touches.length !== 1) { track = false; return; }
      const t = e.touches[0]; sx = t.clientX; sy = t.clientY; st = Date.now(); track = true;
    }, { passive: true });
    el.addEventListener('touchend', (e) => {
      if (!track) return; track = false;
      const t = e.changedTouches[0]; const dx = t.clientX - sx, dy = t.clientY - sy;
      // 가로로 50px 이상, 세로보다 확실히 크게, 0.6초 안에 민 경우만
      if (Math.abs(dx) < 50 || Math.abs(dx) < Math.abs(dy) * 1.5 || Date.now() - st > 600) return;
      this.swipedAt = Date.now();
      this.shiftMonth(dx < 0 ? 1 : -1);
    });
    el.addEventListener('touchcancel', () => { track = false; });
  }

  // 좁음 단계: 고른 날짜의 일정 목록
  renderDayList(root, list) {
    const d = moment(this.selected);
    const wrap = root.createDiv({ cls: 'dsc-daylist' });
    const head = wrap.createDiv({ cls: 'dsc-daylist-head' });
    head.createSpan({ cls: 'dsc-daylist-date', text: `${d.format('M월 D일')} ${WEEKDAYS[d.day()]}요일` });
    head.createSpan({ cls: 'dsc-daylist-count', text: list.length ? `일정 ${list.length}개` : '일정 없음' });
    const add = head.createEl('button', { cls: 'dsc-daylist-add' });
    setIcon(add.createSpan({ cls: 'dsc-daylist-add-icon' }), 'plus');
    add.createSpan({ text: '일정 추가' });
    const create = () => new CardModal(this.app, this.plugin, { date: this.selected }).open();
    add.onclick = create;
    if (!list.length) {
      const em = wrap.createEl('button', { cls: 'dsc-daylist-empty' });
      em.createDiv({ text: '이 날은 일정이 없습니다' });
      em.createDiv({ cls: 'dsc-daylist-empty-cta', text: '눌러서 일정 추가' });
      em.onclick = create;
      return;
    }
    const box = wrap.createDiv({ cls: 'dsc-daylist-cards' });
    for (const c of list) box.appendChild(this.cardEl(c, null, true));
  }

  // 일정 카드. list = 좁음 단계 목록 카드 (요약 펼치기 버튼)
  cardEl(card, onClick, list = false) {
    const cat = this.plugin.catOf(card.category);
    const expanded = list && this.expanded.has(card.file.path);
    const el = createDiv({ cls: 'dsc-card' + (list ? ' is-list' : '') + (cat ? ' has-cat' : '') + (expanded ? ' is-expanded' : '') + (this.openPath === card.file.path ? ' is-selected' : '') });
    catStyle(el, cat);
    el.setAttr('role', 'button'); el.setAttr('tabindex', '0');
    el.setAttr('aria-label', `${card.title}${cat ? ', ' + cat.name : ''}`);
    // 플래그 순서: 상태값(색 점) → 산출경로
    const chips = el.createDiv({ cls: 'dsc-chips' });
    if (card.state) {
      const s = chips.createSpan({ cls: `dsc-tag dsc-flag-state dsc-tone-${this.plugin.toneOf(card.state)}` });
      s.createSpan({ cls: 'dsc-flag-dot' });
      s.createSpan({ text: card.state });
    }
    chips.createSpan({ cls: 'dsc-tag dsc-flag-net', text: netLabel(card.internal) });
    chips.createSpan({ cls: 'dsc-more' });
    el.createDiv({ cls: 'dsc-title', text: card.title });
    if (card.summary) el.createDiv({ cls: 'dsc-summary', text: card.summary });
    if (list && card.summary) {
      // 요약이 2줄을 넘을 때만 보인다 (fitSummaries). 글자 없이 원형 꺾쇠 버튼
      const acc = el.createDiv({ cls: 'dsc-acc', attr: { role: 'button', 'aria-label': expanded ? '요약 접기' : '요약 펼치기' } });
      acc.hidden = true;
      const btn = acc.createSpan({ cls: 'dsc-acc-btn' });
      setIcon(btn, expanded ? 'chevron-up' : 'chevron-down');
      acc.onclick = (e) => {
        e.stopPropagation();
        const on = !this.expanded.has(card.file.path);
        if (on) this.expanded.add(card.file.path); else this.expanded.delete(card.file.path);
        el.toggleClass('is-expanded', on);
        btn.empty(); setIcon(btn, on ? 'chevron-up' : 'chevron-down');
        acc.setAttr('aria-label', on ? '요약 접기' : '요약 펼치기');
      };
    }
    const phone = Platform.isPhone;
    const open = onClick || ((e) => {
      e.stopPropagation();
      // 휴대폰: 일정 상세 시트에서 바로 수정. PC: 옆에 노트 열기
      if (phone) this.plugin.editCard(card.file, { onOpenNote: (f) => this.openNote(f) });
      else this.openNote(card.file);
    });
    let pressTimer = null, pressed = false; // 길게 누르기 (휴대폰) — 누른 뒤 따라오는 클릭은 무시
    el.onclick = (e) => { if (pressed || this.justSwiped()) { e.preventDefault(); e.stopPropagation(); pressed = false; return; } open(e); };
    el.onkeydown = (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(e); } };
    const showMenu = (e) => {
      if (phone) { this.pressMenu(el, card); return; }
      const menu = new Menu();
      menu.addItem((i) => i.setTitle('일정 수정').setIcon('pencil').onClick(() => new CardModal(this.app, this.plugin, { card }).open()));
      menu.addItem((i) => i.setTitle('노트 열기').setIcon('file-text').onClick(() => this.openNote(card.file)));
      menu.addSeparator();
      menu.addItem((i) => { i.setTitle('일정 삭제').setIcon('trash-2').onClick(() => this.plugin.confirmDelete(card.file)); if (i.setWarning) i.setWarning(true); });
      menu.showAtMouseEvent(e);
    };
    const cancelPress = () => { if (pressTimer) { window.clearTimeout(pressTimer); pressTimer = null; } };
    el.oncontextmenu = (e) => {
      e.preventDefault(); e.stopPropagation();
      if (pressTimer || pressed) { cancelPress(); if (pressed) return; pressed = true; } // 휴대폰에서 길게 누르기와 겹치면 한 번만
      showMenu(e);
    };
    el.addEventListener('touchstart', () => {
      pressed = false; cancelPress();
      pressTimer = window.setTimeout(() => { pressTimer = null; pressed = true; showMenu(); }, 500);
    }, { passive: true });
    el.addEventListener('touchmove', cancelPress, { passive: true });
    el.addEventListener('touchend', (e) => { if (pressed) e.preventDefault(); cancelPress(); }); // 누른 뒤 따라오는 클릭 막기
    el.addEventListener('touchcancel', cancelPress);
    return el;
  }

  // 휴대폰 꾹 누르기: 눌린 카드를 띄우고 뒤는 30% 어둡게, 카드 바로 아래(모자라면 위) 작은 팝업에 "삭제"
  pressMenu(el, card) {
    this.closePress && this.closePress();
    const r = el.getBoundingClientRect();
    const layer = document.body.createDiv({ cls: 'dsc-press-layer' });
    const lifted = el.cloneNode(true);
    lifted.addClass('is-lifted');
    lifted.setCssProps({ '--dsc-x': `${r.left}px`, '--dsc-y': `${r.top}px`, '--dsc-w': `${r.width}px` });
    layer.appendChild(lifted);
    const pop = layer.createDiv({ cls: 'dsc-pop dsc-press-pop' });
    const openedAt = Date.now();
    const close = () => { layer.remove(); document.removeEventListener('keydown', onKey, true); this.closePress = null; };
    const onKey = (e) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); } };
    document.addEventListener('keydown', onKey, true);
    this.closePress = close;
    popItem(pop, { icon: 'trash-2', label: '삭제', warning: true, onClick: () => this.plugin.confirmDelete(card.file) }, close);
    layer.addEventListener('click', (e) => {
      if (Date.now() - openedAt < 400) return; // 손을 떼며 생기는 클릭은 무시
      if (!(e.target instanceof Element && e.target.closest('.dsc-press-pop'))) close();
    });
    const h = pop.offsetHeight, w = 180;
    // 떠 있는 하단 탭 바 밑으로 들어가지 않게 (탭 바가 있으면 그 위 끝까지만)
    const nav = document.querySelector('.mobile-navbar');
    const navTop = nav instanceof HTMLElement && nav.offsetParent ? nav.getBoundingClientRect().top : window.innerHeight;
    const bottom = Math.min(window.innerHeight, navTop) - 8;
    const top = r.bottom + 8 + h <= bottom ? r.bottom + 8 : Math.max(8, r.top - 8 - h);
    const left = Math.min(Math.max(8, r.left), window.innerWidth - w - 8);
    pop.setCssProps({ '--dsc-x': `${left}px`, '--dsc-y': `${top}px`, '--dsc-w': `${w}px` });
  }

  fitChips() {
    if (!this.root) return;
    const max = this.compact && !this.narrow ? 1 : 2;
    for (const row of this.root.querySelectorAll('.dsc-chips')) {
      const tags = Array.from(row.querySelectorAll('.dsc-tag'));
      const more = row.querySelector('.dsc-more');
      const update = () => { const hid = tags.filter((t) => t.hidden).length; more.hidden = hid === 0; more.textContent = '+' + hid; };
      tags.forEach((t, i) => { t.hidden = i >= max; });
      update();
      let shown = Math.min(max, tags.length);
      while (shown > 1 && row.scrollWidth > row.clientWidth + 1) { shown--; tags[shown].hidden = true; update(); }
    }
  }

  // 목록 카드: 요약이 2줄을 넘을 때만 펼치기 버튼
  fitSummaries() {
    if (!this.root) return;
    for (const el of this.root.querySelectorAll('.dsc-card.is-list')) {
      const s = el.querySelector('.dsc-summary'), acc = el.querySelector('.dsc-acc');
      if (!s || !acc || !s.clientHeight) continue;
      const lh = parseFloat(getComputedStyle(s).lineHeight) || 18;
      acc.hidden = s.scrollHeight <= lh * 2 + 2;
    }
  }

  async openNote(file) {
    this.spread = null;
    if (Platform.isPhone) { await this.leaf.openFile(file); return; } // 휴대폰은 화면을 나눌 수 없음 → 달력 자리에서 열고 뒤로 가기로 복귀
    if (!this.noteLeaf || !this.noteLeaf.view?.containerEl?.isConnected) this.noteLeaf = this.app.workspace.createLeafBySplit(this.leaf, 'vertical');
    await this.noteLeaf.openFile(file, { active: false });
    this.openPath = file.path;
    this.render();
  }
}

// 지금 화면에 실제로 보이는 영역의 아래 끝 (키보드 위 끝 · 아이폰이 입력칸을 보이려고 화면을 밀어 올린 경우까지 반영)
// 브라우저 쪽 보이는 영역이 키보드만큼 줄어 있으면 그 값을, 아니면 옵시디언이 알려 주는 키보드 높이를 쓴다
const visibleBottom = () => {
  const vv = window.visualViewport;
  if (vv && vv.height < window.innerHeight - 1) return vv.offsetTop + vv.height;
  return (vv ? vv.offsetTop : 0) + window.innerHeight - keyboardHeight();
};

// 휴대폰 바텀시트 공통: 누른 입력칸이 키보드(와 저장 버튼)에 가려지지 않게 시트 안에서만 스크롤한다.
// 화면 전체를 움직이는 scrollIntoView는 쓰지 않는다 — 시트 바깥 화면까지 밀려 올라간 채 남는 원인이 된다
function sheetReveal(modal, bottomGap = 16) {
  const c = modal.contentEl;
  const reveal = () => {
    const el = document.activeElement;
    if (!(el instanceof HTMLElement) || !el.isConnected || !c.contains(el)) return;
    const r = el.getBoundingClientRect(), cr = c.getBoundingClientRect();
    const top = cr.top + 16, bottom = Math.min(cr.bottom, visibleBottom()) - bottomGap;
    if (r.bottom > bottom) c.scrollTop += Math.max(0, Math.min(r.bottom - bottom, r.top - top)); // 긴 칸은 윗부분이 보이는 데까지만
    else if (r.top < top) c.scrollTop -= top - r.top;
  };
  // 키보드가 내려가면: 밀려 올라간 화면을 제자리로 + 저장 버튼 위치 다시 계산
  const settle = () => {
    if (window.scrollY || document.documentElement.scrollTop || document.body.scrollTop) window.scrollTo(0, 0);
    modal.containerEl.scrollTop = 0; modal.modalEl.scrollTop = 0;
    modal.placeFab && modal.placeFab();
  };
  const later = (fn, ms) => () => setTimeout(fn, ms);
  const onFocusIn = later(() => { reveal(); modal.placeFab && modal.placeFab(); }, 350);
  const onFocusOut = later(() => { if (!c.contains(document.activeElement)) settle(); }, 150);
  const onTransEnd = (e) => { if (e.target === modal.containerEl) { reveal(); modal.placeFab && modal.placeFab(); } };
  const ev = [
    [window, 'keyboardDidShow', later(() => { reveal(); modal.placeFab && modal.placeFab(); }, 50)],
    [window, 'keyboardWillHide', later(settle, 0)],
    [window, 'keyboardDidHide', later(settle, 50)],
  ];
  const vv = window.visualViewport;
  const onViewport = () => modal.placeFab && modal.placeFab();
  c.addEventListener('focusin', onFocusIn);
  c.addEventListener('focusout', onFocusOut);
  modal.containerEl.addEventListener('transitionend', onTransEnd);
  for (const [t, n, f] of ev) t.addEventListener(n, f);
  if (vv) { vv.addEventListener('resize', onViewport); vv.addEventListener('scroll', onViewport); }
  return () => {
    for (const [t, n, f] of ev) t.removeEventListener(n, f);
    if (vv) { vv.removeEventListener('resize', onViewport); vv.removeEventListener('scroll', onViewport); }
  };
}

// 휴대폰 바텀시트 손 제스처
// - 아래로 끌기: 본문이 맨 위일 때(또는 머리 부분에서) 시트 어디서든 따라 내려오고, 충분히 끌면 닫힌다
// - 스크롤할 게 없는 방향으로 끌기: 저항을 두고 조금만 움직였다가 놓으면 튕기며 돌아온다 (스프링)
const SPRING = '420ms cubic-bezier(.34, 1.56, .64, 1)';
const rubber = (d, max = 120) => (1 - 1 / ((d * 0.55) / max + 1)) * max;
function attachSheetGesture(modal, onPullClose) {
  const el = modal.modalEl, c = modal.contentEl;
  let sx = 0, sy = 0, st = 0, y = 0, mode = null, fromContent = false, canScroll = false, timer = 0;
  const setY = (v, anim) => {
    y = v;
    window.clearTimeout(timer);
    el.setCssProps({ transition: anim ? `transform ${anim}` : 'none', transform: v ? `translateY(${v}px)` : '' });
    if (anim) timer = window.setTimeout(() => el.setCssProps({ transition: '' }), 460);
  };
  const skipTarget = (t) => {
    if (!(t instanceof Element)) return true;
    if (t.closest('.modal-header, .dsc-fab, .dsc-title-chips')) return true; // 옵시디언 제목 줄 끌기 · 저장 버튼 · 가로로 넘기는 칩 줄
    const a = document.activeElement; // 입력 중인 칸 안에서는 글자 선택·커서 이동이 먼저
    return a instanceof HTMLElement && (a.tagName === 'TEXTAREA' || a.tagName === 'INPUT') && a.contains(t);
  };
  const onStart = (e) => {
    mode = null;
    if (e.touches.length !== 1 || modal.gestureOff || skipTarget(e.target)) { mode = 'skip'; return; }
    const t = e.touches[0]; sx = t.clientX; sy = t.clientY; st = Date.now();
    fromContent = c.contains(e.target);
    canScroll = c.scrollHeight > c.clientHeight + 1;
  };
  const onMove = (e) => {
    if (mode === 'skip') return;
    const t = e.touches[0], dx = t.clientX - sx, dy = t.clientY - sy;
    if (mode === null) {
      if (Math.abs(dx) < 6 && Math.abs(dy) < 6) return;
      if (Math.abs(dx) > Math.abs(dy)) { mode = 'skip'; return; }
      // 아래로: 본문이 맨 위일 때만 시트를 끈다 / 위로: 스크롤할 게 없을 때만 스프링
      const drag = dy > 0 ? (!fromContent || c.scrollTop <= 0) : (!fromContent || !canScroll);
      mode = drag ? 'drag' : 'skip';
      if (mode === 'skip') return;
      sy = t.clientY; st = Date.now(); // 끌기 시작점부터 잰다
    }
    e.preventDefault();
    const d = t.clientY - sy;
    setY(d >= 0 ? d : -rubber(-d));
  };
  const onEnd = () => {
    if (mode !== 'drag') { mode = null; return; }
    mode = null;
    const v = y / Math.max(1, Date.now() - st);
    if (y > 110 || (y > 40 && v > 0.6)) onPullClose(y, () => setY(0, SPRING));
    else setY(0, SPRING);
  };
  el.addEventListener('touchstart', onStart, { passive: true });
  el.addEventListener('touchmove', onMove, { passive: false });
  el.addEventListener('touchend', onEnd);
  el.addEventListener('touchcancel', onEnd);
  return {
    get y() { return y; },
    off: () => {
      el.removeEventListener('touchstart', onStart); el.removeEventListener('touchmove', onMove);
      el.removeEventListener('touchend', onEnd); el.removeEventListener('touchcancel', onEnd);
    },
  };
}
// 끌어서 닫을 때: 끌어 내린 자리에서 그대로 아래로 사라진다 (옵시디언 닫기 애니메이션은 맨 위로 되돌린 뒤 내려가서 튐)
function slideOut(modal) {
  const el = modal.modalEl, bg = modal.containerEl.querySelector('.modal-bg');
  el.setCssProps({ transition: 'transform 180ms ease-out', transform: `translateY(${el.offsetHeight}px)` });
  if (bg instanceof HTMLElement) bg.setCssProps({ transition: 'opacity 180ms linear', opacity: '0' });
  return new Promise((r) => window.setTimeout(r, 190));
}

/* ---------- card modal (새 일정 · 일정 수정) ---------- */
class CardModal extends Modal {
  constructor(app, plugin, { date, card } = {}) {
    super(app);
    this.plugin = plugin;
    this.card = card || null;
    const st = plugin.settings.states;
    this.f = card
      ? { date: card.date, title: card.title, summary: card.summary, category: card.category, manual: true, state: card.state, internal: card.internal }
      : { date, title: '', summary: '', category: null, manual: false, state: st.includes('진행중') ? '진행중' : null, internal: true };
    Object.assign(this.f, { editing: false, adding: false });
  }
  onOpen() {
    const edit = !!this.card;
    this.phone = Platform.isPhone;
    this.modalEl.addClass('dsc-modal');
    if (this.phone) {
      // 휴대폰: 바텀시트. 키보드가 올라오면 시트도 키보드 위로 올라간다
      this.modalEl.addClass('dsc-phone');
      this.containerEl.addClass('dsc-sheet');
      this.modalEl.prepend(createDiv({ cls: 'dsc-grab' }));
      this.offReveal = sheetReveal(this);
      this.offFade = attachFade(this.contentEl);
      this.gesture = attachSheetGesture(this, () => { this.dragClose = true; this.close(); });
    }
    this.titleEl.setText(edit ? '일정 수정' : '새 일정');
    const c = this.contentEl;
    c.empty();
    const field = (label, req) => { const g = c.createDiv({ cls: 'dsc-field' }); const lr = g.createDiv({ cls: 'dsc-lrow' }); const l = lr.createSpan({ cls: 'dsc-label', text: label }); if (req) l.createSpan({ cls: 'dsc-req', text: ' *' }); return { g, lr }; };

    if (edit) {
      // 수정할 때는 날짜도 바꿀 수 있다 → 저장하면 일정이 그 날짜로 이동
      this.dateInput = field('날짜').g.createEl('input', { cls: 'dsc-input', attr: { type: 'date', value: this.f.date, 'aria-label': '날짜' } });
      this.dateInput.onchange = () => { if (toDateStr(this.dateInput.value)) this.f.date = this.dateInput.value; };
    } else {
      field('날짜').g.createEl('input', { cls: 'dsc-input', attr: { type: 'text', readonly: '', value: dateLabel(this.f.date) } });
    }

    const t = field('타이틀', true).g.createDiv({ cls: 'dsc-combo' });
    this.titleInput = t.createEl('input', { cls: 'dsc-input', attr: { type: 'text', placeholder: '입력하거나 이전 타이틀 선택', id: 'dsc-title' } });
    this.titleInput.value = this.f.title;
    this.suggest = t.createDiv({ cls: 'dsc-suggest' }); this.suggest.hidden = true;
    // 휴대폰: 이전 타이틀은 입력칸 바로 아래에 칩 줄로 펼친다
    if (this.phone) { this.titleChips = t.createDiv({ cls: 'dsc-title-chips' }); this.titleChips.hidden = true; }
    const suggest = () => (this.phone ? this.renderTitleChips() : this.renderSuggest());
    this.titleInput.oninput = () => { this.f.title = this.titleInput.value; suggest(); this.auto(); };
    this.titleInput.onfocus = suggest;
    this.titleInput.onblur = () => setTimeout(() => { this.suggest.hidden = true; if (this.titleChips) { this.titleChips.hidden = true; this.titleChips.empty(); } }, 150);
    this.titleInput.onkeydown = (e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); this.submit(); } };

    this.catBox = field('업무 분류').g.createDiv({ cls: 'dsc-dd' });
    this.renderCat();

    const s = field('요약').g;
    this.sumInput = s.createEl('textarea', { cls: 'dsc-input dsc-textarea', attr: { placeholder: '간략한 내용' } });
    this.sumInput.value = this.f.summary;
    this.sumInput.oninput = () => { this.f.summary = this.sumInput.value; this.auto(); };
    s.createDiv({ cls: 'dsc-help', text: '카드에는 최대 2줄까지 표시됩니다' });

    const sf = field('상태값');
    this.editLink = sf.lr.createEl('button', { cls: 'dsc-link', text: '수정' });
    this.editLink.onclick = () => { this.f.editing = !this.f.editing; this.f.adding = false; this.renderStates(); };
    this.statesBox = sf.g.createDiv({ cls: 'dsc-chiprow' });
    this.renderStates();

    // 산출경로: 내부망 체크박스 (체크 = 내부망, 해제 = 외부망)
    const nf = field('산출경로').g;
    const lab = nf.createEl('label', { cls: 'dsc-check' });
    this.netBox = lab.createEl('input', { attr: { type: 'checkbox' } });
    this.netBox.checked = !!this.f.internal;
    this.netBox.onchange = () => { this.f.internal = this.netBox.checked; };
    lab.createSpan({ text: '내부망' });

    // 휴대폰(바텀시트): 아래 버튼은 만들기·저장 하나, 취소는 위쪽 ✕
    const phone = this.phone;
    const foot = c.createDiv({ cls: 'dsc-foot' + (phone ? ' is-phone' : '') });
    const del = () => this.plugin.confirmDelete(this.card.file, () => this.close());
    if (edit && !phone) foot.createEl('button', { cls: 'dsc-del', text: '삭제' }).onclick = del;
    if (!phone) foot.createEl('button', { text: '취소' }).onclick = () => this.close();
    const ok = foot.createEl('button', { cls: 'mod-cta', text: edit ? '저장' : '만들기' });
    ok.onclick = () => this.submit();
    if (edit && phone) c.createEl('button', { cls: 'dsc-del-link', text: '일정 삭제' }).onclick = del;

    if (!edit) setTimeout(() => this.titleInput.focus(), 0);
  }
  // 옵시디언이 휴대폰에서 창을 닫을 때 부르는 애니메이션. 끌어서 닫을 때만 끌린 자리에서 내려간다
  animateClose() { return this.dragClose ? slideOut(this) : super.animateClose ? super.animateClose() : Promise.resolve(); }
  onClose() {
    this.offReveal && this.offReveal();
    this.offFade && this.offFade();
    this.gesture && this.gesture.off();
    document.querySelectorAll('.dsc-pop-layer').forEach((el) => el.remove());
    this.contentEl.empty();
  }

  auto() {
    if (this.f.manual) return;
    const pick = this.plugin.classify(this.f.title, this.f.summary);
    if (pick !== this.f.category) { this.f.category = pick; this.renderCat(); }
  }

  renderSuggest() {
    const v = this.titleInput.value.trim();
    const seen = new Map();
    for (const c of this.plugin.getCards().sort(byNewest)) {
      if (!seen.has(c.title)) seen.set(c.title, { title: c.title, date: c.date, n: 0 });
      seen.get(c.title).n++;
    }
    const hits = Array.from(seen.values()).filter((x) => !v || x.title.includes(v)).slice(0, 5);
    const box = this.suggest; box.empty();
    if (!hits.length) { box.hidden = true; return; }
    box.createDiv({ cls: 'dsc-suggest-sec', text: '이전 타이틀' });
    for (const h of hits) {
      const b = box.createEl('button', { cls: 'dsc-suggest-item' });
      const name = b.createSpan();
      const i = v ? h.title.indexOf(v) : -1;
      if (i >= 0) { name.appendText(h.title.slice(0, i)); name.createEl('strong', { text: v }); name.appendText(h.title.slice(i + v.length)); } else name.setText(h.title);
      const dm = moment(h.date);
      b.createSpan({ cls: 'dsc-suggest-meta', text: `최근 ${dm.format('M/D')} · ${h.n}개` });
      b.onmousedown = (e) => { e.preventDefault(); this.titleInput.value = h.title; this.f.title = h.title; box.hidden = true; this.auto(); };
    }
    if (v && !seen.has(v)) {
      const b = box.createEl('button', { cls: 'dsc-suggest-item dsc-suggest-new', text: `+ "${v}" 새 타이틀로 입력` });
      b.onmousedown = (e) => { e.preventDefault(); box.hidden = true; };
    }
    box.hidden = false;
  }

  // 이전 타이틀 (최근 사용 순)
  titleHits(v, max) {
    const seen = new Map();
    for (const c of this.plugin.getCards().sort(byNewest)) {
      if (!seen.has(c.title)) seen.set(c.title, { title: c.title, date: c.date, n: 0 });
      seen.get(c.title).n++;
    }
    return Array.from(seen.values()).filter((x) => !v || (x.title.includes(v) && x.title !== v)).slice(0, max);
  }

  // 휴대폰: 입력칸 아래에 이전 타이틀 칩 줄. 겹치는 게 없으면 접는다 = 새 타이틀
  renderTitleChips() {
    const v = this.titleInput.value.trim();
    const hits = this.titleHits(v, 10);
    const row = this.titleChips; row.empty();
    row.hidden = !hits.length;
    for (const h of hits) {
      const b = row.createEl('button', { cls: 'dsc-kchip' });
      const i = v ? h.title.indexOf(v) : -1;
      if (i >= 0) { b.appendText(h.title.slice(0, i)); b.createEl('strong', { text: v }); b.appendText(h.title.slice(i + v.length)); } else b.setText(h.title);
      b.onpointerdown = (e) => e.preventDefault(); // 입력칸 포커스(키보드) 유지
      b.onclick = () => { this.titleInput.value = h.title; this.f.title = h.title; this.auto(); row.hidden = true; row.empty(); this.titleInput.blur(); };
    }
  }

  async addState(v) {
    const S = this.plugin.settings;
    v = (v || '').trim();
    if (v) {
      if (!S.states.includes(v)) { this.plugin.assignTone(v); S.states.push(v); await this.plugin.saveSettings(); }
      this.f.state = v;
    }
    this.f.adding = false; this.renderStates();
  }

  // 업무 분류: 버튼 바로 아래 작은 팝업에서 고른다 (상세 시트와 같은 팝업)
  renderCat() {
    const box = this.catBox; box.empty();
    const cat = this.plugin.catOf(this.f.category);
    const b = box.createEl('button', { cls: 'dsc-dd-btn', attr: { 'aria-haspopup': 'listbox' } });
    if (cat) { const dot = b.createSpan({ cls: 'dsc-dot' }); catStyle(dot, cat); b.createSpan({ cls: 'dsc-dd-label', text: cat.name }); }
    else if (this.f.category) { b.createSpan({ cls: 'dsc-dot is-none' }); b.createSpan({ cls: 'dsc-dd-label', text: this.f.category }); }
    else b.createSpan({ cls: 'dsc-dd-label is-empty', text: '분류 선택' });
    setIcon(b.createSpan({ cls: 'dsc-dd-chev' }), 'chevron-down');
    b.onclick = (e) => {
      e.stopPropagation();
      b.addClass('is-open');
      catPopover(this.plugin, b, this.f.category, (name) => { this.f.category = name; this.f.manual = true; this.renderCat(); }, Math.max(200, b.offsetWidth), () => b.removeClass('is-open'));
    };
  }

  // 상태값: 1개만 선택. 고른 칩을 다시 누르면 선택 해제
  renderStates() {
    const box = this.statesBox; box.empty();
    this.editLink.setText(this.f.editing ? '완료' : '수정');
    this.editLink.toggleClass('is-active', this.f.editing);
    const S = this.plugin.settings;
    const values = [...S.states];
    if (this.f.state && !values.includes(this.f.state)) values.push(this.f.state); // 목록 밖 값도 그대로 보여 준다
    for (const s of values) {
      const on = this.f.state === s;
      const inList = S.states.includes(s);
      const chip = box.createEl('button', { cls: `dsc-chip dsc-tone-${this.plugin.toneOf(s)}` + (on ? ' is-on' : '') + (this.f.editing ? ' is-editing' : ''), attr: { 'aria-pressed': String(on) } });
      if (on) setIcon(chip.createSpan({ cls: 'dsc-chip-check' }), 'check');
      else chip.createSpan({ cls: 'dsc-chip-dot' });
      chip.createSpan({ text: s });
      if (this.f.editing) {
        if (inList) {
          const x = chip.createSpan({ cls: 'dsc-chip-x', text: '✕', attr: { 'aria-label': `${s} 삭제` } });
          x.onclick = (e) => { e.stopPropagation(); this.removeState(s); };
        }
      } else {
        chip.onclick = () => { this.f.state = on ? null : s; this.renderStates(); };
      }
    }
    if (this.f.adding) {
      const wrap = box.createDiv({ cls: 'dsc-chip dsc-chip-input' });
      const inp = wrap.createEl('input', { attr: { type: 'text', placeholder: '새 값', 'aria-label': '새 상태값' } });
      const okb = wrap.createEl('button', { cls: 'dsc-chip-ok', attr: { 'aria-label': '추가' } }); setIcon(okb, 'check');
      const commit = () => this.addState(inp.value);
      inp.onkeydown = (e) => { if (e.key === 'Enter') { e.preventDefault(); commit(); } if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); this.f.adding = false; this.renderStates(); } };
      okb.onmousedown = (e) => { e.preventDefault(); commit(); };
      inp.onblur = () => setTimeout(() => { if (this.f.adding) { this.f.adding = false; this.renderStates(); } }, 150);
      setTimeout(() => inp.focus(), 0);
    } else {
      const add = box.createEl('button', { cls: 'dsc-chip dsc-chip-add', text: '+ 값 추가' });
      add.onclick = () => { this.f.adding = true; this.renderStates(); };
    }
  }

  removeState(s) {
    const S = this.plugin.settings;
    const n = this.plugin.getCards().filter((c) => c.state === s).length;
    const doIt = async () => { S.states = S.states.filter((x) => x !== s); if (!this.card && this.f.state === s) this.f.state = null; await this.plugin.saveSettings(); this.renderStates(); };
    if (!n) { doIt(); return; }
    new ConfirmModal(this.app, `'${s}' 값을 삭제할까요?`, `일정 ${n}개가 이 값을 쓰고 있습니다.\n목록에서만 삭제되고, 이미 만든 일정에는 그대로 표시됩니다.`, '삭제', doIt).open();
  }

  async submit() {
    const title = this.titleInput.value.trim();
    if (!title) { this.titleInput.focus(); this.titleInput.addClass('is-invalid'); new Notice('타이틀을 입력하세요'); return; }
    const data = { date: this.f.date, title, summary: this.sumInput.value.trim(), state: this.f.state, internal: this.f.internal, category: this.f.category };
    try {
      if (this.card) {
        await this.plugin.updateCard(this.card.file, data);
        new Notice('일정을 저장했습니다');
      } else {
        await this.plugin.createCard(data);
        new Notice(`일정을 만들었습니다${this.f.category ? ' · ' + this.f.category : ''}`);
      }
      this.close();
    } catch (err) {
      console.error(err);
      new Notice(`일정을 ${this.card ? '저장' : '만들'}지 못했습니다: ` + (err && err.message ? err.message : err));
    }
  }
}

/* ---------- 일정 상세 시트 (휴대폰, 바로 수정) ---------- */
class DetailSheet extends Modal {
  constructor(app, plugin, card, sections, onOpenNote) {
    super(app);
    this.plugin = plugin;
    this.card = card;
    this.onOpenNote = onOpenNote;
    this.f = {
      title: card.title, date: card.date, category: card.category, state: card.state, internal: card.internal,
      summary: sections.summary || '', detail: sections.detail || '', schedule: sections.schedule || '',
    };
    this.start = JSON.stringify(this.f);
    this.force = false;
  }
  dirty() { return JSON.stringify(this.f) !== this.start; }

  onOpen() {
    const f = this.f;
    this.modalEl.addClass('dsc-modal', 'dsc-detail');
    if (Platform.isPhone) { this.modalEl.addClass('dsc-phone'); this.containerEl.addClass('dsc-sheet'); }
    // 머리: 손잡이 + 오른쪽 위 ⋯ (아래로 끌어 내리면 닫힘)
    const top = createDiv({ cls: 'dsc-dt-top' });
    top.createDiv({ cls: 'dsc-grab' });
    const actions = top.createDiv({ cls: 'dsc-dt-actions' });
    const more = actions.createEl('button', { cls: 'dsc-dt-more', attr: { 'aria-label': '더 보기' } });
    setIcon(more, 'more-horizontal');
    more.onclick = () => popover(more, (pop, close) => {
      popItem(pop, { icon: 'external-link', label: '노트 전체 열기', onClick: () => this.leave(() => this.onOpenNote(this.card.file)) }, close);
      pop.createDiv({ cls: 'dsc-pop-sep' });
      popItem(pop, { icon: 'trash-2', label: '일정 삭제', warning: true, onClick: () => this.plugin.confirmDelete(this.card.file, () => { this.force = true; this.close(); }) }, close);
    }, { width: 200, align: 'right' });
    this.modalEl.prepend(top);

    const c = this.contentEl;
    c.empty();
    this.offFade = attachFade(c);
    this.offReveal = sheetReveal(this, 88); // 저장 버튼(52) + 여백 위로
    // 아래로 끌어 닫기: 고친 게 있으면 시트를 튕겨 돌려놓고 확인창
    this.gesture = attachSheetGesture(this, (y, springBack) => {
      if (this.dirty()) { springBack(); this.close(); return; }
      this.dragClose = true; this.close();
    });

    // 타이틀: 업무분류 색 막대 + 24 굵게, 누르면 그 자리 입력
    const tRow = c.createDiv({ cls: 'dsc-dt-title-row' });
    this.catBar = tRow.createSpan({ cls: 'dsc-dt-catbar' });
    const title = tRow.createEl('textarea', { cls: 'dsc-dt-title', attr: { rows: '1', placeholder: '타이틀', 'aria-label': '타이틀' } });
    title.value = f.title;
    title.oninput = () => { f.title = title.value.replace(/\n/g, ' '); this.grow(title); };
    title.onkeydown = (e) => { if (e.key === 'Enter') { e.preventDefault(); title.blur(); } };
    this.titleInput = title;

    const rows = c.createDiv({ cls: 'dsc-dt-rows' });
    const row = (icon, label) => { const r = rows.createDiv({ cls: 'dsc-dt-row', attr: { 'aria-label': label } }); setIcon(r.createSpan({ cls: 'dsc-dt-icon' }), icon); return r; };

    // 날짜: 글자 위에 투명한 날짜 입력칸을 덮어 누르면 날짜 고르기
    const dRow = row('calendar', '날짜');
    const dWrap = dRow.createDiv({ cls: 'dsc-dt-date' });
    const dText = dWrap.createSpan({ text: dateLabel(f.date) });
    const dInput = dWrap.createEl('input', { attr: { type: 'date', value: f.date, 'aria-label': '날짜' } });
    dInput.onchange = () => { if (toDateStr(dInput.value)) { f.date = dInput.value; dText.setText(dateLabel(f.date)); } };
    dInput.onclick = () => { try { dInput.showPicker && dInput.showPicker(); } catch (e) { /* 지원 안 하는 환경 */ } };

    // 업무분류: 알약 → 바로 아래 작은 팝업
    this.catRow = row('folder', '업무분류');
    this.renderCat();

    // 상태값: 칩 1개 선택
    this.stateBox = row('flag', '상태값').createDiv({ cls: 'dsc-chiprow' });
    this.renderStates();

    // 산출경로: 내부망 체크박스
    const lab = row('globe', '산출경로').createEl('label', { cls: 'dsc-check dsc-dt-check' });
    const box = lab.createEl('input', { attr: { type: 'checkbox' } });
    box.checked = !!f.internal;
    box.onchange = () => { f.internal = box.checked; };
    lab.createSpan({ text: '내부망' });

    // 본문 세 칸: 일반 여러 줄 입력칸
    const bodies = c.createDiv({ cls: 'dsc-dt-bodies' });
    const area = (key, icon, label, placeholder) => {
      const b = bodies.createDiv({ cls: 'dsc-dt-body' });
      setIcon(b.createSpan({ cls: 'dsc-dt-icon' }), icon);
      const col = b.createDiv({ cls: 'dsc-dt-col' });
      col.createDiv({ cls: 'dsc-dt-label', text: label });
      const ta = col.createEl('textarea', { cls: 'dsc-dt-text', attr: { rows: '1', placeholder, 'aria-label': label } });
      ta.value = f[key];
      ta.oninput = () => { f[key] = ta.value; this.grow(ta); };
      b.onclick = (e) => { if (e.target !== ta) ta.focus(); };
      return ta;
    };
    this.areas = [
      area('summary', 'align-left', '요약', '간략한 내용'),
      area('detail', 'list', DETAIL_HEADING, '- 할 일 적기'),
      area('schedule', 'clock', SCHEDULE_HEADING, '10:00 할 일 적기'),
    ];

    // 저장 ✓: 오른쪽 아래 원형 버튼 (키보드가 올라오면 시트와 함께 키보드 위로)
    const fab = this.modalEl.createEl('button', { cls: 'dsc-fab', attr: { 'aria-label': '저장' } });
    setIcon(fab, 'check');
    fab.onpointerdown = (e) => e.preventDefault(); // 누를 때 키보드가 먼저 내려가며 버튼이 움직이지 않게
    fab.onclick = () => this.save();

    setTimeout(() => { this.grow(title); this.areas.forEach((a) => this.grow(a)); }, 0);
    setTimeout(() => this.placeFab(), 400);
  }

  // 입력칸 높이를 글에 맞춘다
  grow(ta) {
    ta.setCssProps({ '--dsc-ta-h': 'auto' });
    ta.setCssProps({ '--dsc-ta-h': `${ta.scrollHeight}px` });
  }

  renderCat() {
    const r = this.catRow;
    r.querySelector('.dsc-dt-pill')?.remove();
    const cat = this.plugin.catOf(this.f.category);
    catStyle(this.catBar, cat);
    this.catBar.toggleClass('is-none', !cat);
    const pill = r.createEl('button', { cls: 'dsc-dt-pill', attr: { 'aria-haspopup': 'listbox' } });
    const dot = pill.createSpan({ cls: 'dsc-dot dsc-pill-dot' + (cat ? '' : ' is-none') }); catStyle(dot, cat);
    pill.createSpan({ cls: this.f.category ? '' : 'is-empty', text: this.f.category || '분류 없음' });
    pill.onclick = () => catPopover(this.plugin, pill, this.f.category, (name) => { this.f.category = name; this.renderCat(); });
  }

  renderStates() {
    const box = this.stateBox; box.empty();
    const values = [...this.plugin.settings.states];
    if (this.f.state && !values.includes(this.f.state)) values.push(this.f.state);
    for (const s of values) {
      const on = this.f.state === s;
      const chip = box.createEl('button', { cls: `dsc-chip dsc-tone-${this.plugin.toneOf(s)}` + (on ? ' is-on' : ''), attr: { 'aria-pressed': String(on) } });
      if (on) setIcon(chip.createSpan({ cls: 'dsc-chip-check' }), 'check');
      else chip.createSpan({ cls: 'dsc-chip-dot' });
      chip.createSpan({ text: s });
      chip.onclick = () => { this.f.state = on ? null : s; this.renderStates(); };
    }
  }

  // 저장 버튼은 실제로 보이는 화면 아래 끝에 맞춘다 (키보드가 오르내리거나 화면이 밀려도)
  placeFab() {
    const el = this.modalEl;
    if (!el.isConnected || el.style.transform || el.style.transition) return; // 열리는 중·끄는 중·튕기는 중에는 재지 않는다
    const lift = Math.round(el.getBoundingClientRect().bottom - visibleBottom());
    el.setCssProps({ '--dsc-fab-lift': `${Math.max(-400, Math.min(400, lift))}px` });
  }

  animateClose() { return this.dragClose ? slideOut(this) : super.animateClose ? super.animateClose() : Promise.resolve(); }

  // 닫은 뒤에 할 일(노트 열기 등). 고친 게 있으면 먼저 확인
  leave(after) { this.after = after; this.close(); }

  close() {
    if (this.force || !this.dirty()) { super.close(); return; }
    if (this.asking) return;
    this.asking = true;
    const m = new ConfirmModal(this.app, '저장하지 않고 닫을까요?', '고친 내용은 저장되지 않습니다.', '닫기', () => { this.force = true; this.close(); }, { warning: true, cancel: '계속 수정' });
    m.onDone = () => { this.asking = false; if (!this.force) this.after = null; };
    m.open();
  }

  onClose() {
    this.offFade && this.offFade();
    this.offReveal && this.offReveal();
    this.gesture && this.gesture.off();
    document.querySelectorAll('.dsc-pop-layer').forEach((el) => el.remove());
    this.contentEl.empty();
    const after = this.after; this.after = null;
    if (after) after();
  }

  async save() {
    const f = this.f;
    const title = f.title.trim();
    if (!title) { this.titleInput.focus(); new Notice('타이틀을 입력하세요'); return; }
    const trimEnd = (s) => (s || '').replace(/\s+$/, '');
    const data = {
      date: f.date, title, state: f.state, internal: f.internal, category: f.category,
      summary: trimEnd(f.summary),
      sections: { summary: trimEnd(f.summary), detail: trimEnd(f.detail), schedule: trimEnd(f.schedule) },
    };
    try {
      await this.plugin.updateCard(this.card.file, data);
      new Notice('일정을 저장했습니다');
      this.force = true;
      this.close();
    } catch (err) {
      console.error(err);
      new Notice('일정을 저장하지 못했습니다: ' + (err && err.message ? err.message : err));
    }
  }
}

class ConfirmModal extends Modal {
  constructor(app, title, body, cta, onOk, opts = {}) {
    super(app);
    if (typeof opts === 'boolean') opts = { warning: opts };
    this.t = title; this.b = body; this.cta = cta; this.onOk = onOk; this.warning = !!opts.warning; this.cancel = opts.cancel || '취소';
  }
  onOpen() {
    this.modalEl.addClass('dsc-confirm');
    this.titleEl.setText(this.t);
    for (const line of this.b.split('\n')) this.contentEl.createEl('p', { text: line });
    const foot = this.contentEl.createDiv({ cls: 'dsc-foot' });
    foot.createEl('button', { text: this.cancel }).onclick = () => this.close();
    const ok = foot.createEl('button', { cls: this.warning ? 'mod-warning' : 'mod-cta', text: this.cta });
    ok.onclick = async () => { await this.onOk(); this.close(); };
  }
  onClose() { this.contentEl.empty(); this.onDone && this.onDone(); }
}

/* ---------- settings ---------- */
class DscSettingTab extends PluginSettingTab {
  constructor(app, plugin) { super(app, plugin); this.plugin = plugin; this.openPicker = -1; }
  display() {
    const { containerEl: c } = this; const S = this.plugin.settings;
    c.empty(); c.addClass('dsc-settings');
    new Setting(c).setName('저장 폴더').setDesc('일정 노트를 저장할 폴더입니다.')
      .addText((t) => t.setPlaceholder(DEFAULTS.folder).setValue(S.folder).onChange(async (v) => { S.folder = v.trim() || DEFAULTS.folder; await this.plugin.saveSettings(); }));
    new Setting(c).setName('노트 속성 칸에서 선택하기').setDesc('일정 노트의 업무분류 · 상태값 칸을 누르면 목록에서 고르게 합니다. 끄면 옵시디언 기본 글자 입력칸으로 보입니다.')
      .addToggle((t) => t.setValue(!!S.propSelect).onChange(async (v) => { S.propSelect = v; await this.plugin.saveSettings(); this.plugin.updateNoteViews(); }));
    new Setting(c).setName('자동 분류').setDesc('타이틀로 업무 분류를 먼저 골라 둡니다. 같은 타이틀의 이전 일정 분류를 먼저 따르고, 없으면 아래 단어로 찾습니다.')
      .addToggle((t) => t.setValue(S.autoClassify).onChange(async (v) => { S.autoClassify = v; await this.plugin.saveSettings(); }));

    const blk = c.createDiv({ cls: 'dsc-cat-block' });
    blk.createDiv({ cls: 'setting-item-name', text: '업무 분류' });
    blk.createDiv({ cls: 'setting-item-description', text: '분류마다 카드 색과 알아볼 단어를 정합니다. 단어는 쉼표로 구분합니다.' });
    const head = blk.createDiv({ cls: 'dsc-cat-row dsc-cat-head' });
    ['색', '이름', '알아볼 단어', ''].forEach((h) => head.createSpan({ text: h }));
    S.categories.forEach((cat, idx) => {
      const row = blk.createDiv({ cls: 'dsc-cat-row' });
      const sw = row.createEl('button', { cls: 'dsc-cat-swatch' + (this.openPicker === idx ? ' is-open' : ''), attr: { 'aria-label': `${cat.name} 색` } });
      const dot = sw.createSpan({ cls: 'dsc-dot dsc-dot-lg' }); catStyle(dot, cat);
      sw.onclick = () => { this.openPicker = this.openPicker === idx ? -1 : idx; this.display(); };
      const name = row.createEl('input', { cls: 'dsc-input', attr: { type: 'text', value: cat.name, 'aria-label': '분류 이름' } });
      name.onchange = async () => { const v = name.value.trim(); if (!v) { name.value = cat.name; return; } cat.name = v; await this.plugin.saveSettings(); };
      const words = row.createEl('input', { cls: 'dsc-input', attr: { type: 'text', value: (cat.words || []).join(', '), 'aria-label': '알아볼 단어' } });
      words.onchange = async () => { cat.words = words.value.split(',').map((w) => w.trim()).filter(Boolean); await this.plugin.saveSettings(); };
      const del = row.createEl('button', { cls: 'dsc-cat-del', text: '✕', attr: { 'aria-label': `${cat.name} 삭제` } });
      del.onclick = async () => { S.categories.splice(idx, 1); this.openPicker = -1; await this.plugin.saveSettings(); this.display(); };
      if (this.openPicker === idx) this.picker(blk, cat);
    });
    const add = blk.createEl('button', { cls: 'dsc-cat-add', text: '+ 분류 추가' });
    add.onclick = async () => { S.categories.push({ name: `업무${S.categories.length + 1}`, hue: farthestHue(S.categories), sat: 1, words: [] }); this.openPicker = S.categories.length - 1; await this.plugin.saveSettings(); this.display(); };
  }

  picker(parent, cat) {
    const p = parent.createDiv({ cls: 'dsc-picker' });
    p.createDiv({ cls: 'dsc-picker-title', text: `${cat.name} 카드 색` });
    const range = p.createEl('input', { cls: 'dsc-hue', attr: { type: 'range', min: '0', max: '359', value: String(cat.hue), 'aria-label': '색상' } });
    const pv = p.createDiv({ cls: 'dsc-picker-preview' });
    const light = pv.createDiv({ cls: 'dsc-pv dsc-pv-light' }); light.createEl('strong', { text: '카드 미리보기' }); light.createSpan({ text: '밝은 테마' });
    const dark = pv.createDiv({ cls: 'dsc-pv dsc-pv-dark' }); dark.createEl('strong', { text: '카드 미리보기' }); dark.createSpan({ text: '어두운 테마' });
    const paint = () => { for (const el of [light, dark]) catStyle(el, cat); };
    paint();
    range.oninput = () => { cat.hue = Number(range.value); cat.sat = 1; paint(); };
    range.onchange = async () => { await this.plugin.saveSettings(); this.display(); };
    p.createDiv({ cls: 'dsc-picker-sub', text: '추천 색' });
    const pr = p.createDiv({ cls: 'dsc-presets' });
    for (const pre of PRESETS) {
      const b = pr.createEl('button', { cls: 'dsc-preset' + (pre.hue === cat.hue && pre.sat === (cat.sat ?? 1) ? ' is-on' : ''), attr: { 'aria-label': `추천 색 ${pre.hue}` } });
      catStyle(b, pre);
      b.onclick = async () => { cat.hue = pre.hue; cat.sat = pre.sat; await this.plugin.saveSettings(); this.display(); };
    }
  }
}

/* nosourcemap */
/* nosourcemap */