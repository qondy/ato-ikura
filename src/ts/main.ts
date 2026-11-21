import { User } from 'firebase/auth';
import { onAuthChange, loginWithGoogle, logout } from './auth';
import { showToast, openOverlay, closeOverlay, textEl } from './ui';
import { submitFeedback } from './feedback';
import {
  subscribeSettings, subscribeExpenses, subscribePeriods, saveSettings,
  createExpense, updateExpense, deleteExpense, savePeriod, MAX_AMOUNT, ExpenseInput,
} from './store';
import {
  summarize, currentPeriod, todayInfo, expensesIn, byCategory, withinStreak, piggyBalance, allowanceFor, yen,
} from './calc';
import {
  todayKey, periodLabel, rangeLabel, shiftPeriod, dayLabel, shortDate, periodOfDate,
} from './dates';
import {
  CATEGORIES, categoryLabel, SURVEY_ITEMS, SURVEY_SOURCE, SURVEY_2024, PAYDAY_OPTIONS,
} from './data';
import { Expense, PeriodDoc, PeriodSummary, Settings } from './types';
import { initClickTracking, track } from './analytics';
import { initTextareas } from './memo-ui';

initClickTracking();

// ============================================================
// DOM
// ============================================================
const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;

const loginScreen = $('login-screen');
const appEl = $('app');
const userInfo = $('user-info');
const userAvatar = $<HTMLImageElement>('user-avatar');
const userName = $('user-name');
const btnGoogleLogin = $<HTMLButtonElement>('btn-google-login');

const loadingEl = $('loading');
const setupCard = $('setup-card');
const tabsBar = document.querySelector<HTMLElement>('.tabs-bar')!;
const tabButtons = Array.from(document.querySelectorAll<HTMLButtonElement>('.tabs__btn'));
const panels = Array.from(document.querySelectorAll<HTMLElement>('.panel'));
const btnFab = $<HTMLButtonElement>('btn-fab');

const quickForm = $<HTMLFormElement>('quick-form');
const quickAmount = $<HTMLInputElement>('quick-amount');
const quickMemo = $<HTMLInputElement>('quick-memo');
const quickDate = $<HTMLInputElement>('quick-date');
const btnQuickSubmit = $<HTMLButtonElement>('btn-quick-submit');

const settingsOverlay = $('settings-modal-overlay');
const settingsForm = $<HTMLFormElement>('settings-form');
const inputAllowance = $<HTMLInputElement>('input-allowance');
const inputPayday = $<HTMLSelectElement>('input-payday');
const inputCarryPlus = $<HTMLInputElement>('input-carry-plus');
const inputCarryMinus = $<HTMLInputElement>('input-carry-minus');
const btnSettingsSubmit = $<HTMLButtonElement>('btn-settings-submit');

const expenseOverlay = $('expense-modal-overlay');
const expenseForm = $<HTMLFormElement>('expense-form');
const inputAmount = $<HTMLInputElement>('input-amount');
const inputDate = $<HTMLInputElement>('input-date');
const inputMemo = $<HTMLInputElement>('input-memo');
const btnExpenseDelete = $<HTMLButtonElement>('btn-expense-delete');
const btnExpenseSubmit = $<HTMLButtonElement>('btn-expense-submit');

const piggyOverlay = $('piggy-modal-overlay');
const piggyForm = $<HTMLFormElement>('piggy-form');
const inputPiggy = $<HTMLInputElement>('input-piggy');
const btnPiggySubmit = $<HTMLButtonElement>('btn-piggy-submit');

const confirmOverlay = $('confirm-dialog-overlay');
const btnConfirmOk = $<HTMLButtonElement>('btn-confirm-ok');

const feedbackOverlay = $('feedback-modal-overlay');
const inputFeedbackMessage = $<HTMLTextAreaElement>('input-feedback-message');
const btnFeedbackSend = $<HTMLButtonElement>('btn-feedback-send');

// ============================================================
// State
// ============================================================
type View = 'home' | 'log' | 'rank' | 'history';

const state = {
  uid: null as string | null,
  settings: null as Settings | null,
  expenses: [] as Expense[],
  periods: [] as PeriodDoc[],
  loaded: { settings: false, expenses: false, periods: false },
  view: 'home' as View,
  logPeriod: '' as string,
  quickCat: 'lunch',
  expenseCat: 'lunch',
  expenseEditingId: null as string | null,
  piggyMode: 'in' as 'in' | 'out',
  pending: new Set<string>(),
  confirmAction: null as null | (() => Promise<void>),
  unsubscribers: [] as (() => void)[],
};

const isLoaded = (): boolean => state.loaded.settings && state.loaded.expenses && state.loaded.periods;

