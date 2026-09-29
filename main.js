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
// 상태값 칩 색: 기본값은 고정, 사용자가 추가한 값은 안 쓴 색을 이 순서로 (보라는 진행중 전용)
const STATE_TONES = { '진행중': 'purple', '대기중': 'orange', '완료': 'green' };
const AUTO_TONES = ['red', 'blue', 'pink', 'yellow', 'cyan'];
// 노트 속성 이름·순서 (2026-09-29 확정: 한국어 이름). 옛 영어 키는 읽기만 한다
const K = { date: '날짜', category: '업무분류', state: '상태값', internal: '내부망', title: '타이틀', created: 'created' };
const CARD_KEYS = [K.date, K.category, K.state, K.internal, K.title, K.created];
const LEGACY_KEYS = ['date', 'work-category', 'state', 'title', 'states', 'network', 'summary'];
const pick = (fm, ...keys) => { for (const k of keys) if (fm[k] != null && fm[k] !== '') return fm[k]; return null; };
const SUMMARY_HEADING = '요약';
const DEFAULTS = {
  folder: 'Daily Scrum',
  autoClassify: true,
  spoqaFont: true,      // 스포카 한 산스 네오 (기기에 없으면 옵시디언 글꼴)
  propSelect: true,     // 카드 노트 속성 칸의 업무분류 · 상태값을 선택 버튼으로
  states: ['진행중', '대기중', '완료'],
  stateTones: {},
  categories: [
    { name: '프로젝트', hue: 210, sat: 1, words: ['기획', '설계', '디자인', '개발'] },
    { name: '회의', hue: 338, sat: 1, words: ['회의', '미팅', '리뷰', '공유'] },
    { name: '개인', hue: 48, sat: 0.25, words: ['회고', '정리', '공부'] },
  ],
};