// ============================================================
// Helpers
// ============================================================
/** 二重送信を防ぎつつ、失敗時はトーストで知らせる */
async function run(key: string, task: () => Promise<void>, errorMessage: string): Promise<boolean> {
  if (state.pending.has(key)) return false;
  state.pending.add(key);
  renderAll();
  try {
    await task();
    return true;
  } catch (err) {
    console.error(err);
    showToast(errorMessage);
    return false;
  } finally {
    state.pending.delete(key);
    renderAll();
  }
}

function askConfirm(title: string, text: string, okLabel: string, action: () => Promise<void>): void {
  $('confirm-dialog-title').textContent = title;
  $('confirm-dialog-text').textContent = text;
  btnConfirmOk.textContent = okLabel;
  state.confirmAction = action;
  openOverlay(confirmOverlay);
}

/** 「1,200」「１２００」「1200円」などを整数に。読めなければ NaN */
function parseAmount(raw: string): number {
  const half = raw.replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0));
  const digits = half.replace(/[,，円\s]/g, '');
  if (!/^\d+$/.test(digits)) return NaN;
  return Number(digits);
}

function formatAmountInput(el: HTMLInputElement): void {
  const n = parseAmount(el.value);
  if (Number.isFinite(n) && el.value !== '') el.value = n.toLocaleString('ja-JP');
}

function allSummaries(): PeriodSummary[] {
  const s = state.settings;
  if (!s) return [];
  const cur = currentPeriod(s);
  // 先の日付で記録した支出があれば、その期間まで計算しておく
  let until = cur;
  for (const e of state.expenses) {
    const k = periodOfDate(e.date, s.payday);
    if (k > until) until = k;
  }
  return summarize(s, state.expenses, state.periods, until);
}

function summaryOf(list: PeriodSummary[], key: string): PeriodSummary | null {
  return list.find((p) => p.key === key) ?? null;
}

function periodDocOf(key: string): PeriodDoc {
  return state.periods.find((p) => p.key === key) ?? { key, piggyIn: 0, piggyOut: 0 };
}

function renderChips(box: HTMLElement, selected: string, onPick: (key: string) => void): void {
  box.replaceChildren();
  for (const c of CATEGORIES) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = `chip${c.key === selected ? ' is-active' : ''}`;
    b.textContent = c.label;
    b.setAttribute('role', 'radio');
    b.setAttribute('aria-checked', String(c.key === selected));
    b.addEventListener('click', () => onPick(c.key));
    box.appendChild(b);
  }
}

function expenseRow(e: Expense): HTMLElement {
  const row = document.createElement('button');
  row.type = 'button';
  row.className = 'expense-row';
  const main = document.createElement('div');
  main.className = 'expense-row__main';
  main.appendChild(textEl('span', 'expense-row__cat', categoryLabel(e.category)));
  if (e.memo) main.appendChild(textEl('span', 'expense-row__memo', e.memo));
  row.appendChild(textEl('span', 'expense-row__date', shortDate(e.date)));
  row.appendChild(main);
  row.appendChild(textEl('span', 'expense-row__amount', yen(e.amount)));
  row.setAttribute('aria-label', `${dayLabel(e.date)} ${categoryLabel(e.category)} ${yen(e.amount)}を編集`);
  row.addEventListener('click', () => openExpenseModal(e));
  return row;
}

function emptyState(text: string): HTMLElement {
  const box = document.createElement('div');
  box.className = 'empty-state';
  box.appendChild(textEl('p', '', text));
  return box;
}

// ============================================================
// Render
// ============================================================
function renderAll(): void {
  const ready = isLoaded();
  loadingEl.classList.toggle('hidden', ready);
  const hasSettings = ready && !!state.settings;
  setupCard.classList.toggle('hidden', !ready || hasSettings);
  tabsBar.classList.toggle('hidden', !hasSettings);
  panels.forEach((p) => p.classList.toggle('hidden', !hasSettings || p.dataset.panel !== state.view));
  tabButtons.forEach((b) => {
    const on = b.dataset.tab === state.view;
    b.classList.toggle('is-active', on);
    b.setAttribute('aria-selected', String(on));
  });
  btnFab.classList.toggle('hidden', !hasSettings || state.view === 'home');
  if (!hasSettings) return;

  const list = allSummaries();
  if (state.view === 'home') renderHome(list);
  if (state.view === 'log') renderLog(list);
  if (state.view === 'rank') renderRank(list);
  if (state.view === 'history') renderHistory(list);

  btnQuickSubmit.disabled = state.pending.has('quick');
  btnExpenseSubmit.disabled = state.pending.has('expense');
  btnExpenseDelete.disabled = state.pending.has('expense');
  btnSettingsSubmit.disabled = state.pending.has('settings');
  btnPiggySubmit.disabled = state.pending.has('piggy');
}

function renderHome(list: PeriodSummary[]): void {
  const s = state.settings!;
  const cur = currentPeriod(s);
  const sum = summaryOf(list, cur);
  if (!sum) return;
  const info = todayInfo(sum);

  $('remain-period').textContent = `${periodLabel(cur, s.payday)}（${rangeLabel(cur, s.payday)}）`;
  const over = sum.remain < 0;
  $('remain-label').textContent = over ? '使いすぎ' : 'あと';
  $('remain-amount').textContent = yen(Math.abs(sum.remain));
  const card = $('remain-card');
  card.classList.toggle('is-caution', info.pace === 'caution');
  card.classList.toggle('is-over', info.pace === 'over');

  const ratio = sum.available > 0 ? Math.min(1, Math.max(0, sum.remain / sum.available)) : 0;
  $('remain-meter').style.width = `${Math.round(ratio * 100)}%`;
  $('remain-days').textContent = `残り${info.daysLeft}日`;
  $('remain-perday').textContent = over ? '' : `1日あたり ${yen(info.perDay)}`;
  const paceText = {
    good: 'いいペースです。この調子でいきましょう',
    caution: 'ちょっと早めのペース。少しだけ控えめに',
    over: s.carryMinus ? 'オーバーした分は、翌月のお小遣いから差し引かれます' : '今月はオーバー。翌月は仕切り直しです',
  }[info.pace];
  $('remain-pace').textContent = paceText;

  const dl = $('remain-breakdown');
  dl.replaceChildren();
  const add = (label: string, value: string): void => {
    const wrap = document.createElement('div');
    wrap.appendChild(textEl('dt', '', label));
    wrap.appendChild(textEl('dd', '', value));
    dl.appendChild(wrap);
  };
  add('お小遣い', yen(sum.allowance));
  if (sum.carryIn !== 0) add(sum.carryIn > 0 ? '先月からの繰越' : '先月の使いすぎ', `${sum.carryIn > 0 ? '+' : ''}${yen(sum.carryIn)}`);
  if (sum.piggyOut) add('貯金箱から', `+${yen(sum.piggyOut)}`);
  if (sum.piggyIn) add('貯金箱へ', `-${yen(sum.piggyIn)}`);
  add('使った', yen(sum.spent));

  renderChips($('quick-cats'), state.quickCat, (k) => { state.quickCat = k; renderAll(); });
  if (!quickDate.value) quickDate.value = todayKey();

  const recentBox = $('recent-list');
  recentBox.replaceChildren();
  const recent = expensesIn(state.expenses, sum.start, sum.end).slice(0, 5);
  if (!recent.length) recentBox.appendChild(emptyState('まだ記録がありません。\n使ったら上のフォームから記録しましょう'));
  recent.forEach((e) => recentBox.appendChild(expenseRow(e)));

  $('piggy-amount').textContent = yen(piggyBalance(state.periods));
}

function renderCatBars(box: HTMLElement, items: Expense[]): void {
  box.replaceChildren();
  const cats = byCategory(items);
  const total = cats.reduce((a, c) => a + c.amount, 0);
  if (!cats.length) { box.appendChild(emptyState('この月の記録はまだありません')); return; }
  const max = cats[0].amount;
  for (const c of cats) {
    const row = document.createElement('div');
    row.className = 'cat-bar';
    const head = document.createElement('div');
    head.className = 'cat-bar__head';
    head.appendChild(textEl('span', 'cat-bar__label', categoryLabel(c.key)));
    head.appendChild(textEl('span', 'cat-bar__value', `${yen(c.amount)}（${Math.round((c.amount / total) * 100)}%）`));
    const track = document.createElement('div');
    track.className = 'cat-bar__track';
    const fill = document.createElement('div');
    fill.className = 'cat-bar__fill';
    fill.style.width = `${Math.max(3, Math.round((c.amount / max) * 100))}%`;
    track.appendChild(fill);
    row.append(head, track);
    box.appendChild(row);
  }
}

function renderLog(list: PeriodSummary[]): void {
  const s = state.settings!;
  const cur = currentPeriod(s);
  if (!state.logPeriod) state.logPeriod = cur;
  const key = state.logPeriod;
  $('log-title').textContent = periodLabel(key, s.payday);
  $('log-range').textContent = rangeLabel(key, s.payday);
  const last = list.length ? list[list.length - 1].key : cur;
  $<HTMLButtonElement>('btn-next-period').disabled = key >= last;
  $<HTMLButtonElement>('btn-prev-period').disabled = !!list.length && key <= list[0].key;

  const sum = summaryOf(list, key);
  const summaryBox = $('log-summary');
  summaryBox.replaceChildren();
  const cell = (label: string, value: string, cls = ''): void => {
    const c = document.createElement('div');
    c.className = `summary-cell ${cls}`;
    c.appendChild(textEl('div', 'summary-cell__value', value));
    c.appendChild(textEl('div', 'summary-cell__label', label));
    summaryBox.appendChild(c);
  };
  if (sum) {
    cell('使える額', yen(sum.available));
    cell('使った', yen(sum.spent));
    cell(sum.remain < 0 ? '使いすぎ' : '残り', yen(Math.abs(sum.remain)), sum.remain < 0 ? 'is-over' : '');
  }

  const items = sum ? expensesIn(state.expenses, sum.start, sum.end) : [];
  renderCatBars($('log-cats'), items);
  $('log-count').textContent = `${items.length}件`;
  const listBox = $('log-list');
  listBox.replaceChildren();
  if (!items.length) listBox.appendChild(emptyState('この月の支出はまだありません'));
  items.forEach((e) => listBox.appendChild(expenseRow(e)));
}