/* ---------- helpers ---------- */
const netLabel = (internal) => (internal ? '내부망' : '외부망');
const byNewest = (a, b) => (b.created || '').localeCompare(a.created || '') || b.ctime - a.ctime;
const catStyle = (el, cat) => { if (cat) el.setCssProps({ '--dsc-h': String(cat.hue), '--dsc-s': String(cat.sat ?? 1) }); };
const yamlStr = (s) => JSON.stringify(String(s));
const safeName = (title) => title.replace(/[\\/:*?"<>|#^[\]]/g, ' ').replace(/\s+/g, ' ').trim() || '카드';
const escRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const hashOf = (s) => Array.from(String(s)).reduce((h, ch) => (h * 31 + ch.charCodeAt(0)) >>> 0, 7);
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
// 본문 "## 요약" 아래 내용 (다음 제목 전까지). 제목이 없으면 null → 옛 summary 속성을 읽는다
function extractSummary(text) {
  const { body } = splitNote(text || '');
  const lines = body.split(/\r?\n/);
  const i = lines.findIndex((l) => new RegExp(`^##\\s+${SUMMARY_HEADING}\\s*$`).test(l));
  if (i < 0) return null;
  const out = [];
  for (let j = i + 1; j < lines.length && !/^#{1,6}\s/.test(lines[j]); j++) {
    const l = lines[j].replace(/^\s*[-*+]\s+/, '').trim();
    if (l) out.push(l);
  }
  return out.join(' ');
}
function setSummarySection(body, summary) {
  const lines = body.split(/\r?\n/);
  const block = [`## ${SUMMARY_HEADING}`, '', ...(summary ? summary.split(/\r?\n/) : []), ''];
  const i = lines.findIndex((l) => new RegExp(`^##\\s+${SUMMARY_HEADING}\\s*$`).test(l));
  if (i >= 0) {
    let j = i + 1;
    while (j < lines.length && !/^#{1,6}\s/.test(lines[j])) j++;
    lines.splice(i, j - i, ...block);
    return lines.join('\n');
  }
  while (lines.length && lines[0].trim() === '') lines.shift();
  return ['', ...block, ...lines].join('\n');
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
      id: 'edit-current-card', name: '지금 열린 카드 수정',
      checkCallback: (checking) => {
        const f = this.app.workspace.getActiveFile();
        if (!f || !this.inFolder(f)) return false;
        if (!checking) this.editCard(f);
        return true;
      },
    });
    this.addCommand({ id: 'migrate-card-notes', name: '예전 형식 카드 노트를 새 형식으로 바꾸기', callback: () => this.migrate() });
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
    // 카드 노트: 상단 "카드 수정" 버튼 + created 줄 숨김
    const upd = () => this.updateNoteViews();
    this.registerEvent(this.app.workspace.on('layout-change', upd));
    this.registerEvent(this.app.workspace.on('file-open', upd));
    this.registerEvent(this.app.workspace.on('active-leaf-change', upd));
    this.registerEvent(this.app.workspace.on('file-menu', (menu, file) => {
      if (!(file instanceof TFile) || !this.inFolder(file)) return;
      menu.addItem((i) => i.setTitle('카드 수정').setIcon('pencil').onClick(() => this.editCard(file)));
    }));
    this.app.workspace.onLayoutReady(async () => { await this.loadSummaries(); this.refreshViews(); this.updateNoteViews(); });
  }

  onunload() {
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
    let changed = false;
    for (const s of this.settings.states) if (this.assignTone(s)) changed = true;
    if (changed) await this.saveData(this.settings);
  }
  async saveSettings() { await this.saveData(this.settings); this.refreshViews && this.refreshViews(); }

  folderPath() { return normalizePath(this.settings.folder || DEFAULTS.folder); }
  inFolder(f) { return f && f.path && f.path.startsWith(this.folderPath() + '/'); }
  catOf(name) { return name ? this.settings.categories.find((c) => c.name === name) || null : null; }

  toneOf(state) {
    return this.settings.stateTones[state] || STATE_TONES[state] || AUTO_TONES[hashOf(state) % AUTO_TONES.length];
  }
  // 새 상태값에 안 쓴 색을 붙인다. 붙였으면 true
  assignTone(state) {
    if (STATE_TONES[state] || this.settings.stateTones[state]) return false;
    const used = new Set(this.settings.states.filter((s) => s !== state).map((s) => this.toneOf(s)));
    this.settings.stateTones[state] = AUTO_TONES.find((t) => !used.has(t)) || AUTO_TONES[this.settings.states.length % AUTO_TONES.length];
    return true;
  }

  // 카드 폴더 안의 노트만 (볼트 전체 목록은 보지 않는다)
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
      `## ${SUMMARY_HEADING}`, '', ...(summary ? summary.split(/\r?\n/) : []), '', '## 상세 업무내용', '', '', '## 세부일정', '', ''];
    this.summaries.set(path, summary || '');
    const file = await this.app.vault.create(path, lines.join('\n'));
    this.refreshViews();
    return file;
  }

  // 속성을 정해진 순서로 다시 쓰고, 요약은 본문 "## 요약"에 둔다. 다른 속성·본문은 그대로
  async updateCard(file, data, { rename = true } = {}) {
    await this.app.vault.process(file, (text) => {
      const { fm, body } = splitNote(text);
      const rest = {};
      for (const [k, v] of Object.entries(fm)) if (!CARD_KEYS.includes(k) && !LEGACY_KEYS.includes(k)) rest[k] = v;
      const created = fm.created instanceof Date ? moment(fm.created).format('YYYY-MM-DDTHH:mm')
        : fm.created ? String(fm.created) : moment(file.stat.ctime).format('YYYY-MM-DDTHH:mm');
      const extra = Object.keys(rest).length ? stringifyYaml(rest).replace(/\n$/, '').split('\n') : [];
      const head = ['---', ...this.frontmatterLines({ ...data, created }), ...extra, '---'].join('\n');
      return head + '\n' + setSummarySection(body, data.summary || '');
    });
    this.summaries.set(file.path, data.summary || '');
    if (!rename) return file;
    const base = `${data.date} ${safeName(data.title)}`;
    if (file.basename === base || new RegExp(`^${escRe(base)} \\d+$`).test(file.basename)) return file;
    const dir = file.parent ? file.parent.path : this.folderPath();
    await this.app.fileManager.renameFile(file, this.uniquePath(dir, base, file.path));
    return file;
  }

  editCard(file) {
    const card = this.cardOf(file);
    if (!card) { new Notice('카드 형식이 아닌 노트입니다 (date 속성 없음)'); return; }
    new CardModal(this.app, this, { card }).open();
  }

  confirmDelete(file, after) {
    const card = this.cardOf(file);
    new ConfirmModal(this.app, '카드를 삭제할까요?', `'${card ? card.title : file.basename}' 카드 노트를 휴지통으로 옮깁니다.`, '삭제', async () => {
      if (this.app.fileManager.trashFile) await this.app.fileManager.trashFile(file);
      else await this.app.vault.trash(file, true);
      new Notice('카드를 삭제했습니다');
      after && after();
    }, true).open();
  }

  migrate() {
    const list = this.getCards().filter((c) => c.legacy);
    if (!list.length) { new Notice('바꿀 카드 노트가 없습니다'); return; }
    new ConfirmModal(this.app, `카드 노트 ${list.length}개를 새 형식으로 바꿀까요?`,
      '속성을 날짜 → 업무분류 → 상태값 → 내부망 → 타이틀 순서의 한국어 이름으로 바꾸고,\n상태값 목록은 첫 값만, network는 내부망 체크로, summary는 본문 "## 요약"으로 옮깁니다.\n상태값이 여러 개였던 카드는 첫 값만 남습니다.', '바꾸기', async () => {
        let ok = 0;
        for (const c of list) {
          try { await this.updateCard(c.file, c, { rename: false }); ok++; } catch (e) { console.error('[daily-scrum-calendar] migrate', c.file.path, e); }
        }
        new Notice(`카드 노트 ${ok}개를 바꿨습니다${ok < list.length ? ` · ${list.length - ok}개 실패 (개발자 콘솔 확인)` : ''}`);
      }).open();
  }

  updateNoteViews() {
    this.app.workspace.iterateAllLeaves((leaf) => {
      const v = leaf.view;
      if (!(v instanceof MarkdownView)) return;
      const isCard = !!(v.file && this.inFolder(v.file));
      v.containerEl.toggleClass('dsc-card-note', isCard);
      if (isCard && !v.dscAction) v.dscAction = v.addAction('pencil', '카드 수정', () => v.file && this.editCard(v.file));
      if (!isCard && v.dscAction) { v.dscAction.remove(); v.dscAction = null; }
      if (isCard && !v.dscObserver) {
        // 옵시디언이 속성 칸을 다시 그릴 때마다 선택 버튼을 다시 붙인다 (카드 노트에서만)
        let queued = false;
        v.dscObserver = new MutationObserver(() => { if (queued) return; queued = true; requestAnimationFrame(() => { queued = false; this.decorateProps(v); }); });
        v.dscObserver.observe(v.containerEl, { childList: true, subtree: true });
      }
      if (!isCard && v.dscObserver) { v.dscObserver.disconnect(); v.dscObserver = null; }
      this.decorateProps(v);
    });
  }

  // 카드 노트 속성 칸의 업무분류 · 상태값을 선택 버튼으로 (값 목록은 플러그인 설정)
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
    this.narrow = false;   // 좁음 단계 (휴대폰·사이드바): 날짜 칸에 색 점, 아래에 그날 카드 목록
    this.selected = null;  // 좁음 단계에서 고른 날짜
  }
  getViewType() { return VIEW_TYPE; }
  getDisplayText() { return '데일리 캘린더'; }
  getIcon() { return 'calendar-days'; }

  async onOpen() {
    const c = this.containerEl.children[1];
    c.empty();
    c.addClass('dsc-view');
    c.toggleClass('dsc-font-spoqa', !!this.plugin.settings.spoqaFont);
    this.root = c.createDiv({ cls: 'dsc-root' });
    this.ro = new ResizeObserver(() => this.updateSize());
    this.ro.observe(this.root);
    this.registerDomEvent(document, 'click', (e) => {
      if (this.spread && !(e.target instanceof Element && e.target.closest('.dsc-cell'))) { this.spread = null; this.render(); }
    });
    this.render();
  }
  async onClose() { this.ro && this.ro.disconnect(); }

  updateSize() {
    if (!this.root) return;
    const cellW = this.root.clientWidth / 7;
    if (!cellW) return;
    const narrow = cellW < 72; // 중간 단계 카드(67px)도 들어가지 않는 폭
    const compact = !narrow && cellW < 120;
    if (compact !== this.compact) { this.compact = compact; this.root.toggleClass('is-compact', compact); }
    if (narrow !== this.narrow) { this.narrow = narrow; this.render(); return; }
    this.fitChips();
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

    const bar = root.createDiv({ cls: 'dsc-toolbar' });
    bar.createEl('h2', { text: this.month.format('YYYY년 M월') });
    const nav = bar.createDiv({ cls: 'dsc-nav' });
    const btn = (label, aria, fn) => { const b = nav.createEl('button', { text: label, attr: { 'aria-label': aria } }); b.onclick = fn; };
    btn('‹', '이전 달', () => { this.month = this.month.clone().subtract(1, 'month'); this.spread = null; this.render(); });
    btn('오늘', '오늘', () => { this.month = moment().startOf('month'); this.spread = null; this.render(); });
    btn('›', '다음 달', () => { this.month = this.month.clone().add(1, 'month'); this.spread = null; this.render(); });

    const grid = root.createDiv({ cls: 'dsc-grid' });
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
        // 카드 1장 = 점 1개 (업무분류 색), 최대 3개 + "+N"
        if (iso === this.selected) cell.addClass('is-selected');
        const dots = cell.createDiv({ cls: 'dsc-dots' });
        for (const c of list.slice(0, 3)) { const dot = dots.createSpan({ cls: 'dsc-mdot' }); const cat = this.plugin.catOf(c.category); if (cat) { dot.addClass('has-cat'); catStyle(dot, cat); } }
        if (list.length > 3) dots.createSpan({ cls: 'dsc-mdot-more', text: '+' + (list.length - 3) });
        cell.setAttr('role', 'button');
        cell.setAttr('aria-label', `${d.format('M월 D일')} 카드 ${list.length}장`);
        cell.onclick = () => { this.selected = iso; this.render(); };
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
      if (!list.length) cell.createDiv({ cls: 'dsc-hint', text: '+ 카드 추가' });
      cell.onclick = () => {
        if (this.spread) { this.spread = null; this.render(); return; }
        new CardModal(this.app, this.plugin, { date: iso }).open();
      };
    }
    if (narrow) this.renderDayList(root, byDate.get(this.selected) || []);
    requestAnimationFrame(() => this.fitChips());
  }

  // 좁음 단계: 고른 날짜의 카드 목록 (M01 · M02)
  renderDayList(root, list) {
    const d = moment(this.selected);
    const wrap = root.createDiv({ cls: 'dsc-daylist' });
    const head = wrap.createDiv({ cls: 'dsc-daylist-head' });
    head.createSpan({ cls: 'dsc-daylist-date', text: `${d.format('M월 D일')} ${WEEKDAYS[d.day()]}요일` });
    head.createSpan({ cls: 'dsc-daylist-count', text: list.length ? `카드 ${list.length}장` : '카드 없음' });
    const add = head.createEl('button', { cls: 'dsc-daylist-add' });
    setIcon(add.createSpan({ cls: 'dsc-daylist-add-icon' }), 'plus');
    add.createSpan({ text: '카드 추가' });
    const create = () => new CardModal(this.app, this.plugin, { date: this.selected }).open();
    add.onclick = create;
    if (!list.length) {
      const em = wrap.createEl('button', { cls: 'dsc-daylist-empty' });
      em.createDiv({ text: '이 날은 카드가 없습니다' });
      em.createDiv({ cls: 'dsc-daylist-empty-cta', text: '눌러서 카드 추가' });
      em.onclick = create;
      return;
    }
    const box = wrap.createDiv({ cls: 'dsc-daylist-cards' });
    for (const c of list) box.appendChild(this.cardEl(c));
  }

  cardEl(card, onClick) {
    const cat = this.plugin.catOf(card.category);
    const el = createDiv({ cls: 'dsc-card' + (cat ? ' has-cat' : '') + (this.openPath === card.file.path ? ' is-selected' : '') });
    catStyle(el, cat);
    el.setAttr('role', 'button'); el.setAttr('tabindex', '0');
    el.setAttr('aria-label', `${card.title}${cat ? ', ' + cat.name : ''}`);
    // 칩 순서: 상태값 → 산출경로
    const chips = el.createDiv({ cls: 'dsc-chips' });
    if (card.state) chips.createSpan({ cls: `dsc-tag dsc-tone-${this.plugin.toneOf(card.state)}`, text: card.state });
    chips.createSpan({ cls: `dsc-tag dsc-tone-${card.internal ? 'gray' : 'gray-strong'}`, text: netLabel(card.internal) });
    chips.createSpan({ cls: 'dsc-more' });
    el.createDiv({ cls: 'dsc-title', text: card.title });
    if (card.summary) el.createDiv({ cls: 'dsc-summary', text: card.summary });
    const open = onClick || ((e) => { e.stopPropagation(); this.openNote(card.file); });
    let pressTimer = null, pressed = false; // 길게 누르기 (휴대폰) — 누른 뒤 따라오는 클릭은 무시
    el.onclick = (e) => { if (pressed) { e.preventDefault(); e.stopPropagation(); pressed = false; return; } open(e); };
    el.onkeydown = (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(e); } };
    const showMenu = (pos) => {
      const menu = new Menu();
      menu.addItem((i) => i.setTitle('카드 수정').setIcon('pencil').onClick(() => new CardModal(this.app, this.plugin, { card }).open()));
      menu.addItem((i) => i.setTitle('노트 열기').setIcon('file-text').onClick(() => this.openNote(card.file)));
      menu.addSeparator();
      menu.addItem((i) => { i.setTitle('카드 삭제').setIcon('trash-2').onClick(() => this.plugin.confirmDelete(card.file)); if (i.setWarning) i.setWarning(true); });
      if (pos instanceof MouseEvent) menu.showAtMouseEvent(pos); else menu.showAtPosition(pos);
    };
    const cancelPress = () => { if (pressTimer) { window.clearTimeout(pressTimer); pressTimer = null; } };
    el.oncontextmenu = (e) => {
      e.preventDefault(); e.stopPropagation();
      if (pressTimer || pressed) { cancelPress(); if (pressed) return; pressed = true; } // 휴대폰에서 길게 누르기와 겹치면 한 번만
      showMenu(e);
    };
    el.addEventListener('touchstart', (e) => {
      pressed = false; cancelPress();
      const t = e.touches[0]; const pos = { x: t.clientX, y: t.clientY };
      pressTimer = window.setTimeout(() => { pressTimer = null; pressed = true; showMenu(pos); }, 500);
    }, { passive: true });
    el.addEventListener('touchmove', cancelPress, { passive: true });
    el.addEventListener('touchend', cancelPress);
    el.addEventListener('touchcancel', cancelPress);
    return el;
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

  async openNote(file) {
    this.spread = null;
    if (Platform.isPhone) { await this.leaf.openFile(file); return; } // 휴대폰은 화면을 나눌 수 없음 → 달력 자리에서 열고 뒤로 가기로 복귀
    if (!this.noteLeaf || !this.noteLeaf.view?.containerEl?.isConnected) this.noteLeaf = this.app.workspace.createLeafBySplit(this.leaf, 'vertical');
    await this.noteLeaf.openFile(file, { active: false });
    this.openPath = file.path;
    this.render();
  }
}