function renderRank(list: PeriodSummary[]): void {
  const s = state.settings!;
  const cur = currentPeriod(s);
  const sum = summaryOf(list, cur);

  const surveyBox = $('survey-list');
  surveyBox.replaceChildren();
  const maxP = SURVEY_ITEMS[0].percent;
  SURVEY_ITEMS.forEach((it, i) => {
    const li = document.createElement('li');
    li.className = 'rank-item';
    li.appendChild(textEl('span', `rank-item__no${i < 3 ? ' is-top' : ''}`, String(i + 1)));
    const body = document.createElement('div');
    body.className = 'rank-item__body';
    const head = document.createElement('div');
    head.className = 'rank-item__head';
    head.appendChild(textEl('span', 'rank-item__label', it.label));
    head.appendChild(textEl('span', 'rank-item__value', `${it.percent}%`));
    const track = document.createElement('div');
    track.className = 'cat-bar__track';
    const fill = document.createElement('div');
    fill.className = 'cat-bar__fill';
    fill.style.width = `${Math.round((it.percent / maxP) * 100)}%`;
    track.appendChild(fill);
    body.append(head, track, textEl('span', 'rank-item__sub', `毎月の必要額 平均${yen(it.need)}`));
    li.appendChild(body);
    surveyBox.appendChild(li);
  });
  $('survey-source').textContent = `出典：${SURVEY_SOURCE}`;

  const items = sum ? expensesIn(state.expenses, sum.start, sum.end) : [];
  const mine = byCategory(items);
  $('my-rank-desc').textContent = `${periodLabel(cur, s.payday)}に多く使ったものの順です`;
  const myBox = $('my-rank-list');
  myBox.replaceChildren();
  if (!mine.length) {
    myBox.appendChild(emptyState('今月の記録がたまると、ここにあなたのランキングが出ます'));
  } else {
    const total = mine.reduce((a, c) => a + c.amount, 0);
    mine.slice(0, 10).forEach((c, i) => {
      const li = document.createElement('li');
      li.className = 'rank-item';
      li.appendChild(textEl('span', `rank-item__no${i < 3 ? ' is-top' : ''}`, String(i + 1)));
      const body = document.createElement('div');
      body.className = 'rank-item__body';
      const head = document.createElement('div');
      head.className = 'rank-item__head';
      head.appendChild(textEl('span', 'rank-item__label', categoryLabel(c.key)));
      head.appendChild(textEl('span', 'rank-item__value', yen(c.amount)));
      const surveyRank = SURVEY_ITEMS.findIndex((it) => it.key === c.key);
      const sub = surveyRank >= 0 ? `全体の${Math.round((c.amount / total) * 100)}%・みんなのランキングでは${surveyRank + 1}位`
        : `全体の${Math.round((c.amount / total) * 100)}%`;
      body.append(head, textEl('span', 'rank-item__sub', sub));
      li.appendChild(body);
      myBox.appendChild(li);
    });
  }

  const compareBox = $('compare-list');
  compareBox.replaceChildren();
  const spentBy = new Map(mine.map((c) => [c.key, c.amount]));
  SURVEY_ITEMS.forEach((it) => {
    const spent = spentBy.get(it.key) ?? 0;
    const row = document.createElement('div');
    row.className = 'compare-row';
    row.appendChild(textEl('span', 'compare-row__label', categoryLabel(it.key)));
    row.appendChild(textEl('span', 'compare-row__mine', yen(spent)));
    const diff = spent - it.need;
    const tag = spent === 0 ? 'まだ0円' : diff > 0 ? `みんなより${yen(diff)}多い` : diff < 0 ? `みんなより${yen(-diff)}少ない` : 'みんなと同じくらい';
    row.appendChild(textEl('span', `compare-row__diff${diff > 0 && spent ? ' is-more' : ''}`, tag));
    compareBox.appendChild(row);
  });

  const avgBox = $('avg-box');
  avgBox.replaceChildren();
  const myAllowance = allowanceFor(s, cur);
  const diffA = myAllowance - SURVEY_2024.allowance;
  avgBox.appendChild(textEl('p', 'avg-box__line', `男性会社員のお小遣いの平均は ${yen(SURVEY_2024.allowance)}/月。あなたは ${yen(myAllowance)}（${diffA >= 0 ? '+' : ''}${yen(diffA)}）。`));
  avgBox.appendChild(textEl('p', 'avg-box__line', `昼食代の平均は1日 ${yen(SURVEY_2024.lunch)}、外での飲み代は1か月 ${yen(SURVEY_2024.drinkMonth)}。`));
  avgBox.appendChild(textEl('p', 'source-note', `出典：${SURVEY_2024.source}`));
}

function renderHistory(list: PeriodSummary[]): void {
  const s = state.settings!;
  const cur = currentPeriod(s);
  const done = list.filter((p) => p.key < cur);
  $('stat-streak').textContent = String(withinStreak(list, cur));
  $('stat-within').textContent = `${done.filter((p) => p.remain >= 0).length}/${done.length}`;
  $('stat-piggy').textContent = yen(piggyBalance(state.periods));

  const box = $('history-list');
  box.replaceChildren();
  const rows = list.filter((p) => p.key <= cur).slice().reverse();
  for (const p of rows) {
    const card = document.createElement('button');
    card.type = 'button';
    card.className = `history-card${p.remain < 0 ? ' is-over' : ''}`;
    const head = document.createElement('div');
    head.className = 'history-card__head';
    head.appendChild(textEl('span', 'history-card__title', `${periodLabel(p.key, s.payday)}${p.key === cur ? '（今月）' : ''}`));
    const status = p.key === cur ? `あと${yen(Math.max(0, p.remain))}` : p.remain >= 0 ? `${yen(p.remain)} 残せた` : `${yen(-p.remain)} オーバー`;
    head.appendChild(textEl('span', `history-card__status${p.remain < 0 ? ' is-over' : ''}`, p.remain < 0 && p.key === cur ? `${yen(-p.remain)} オーバー` : status));
    const meta = document.createElement('div');
    meta.className = 'history-card__meta';
    const parts = [`お小遣い ${yen(p.allowance)}`];
    if (p.carryIn) parts.push(`繰越 ${p.carryIn > 0 ? '+' : ''}${yen(p.carryIn)}`);
    if (p.piggyIn) parts.push(`貯金箱へ ${yen(p.piggyIn)}`);
    if (p.piggyOut) parts.push(`貯金箱から ${yen(p.piggyOut)}`);
    parts.push(`使った ${yen(p.spent)}`);
    meta.textContent = parts.join('・');
    const items = expensesIn(state.expenses, p.start, p.end);
    const top = byCategory(items)[0];
    card.append(head, meta);
    if (top) card.appendChild(textEl('div', 'history-card__top', `いちばん使ったのは「${categoryLabel(top.key)}」${yen(top.amount)}`));
    card.setAttribute('aria-label', `${periodLabel(p.key, s.payday)}のきろくを見る`);
    card.addEventListener('click', () => { state.logPeriod = p.key; setView('log'); });
    box.appendChild(card);
  }
  $('history-desc').textContent = s.carryPlus || s.carryMinus
    ? `お小遣い・繰越・使った額・残りを月ごとに表示します（${[s.carryPlus ? '残りは繰越' : '', s.carryMinus ? '使いすぎは翌月から差し引き' : ''].filter(Boolean).join('・')}）`
    : 'お小遣い・使った額・残りを月ごとに表示します（繰越なし）';
}

function setView(v: View): void {
  state.view = v;
  if (v !== 'log' && state.settings) state.logPeriod = state.logPeriod || currentPeriod(state.settings);
  renderAll();
  window.scrollTo({ top: 0 });
}

// ============================================================
// Settings
// ============================================================
function openSettings(): void {
  const s = state.settings;
  inputPayday.replaceChildren();
  for (const d of PAYDAY_OPTIONS) {
    const o = document.createElement('option');
    o.value = String(d);
    o.textContent = d === 1 ? '毎月1日（月初）' : `毎月${d}日`;
    inputPayday.appendChild(o);
  }
  if (s) {
    const cur = currentPeriod(s);
    inputAllowance.value = allowanceFor(s, cur).toLocaleString('ja-JP');
    inputPayday.value = String(s.payday);
    inputCarryPlus.checked = s.carryPlus;
    inputCarryMinus.checked = s.carryMinus;
    $('allowance-note').textContent = '金額を変えると、今月の分から新しい額になります（前の月はそのまま）';
  } else {
    inputAllowance.value = '';
    inputPayday.value = '1';
    inputCarryPlus.checked = true;
    inputCarryMinus.checked = true;
    $('allowance-note').textContent = `参考：男性会社員の平均は月${yen(SURVEY_2024.allowance)}です`;
  }
  openOverlay(settingsOverlay);
  inputAllowance.focus();
}