/* ---------- card modal (새 카드 · 카드 수정) ---------- */
class CardModal extends Modal {
  constructor(app, plugin, { date, card } = {}) {
    super(app);
    this.plugin = plugin;
    this.card = card || null;
    const st = plugin.settings.states;
    this.f = card
      ? { date: card.date, title: card.title, summary: card.summary, category: card.category, manual: true, state: card.state, internal: card.internal }
      : { date, title: '', summary: '', category: null, manual: false, state: st.includes('진행중') ? '진행중' : null, internal: true };
    Object.assign(this.f, { editing: false, adding: false, ddOpen: false });
  }
  onOpen() {
    const edit = !!this.card;
    this.modalEl.addClass('dsc-modal');
    this.modalEl.toggleClass('dsc-font-spoqa', !!this.plugin.settings.spoqaFont);
    this.titleEl.setText(edit ? '카드 수정' : '새 카드');
    const c = this.contentEl;
    c.empty();
    const field = (label, req) => { const g = c.createDiv({ cls: 'dsc-field' }); const lr = g.createDiv({ cls: 'dsc-lrow' }); const l = lr.createSpan({ cls: 'dsc-label', text: label }); if (req) l.createSpan({ cls: 'dsc-req', text: ' *' }); return { g, lr }; };

    if (edit) {
      // 수정할 때는 날짜도 바꿀 수 있다 → 저장하면 카드가 그 날짜로 이동
      this.dateInput = field('날짜').g.createEl('input', { cls: 'dsc-input', attr: { type: 'date', value: this.f.date, 'aria-label': '날짜' } });
      this.dateInput.onchange = () => { if (toDateStr(this.dateInput.value)) this.f.date = this.dateInput.value; };
    } else {
      const d = moment(this.f.date);
      field('날짜').g.createEl('input', { cls: 'dsc-input', attr: { type: 'text', readonly: '', value: `${d.format('YYYY년 M월 D일')} (${WEEKDAYS[d.day()]})` } });
    }

    const t = field('타이틀', true).g.createDiv({ cls: 'dsc-combo' });
    this.titleInput = t.createEl('input', { cls: 'dsc-input', attr: { type: 'text', placeholder: '입력하거나 이전 타이틀 선택', id: 'dsc-title' } });
    this.titleInput.value = this.f.title;
    this.suggest = t.createDiv({ cls: 'dsc-suggest' }); this.suggest.hidden = true;
    this.titleInput.oninput = () => { this.f.title = this.titleInput.value; this.renderSuggest(); this.auto(); };
    this.titleInput.onfocus = () => this.renderSuggest();
    this.titleInput.onblur = () => setTimeout(() => { this.suggest.hidden = true; }, 120);
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

    const nf = field('산출경로').g;
    this.net = nf.createEl('button', { cls: 'dsc-net', attr: { role: 'switch', 'aria-checked': 'false', 'aria-label': '산출경로' } });
    this.netThumb = this.net.createSpan({ cls: 'dsc-net-thumb', text: '내부망' });
    this.net.onclick = () => { this.f.internal = !this.f.internal; this.renderNet(); };
    this.renderNet();

    // 휴대폰(바텀시트): 아래 버튼은 만들기·저장 하나, 취소는 위쪽 ✕ (와이어 M03)
    const phone = Platform.isPhone;
    this.modalEl.toggleClass('dsc-phone', phone);
    const foot = c.createDiv({ cls: 'dsc-foot' + (phone ? ' is-phone' : '') });
    const del = () => this.plugin.confirmDelete(this.card.file, () => this.close());
    if (edit && !phone) foot.createEl('button', { cls: 'dsc-del', text: '삭제' }).onclick = del;
    if (!phone) foot.createEl('button', { text: '취소' }).onclick = () => this.close();
    const ok = foot.createEl('button', { cls: 'mod-cta', text: edit ? '저장' : '만들기' });
    ok.onclick = () => this.submit();
    if (edit && phone) c.createEl('button', { cls: 'dsc-del-link', text: '카드 삭제' }).onclick = del;

    this.scope.register([], 'Escape', () => { if (this.f.ddOpen) { this.f.ddOpen = false; this.renderCat(); return false; } this.close(); return false; });
    this.modalEl.addEventListener('click', (e) => { if (this.f.ddOpen && !(e.target instanceof Element && e.target.closest('.dsc-dd'))) { this.f.ddOpen = false; this.renderCat(); } });
    if (!edit) setTimeout(() => this.titleInput.focus(), 0);
  }
  onClose() { this.contentEl.empty(); }

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
      b.createSpan({ cls: 'dsc-suggest-meta', text: `최근 ${dm.format('M/D')} · ${h.n}장` });
      b.onmousedown = (e) => { e.preventDefault(); this.titleInput.value = h.title; this.f.title = h.title; box.hidden = true; this.auto(); };
    }
    if (v && !seen.has(v)) {
      const b = box.createEl('button', { cls: 'dsc-suggest-item dsc-suggest-new', text: `+ "${v}" 새 타이틀로 입력` });
      b.onmousedown = (e) => { e.preventDefault(); box.hidden = true; };
    }
    box.hidden = false;
  }

  renderCat() {
    const box = this.catBox; box.empty();
    const cat = this.plugin.catOf(this.f.category);
    const b = box.createEl('button', { cls: 'dsc-dd-btn' + (this.f.ddOpen ? ' is-open' : ''), attr: { 'aria-haspopup': 'listbox', 'aria-expanded': String(this.f.ddOpen) } });
    if (cat) { const dot = b.createSpan({ cls: 'dsc-dot' }); catStyle(dot, cat); b.createSpan({ cls: 'dsc-dd-label', text: cat.name }); }
    else if (this.f.category) { b.createSpan({ cls: 'dsc-dot is-none' }); b.createSpan({ cls: 'dsc-dd-label', text: this.f.category }); }
    else b.createSpan({ cls: 'dsc-dd-label is-empty', text: '분류 선택' });
    setIcon(b.createSpan({ cls: 'dsc-dd-chev' }), this.f.ddOpen ? 'chevron-up' : 'chevron-down');
    b.onclick = (e) => { e.stopPropagation(); this.f.ddOpen = !this.f.ddOpen; this.renderCat(); };
    if (!this.f.ddOpen) return;
    const menu = box.createDiv({ cls: 'dsc-dd-menu', attr: { role: 'listbox' } });
    const opt = (c) => {
      const on = (c ? c.name : null) === this.f.category;
      const o = menu.createEl('button', { cls: 'dsc-dd-opt', attr: { role: 'option', 'aria-selected': String(on) } });
      const dot = o.createSpan({ cls: 'dsc-dot' + (c ? '' : ' is-none') }); catStyle(dot, c);
      o.createSpan({ cls: 'dsc-dd-opt-label' + (c ? '' : ' is-empty'), text: c ? c.name : '분류 없음' });
      if (on) o.createSpan({ cls: 'dsc-dd-check', text: '✓' });
      o.onclick = (e) => { e.stopPropagation(); this.f.category = c ? c.name : null; this.f.manual = true; this.f.ddOpen = false; this.renderCat(); };
    };
    opt(null);
    for (const c of this.plugin.settings.categories) opt(c);
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
      const commit = async () => {
        const v = inp.value.trim();
        if (v) {
          if (!S.states.includes(v)) { this.plugin.assignTone(v); S.states.push(v); await this.plugin.saveSettings(); }
          this.f.state = v;
        }
        this.f.adding = false; this.renderStates();
      };
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
    new ConfirmModal(this.app, `'${s}' 값을 삭제할까요?`, `카드 ${n}장이 이 값을 쓰고 있습니다.\n목록에서만 삭제되고, 이미 만든 카드에는 그대로 표시됩니다.`, '삭제', doIt).open();
  }

  renderNet() {
    this.net.setAttr('aria-checked', String(!this.f.internal));
    this.netThumb.setText(netLabel(this.f.internal));
  }

  async submit() {
    const title = this.titleInput.value.trim();
    if (!title) { this.titleInput.focus(); this.titleInput.addClass('is-invalid'); new Notice('타이틀을 입력하세요'); return; }
    const data = { date: this.f.date, title, summary: this.sumInput.value.trim(), state: this.f.state, internal: this.f.internal, category: this.f.category };
    try {
      if (this.card) {
        await this.plugin.updateCard(this.card.file, data);
        new Notice('카드를 저장했습니다');
      } else {
        await this.plugin.createCard(data);
        new Notice(`카드를 만들었습니다${this.f.category ? ' · ' + this.f.category : ''}`);
      }
      this.close();
    } catch (err) {
      console.error(err);
      new Notice(`카드를 ${this.card ? '저장' : '만들'}지 못했습니다: ` + (err && err.message ? err.message : err));
    }
  }
}

class ConfirmModal extends Modal {
  constructor(app, title, body, cta, onOk, warning) { super(app); this.t = title; this.b = body; this.cta = cta; this.onOk = onOk; this.warning = !!warning; }
  onOpen() {
    this.modalEl.addClass('dsc-confirm');
    this.titleEl.setText(this.t);
    for (const line of this.b.split('\n')) this.contentEl.createEl('p', { text: line });
    const foot = this.contentEl.createDiv({ cls: 'dsc-foot' });
    foot.createEl('button', { text: '취소' }).onclick = () => this.close();
    const ok = foot.createEl('button', { cls: this.warning ? 'mod-warning' : 'mod-cta', text: this.cta });
    ok.onclick = async () => { await this.onOk(); this.close(); };
  }
  onClose() { this.contentEl.empty(); }
}

/* ---------- settings ---------- */
class DscSettingTab extends PluginSettingTab {
  constructor(app, plugin) { super(app, plugin); this.plugin = plugin; this.openPicker = -1; }
  display() {
    const { containerEl: c } = this; const S = this.plugin.settings;
    c.empty(); c.addClass('dsc-settings');
    new Setting(c).setName('저장 폴더').setDesc('카드 노트를 저장할 폴더입니다.')
      .addText((t) => t.setPlaceholder(DEFAULTS.folder).setValue(S.folder).onChange(async (v) => { S.folder = v.trim() || DEFAULTS.folder; await this.plugin.saveSettings(); }));
    new Setting(c).setName('스포카 한 산스 네오 글꼴').setDesc('캘린더와 카드 창에 스포카 한 산스 네오를 씁니다. 기기에 설치되어 있지 않으면 옵시디언 글꼴로 보입니다.')
      .addToggle((t) => t.setValue(!!S.spoqaFont).onChange(async (v) => {
        S.spoqaFont = v; await this.plugin.saveSettings();
        for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE)) leaf.view.containerEl.children[1].toggleClass('dsc-font-spoqa', v);
      }));
    new Setting(c).setName('노트 속성 칸에서 선택하기').setDesc('카드 노트의 업무분류 · 상태값 칸을 누르면 목록에서 고르게 합니다. 끄면 옵시디언 기본 글자 입력칸으로 보입니다.')
      .addToggle((t) => t.setValue(!!S.propSelect).onChange(async (v) => { S.propSelect = v; await this.plugin.saveSettings(); this.plugin.updateNoteViews(); }));
    new Setting(c).setName('자동 분류').setDesc('타이틀로 업무 분류를 먼저 골라 둡니다. 같은 타이틀의 이전 카드 분류를 먼저 따르고, 없으면 아래 단어로 찾습니다.')
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
    add.onclick = async () => { S.categories.push({ name: `분류 ${S.categories.length + 1}`, hue: farthestHue(S.categories), sat: 1, words: [] }); this.openPicker = S.categories.length - 1; await this.plugin.saveSettings(); this.display(); };
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