settingsForm.addEventListener('submit', (e) => {
  e.preventDefault();
  const uid = state.uid;
  if (!uid) return;
  const amount = parseAmount(inputAllowance.value);
  if (!Number.isFinite(amount) || amount <= 0 || amount > MAX_AMOUNT) {
    showToast('お小遣いの額を数字で入れてください');
    inputAllowance.focus();
    return;
  }
  const payday = Number(inputPayday.value) || 1;
  const prev = state.settings;
  const cur = periodOfDate(todayKey(), payday);
  let allowances = prev ? prev.allowances.filter((a) => a.from < cur) : [];
  allowances = [...allowances, { from: cur, amount }];
  const next: Settings = {
    allowances,
    payday,
    startPeriod: prev ? (prev.startPeriod < cur ? prev.startPeriod : cur) : cur,
    carryPlus: inputCarryPlus.checked,
    carryMinus: inputCarryMinus.checked,
  };
  const isFirst = !prev;
  void run('settings', async () => {
    await saveSettings(uid, next);
    closeOverlay(settingsOverlay);
    track(isFirst ? 'settings_create' : 'settings_update');
    showToast(isFirst ? '設定しました。使ったら記録していきましょう' : '設定を保存しました');
  }, '保存できませんでした。通信状況を確認してください');
});

$('btn-setup').addEventListener('click', openSettings);
$('btn-settings').addEventListener('click', openSettings);
$('btn-settings-close').addEventListener('click', () => closeOverlay(settingsOverlay));
$('btn-settings-cancel').addEventListener('click', () => closeOverlay(settingsOverlay));
inputAllowance.addEventListener('blur', () => formatAmountInput(inputAllowance));

// ============================================================
// Expenses
// ============================================================
function validate(amountRaw: string, date: string): number | null {
  const amount = parseAmount(amountRaw);
  if (!Number.isFinite(amount) || amount <= 0) { showToast('金額を数字で入れてください'); return null; }
  if (amount > MAX_AMOUNT) { showToast('金額が大きすぎます'); return null; }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) { showToast('使った日を選んでください'); return null; }
  return amount;
}

quickForm.addEventListener('submit', (e) => {
  e.preventDefault();
  const uid = state.uid;
  if (!uid) return;
  const date = quickDate.value || todayKey();
  const amount = validate(quickAmount.value, date);
  if (amount === null) { quickAmount.focus(); return; }
  const input: ExpenseInput = { date, amount, category: state.quickCat, memo: quickMemo.value };
  void run('quick', async () => {
    await createExpense(uid, input);
    quickAmount.value = '';
    quickMemo.value = '';
    quickDate.value = todayKey();
    track('expense_create', { category: input.category, from: 'quick' });
    showToast(`${categoryLabel(input.category)} ${yen(amount)} を記録しました`);
  }, '記録できませんでした。通信状況を確認してください');
});
quickAmount.addEventListener('blur', () => formatAmountInput(quickAmount));

function openExpenseModal(exp: Expense | null): void {
  state.expenseEditingId = exp?.id ?? null;
  state.expenseCat = exp?.category ?? state.quickCat;
  $('expense-modal-title').textContent = exp ? '支出を編集' : '支出を記録';
  inputAmount.value = exp ? exp.amount.toLocaleString('ja-JP') : '';
  inputMemo.value = exp?.memo ?? '';
  if (exp) inputDate.value = exp.date;
  else {
    // きろくタブで過去の月を見ているときは、その月の最終日（今日より先なら今日）を初期値に
    const s = state.settings;
    let d = todayKey();
    if (s && state.view === 'log' && state.logPeriod && state.logPeriod !== currentPeriod(s)) {
      const sum = summaryOf(allSummaries(), state.logPeriod);
      if (sum && sum.end < d) d = sum.end;
    }
    inputDate.value = d;
  }
  btnExpenseDelete.classList.toggle('hidden', !exp);
  renderExpenseCats();
  openOverlay(expenseOverlay);
  if (!exp) inputAmount.focus();
}

function renderExpenseCats(): void {
  renderChips($('expense-cats'), state.expenseCat, (k) => { state.expenseCat = k; renderExpenseCats(); });
}

expenseForm.addEventListener('submit', (e) => {
  e.preventDefault();
  const uid = state.uid;
  if (!uid) return;
  const amount = validate(inputAmount.value, inputDate.value);
  if (amount === null) return;
  const input: ExpenseInput = { date: inputDate.value, amount, category: state.expenseCat, memo: inputMemo.value };
  const editingId = state.expenseEditingId;
  void run('expense', async () => {
    if (editingId) await updateExpense(uid, editingId, input);
    else await createExpense(uid, input);
    closeOverlay(expenseOverlay);
    track(editingId ? 'expense_update' : 'expense_create', { category: input.category, from: 'modal' });
    showToast(editingId ? '保存しました' : `${categoryLabel(input.category)} ${yen(amount)} を記録しました`);
  }, '保存できませんでした。通信状況を確認してください');
});

btnExpenseDelete.addEventListener('click', () => {
  const uid = state.uid;
  const id = state.expenseEditingId;
  const exp = state.expenses.find((x) => x.id === id);
  if (!uid || !id || !exp) return;
  askConfirm('この支出を削除しますか？', `${dayLabel(exp.date)}の「${categoryLabel(exp.category)} ${yen(exp.amount)}」を削除します。元に戻せません。`, '削除する', async () => {
    await run('expense', async () => {
      await deleteExpense(uid, id);
      closeOverlay(expenseOverlay);
      track('expense_delete');
      showToast('削除しました');
    }, '削除できませんでした');
  });
});

$('btn-expense-close').addEventListener('click', () => closeOverlay(expenseOverlay));
$('btn-expense-cancel').addEventListener('click', () => closeOverlay(expenseOverlay));
inputAmount.addEventListener('blur', () => formatAmountInput(inputAmount));
btnFab.addEventListener('click', () => openExpenseModal(null));
$('btn-log-add').addEventListener('click', () => openExpenseModal(null));
$('btn-to-log').addEventListener('click', () => {
  if (state.settings) state.logPeriod = currentPeriod(state.settings);
  setView('log');
});

$('btn-prev-period').addEventListener('click', () => {
  state.logPeriod = shiftPeriod(state.logPeriod, -1);
  renderAll();
});
$('btn-next-period').addEventListener('click', () => {
  state.logPeriod = shiftPeriod(state.logPeriod, 1);
  renderAll();
});

// ============================================================
// Piggy bank
// ============================================================
function setPiggyMode(mode: 'in' | 'out'): void {
  state.piggyMode = mode;
  document.querySelectorAll<HTMLButtonElement>('[data-piggy-mode]').forEach((b) => {
    const on = b.dataset.piggyMode === mode;
    b.classList.toggle('is-active', on);
    b.setAttribute('aria-checked', String(on));
  });
  btnPiggySubmit.textContent = mode === 'in' ? '入れる' : '取り出す';
  renderPiggyQuick();
}

function piggyLimits(): { remain: number; balance: number } {
  const s = state.settings;
  if (!s) return { remain: 0, balance: 0 };
  const sum = summaryOf(allSummaries(), currentPeriod(s));
  return { remain: Math.max(0, sum?.remain ?? 0), balance: Math.max(0, piggyBalance(state.periods)) };
}

function renderPiggyQuick(): void {
  const { remain, balance } = piggyLimits();
  $('piggy-lead').textContent = `貯金箱：${yen(balance)}　／　今月の残り：${yen(remain)}`;
  const box = $('piggy-quick');
  box.replaceChildren();
  const max = state.piggyMode === 'in' ? remain : balance;
  const opts = [500, 1000, 3000, 5000].filter((v) => v <= max);
  if (max > 0) opts.push(-1);
  for (const v of opts) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'chip';
    b.textContent = v === -1 ? `全部（${yen(max)}）` : yen(v);
    b.addEventListener('click', () => { inputPiggy.value = (v === -1 ? max : v).toLocaleString('ja-JP'); });
    box.appendChild(b);
  }
}

$('btn-piggy').addEventListener('click', () => {
  inputPiggy.value = '';
  setPiggyMode('in');
  openOverlay(piggyOverlay);
});
document.querySelectorAll<HTMLButtonElement>('[data-piggy-mode]').forEach((b) => {
  b.addEventListener('click', () => setPiggyMode(b.dataset.piggyMode === 'out' ? 'out' : 'in'));
});
$('btn-piggy-close').addEventListener('click', () => closeOverlay(piggyOverlay));
$('btn-piggy-cancel').addEventListener('click', () => closeOverlay(piggyOverlay));
inputPiggy.addEventListener('blur', () => formatAmountInput(inputPiggy));

piggyForm.addEventListener('submit', (e) => {
  e.preventDefault();
  const uid = state.uid;
  const s = state.settings;
  if (!uid || !s) return;
  const amount = parseAmount(inputPiggy.value);
  if (!Number.isFinite(amount) || amount <= 0) { showToast('金額を数字で入れてください'); return; }
  const { remain, balance } = piggyLimits();
  if (state.piggyMode === 'in' && amount > remain) { showToast(`今月の残り（${yen(remain)}）までにしてください`); return; }
  if (state.piggyMode === 'out' && amount > balance) { showToast(`貯金箱の中身（${yen(balance)}）までにしてください`); return; }
  const key = currentPeriod(s);
  const docNow = periodDocOf(key);
  const next: PeriodDoc = state.piggyMode === 'in'
    ? { ...docNow, piggyIn: docNow.piggyIn + amount }
    : { ...docNow, piggyOut: docNow.piggyOut + amount };
  const mode = state.piggyMode;
  void run('piggy', async () => {
    await savePeriod(uid, next);
    closeOverlay(piggyOverlay);
    track(mode === 'in' ? 'piggy_in' : 'piggy_out');
    showToast(mode === 'in' ? `貯金箱に ${yen(amount)} 入れました` : `貯金箱から ${yen(amount)} 取り出しました`);
  }, '保存できませんでした。通信状況を確認してください');
});

// ============================================================
// Tabs / confirm / feedback / auth
// ============================================================
tabButtons.forEach((b) => b.addEventListener('click', () => {
  const v = b.dataset.tab as View;
  if (v === 'log' && state.settings) state.logPeriod = currentPeriod(state.settings);
  setView(v);
}));

function cancelConfirm(): void {
  state.confirmAction = null;
  closeOverlay(confirmOverlay);
}
$('btn-confirm-cancel').addEventListener('click', cancelConfirm);
btnConfirmOk.addEventListener('click', () => {
  const action = state.confirmAction;
  state.confirmAction = null;
  closeOverlay(confirmOverlay);
  if (action) void action();
});

$('feedback-btn').addEventListener('click', () => {
  openOverlay(feedbackOverlay);
  inputFeedbackMessage.focus();
});
$('btn-feedback-close').addEventListener('click', () => closeOverlay(feedbackOverlay));
btnFeedbackSend.addEventListener('click', async () => {
  const message = inputFeedbackMessage.value.trim();
  if (!message) { showToast('内容を入力してください'); return; }
  if (btnFeedbackSend.disabled) return;
  btnFeedbackSend.disabled = true;
  const ok = await submitFeedback(message);
  btnFeedbackSend.disabled = false;
  if (ok) {
    inputFeedbackMessage.value = '';
    closeOverlay(feedbackOverlay);
    showToast('送信しました。ありがとうございます');
  } else {
    showToast('送信できませんでした。時間をおいてお試しください');
  }
});

[settingsOverlay, expenseOverlay, piggyOverlay, feedbackOverlay].forEach((ov) => {
  ov.addEventListener('click', (e) => { if (e.target === ov) closeOverlay(ov); });
});
confirmOverlay.addEventListener('click', (e) => { if (e.target === confirmOverlay) cancelConfirm(); });
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  if (confirmOverlay.classList.contains('is-open')) { cancelConfirm(); return; }
  [settingsOverlay, expenseOverlay, piggyOverlay, feedbackOverlay].forEach(closeOverlay);
});

btnGoogleLogin.addEventListener('click', async () => {
  if (btnGoogleLogin.disabled) return;
  btnGoogleLogin.disabled = true;
  try {
    await loginWithGoogle();
    track('login');
  } catch (err) {
    console.error(err);
    const code = (err as { code?: string }).code ?? '';
    if (code !== 'auth/popup-closed-by-user' && code !== 'auth/cancelled-popup-request') {
      showToast('ログインできませんでした。もう一度お試しください');
    }
  } finally {
    btnGoogleLogin.disabled = false;
  }
});

$('btn-logout').addEventListener('click', () => {
  void logout().catch(() => showToast('ログアウトできませんでした'));
});

function stopSubscriptions(): void {
  state.unsubscribers.forEach((u) => u());
  state.unsubscribers = [];
}

let firstSettingsCheck = true;

onAuthChange((user: User | null) => {
  stopSubscriptions();
  [settingsOverlay, expenseOverlay, piggyOverlay, confirmOverlay, feedbackOverlay].forEach(closeOverlay);
  state.settings = null;
  state.expenses = [];
  state.periods = [];
  state.loaded = { settings: false, expenses: false, periods: false };
  state.view = 'home';
  state.logPeriod = '';
  firstSettingsCheck = true;

  if (!user) {
    state.uid = null;
    loginScreen.classList.remove('hidden');
    appEl.classList.add('hidden');
    userInfo.classList.add('hidden');
    return;
  }

  state.uid = user.uid;
  loginScreen.classList.add('hidden');
  appEl.classList.remove('hidden');
  userInfo.classList.remove('hidden');
  userName.textContent = user.displayName ?? '';
  if (user.photoURL) userAvatar.src = user.photoURL;
  else userAvatar.removeAttribute('src');
  userAvatar.classList.toggle('hidden', !user.photoURL);
  renderAll();

  const onError = (err: Error): void => {
    console.error(err);
    showToast('データを読み込めませんでした。再読み込みしてください');
  };
  state.unsubscribers.push(
    subscribeSettings(user.uid, (s) => {
      state.settings = s;
      state.loaded.settings = true;
      renderAll();
      if (firstSettingsCheck && !s) openSettings();
      firstSettingsCheck = false;
    }, onError),
    subscribeExpenses(user.uid, (items) => { state.expenses = items; state.loaded.expenses = true; renderAll(); }, onError),
    subscribePeriods(user.uid, (items) => { state.periods = items; state.loaded.periods = true; renderAll(); }, onError),
  );
});

initTextareas();
