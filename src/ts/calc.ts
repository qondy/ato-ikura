import { Expense, PeriodDoc, PeriodSummary, Settings } from './types';
import { periodOfDate, periodRange, shiftPeriod, todayKey, daysBetween } from './dates';

export function allowanceFor(settings: Settings, key: string): number {
  let amount = 0;
  for (const step of settings.allowances) {
    if (step.from <= key) amount = step.amount;
  }
  if (!amount && settings.allowances.length) amount = settings.allowances[0].amount;
  return amount;
}

export function currentPeriod(settings: Settings): string {
  return periodOfDate(todayKey(), settings.payday);
}

/** 使い始めの期間から指定の期間までを、繰越込みで順に計算する */
export function summarize(
  settings: Settings, expenses: Expense[], periods: PeriodDoc[], untilKey: string,
): PeriodSummary[] {
  const spentBy = new Map<string, number>();
  for (const e of expenses) {
    const k = periodOfDate(e.date, settings.payday);
    spentBy.set(k, (spentBy.get(k) ?? 0) + e.amount);
  }
  const docBy = new Map(periods.map((p) => [p.key, p]));

  // 使い始めより前の日付で記録された支出があれば、その期間から数える
  let first = settings.startPeriod;
  spentBy.forEach((_, k) => { if (k < first) first = k; });

  const list: PeriodSummary[] = [];
  let carry = 0;
  for (let key = first; key <= untilKey; key = shiftPeriod(key, 1)) {
    const doc = docBy.get(key);
    const allowance = allowanceFor(settings, key);
    const piggyIn = doc?.piggyIn ?? 0;
    const piggyOut = doc?.piggyOut ?? 0;
    const available = allowance + carry + piggyOut - piggyIn;
    const spent = spentBy.get(key) ?? 0;
    const remain = available - spent;
    const { start, end } = periodRange(key, settings.payday);
    list.push({ key, start, end, allowance, carryIn: carry, piggyIn, piggyOut, available, spent, remain });
    if (remain >= 0) carry = settings.carryPlus ? remain : 0;
    else carry = settings.carryMinus ? remain : 0;
    if (list.length > 600) break; // 念のための上限（50年分）
  }
  return list;
}

export function piggyBalance(periods: PeriodDoc[]): number {
  return periods.reduce((sum, p) => sum + p.piggyIn - p.piggyOut, 0);
}

export type Pace = 'good' | 'caution' | 'over';

export interface TodayInfo {
  daysLeft: number; // 今日を含む残り日数
  totalDays: number;
  perDay: number;
  pace: Pace;
}

export function todayInfo(sum: PeriodSummary): TodayInfo {
  const today = todayKey();
  const totalDays = daysBetween(sum.start, sum.end) + 1;
  const daysLeft = Math.max(1, daysBetween(today, sum.end) + 1);
  const perDay = sum.remain > 0 ? Math.floor(sum.remain / daysLeft) : 0;
  let pace: Pace = 'good';
  if (sum.remain < 0) pace = 'over';
  else if (sum.available > 0) {
    const ideal = sum.available * (daysLeft / totalDays);
    if (sum.remain < ideal * 0.8) pace = 'caution';
  }
  return { daysLeft, totalDays, perDay, pace };
}

export function expensesIn(expenses: Expense[], start: string, end: string): Expense[] {
  return expenses
    .filter((e) => e.date >= start && e.date <= end)
    .sort((a, b) => (a.date === b.date ? b.createdAt - a.createdAt : a.date < b.date ? 1 : -1));
}

export function byCategory(expenses: Expense[]): { key: string; amount: number; count: number }[] {
  const m = new Map<string, { amount: number; count: number }>();
  for (const e of expenses) {
    const cur = m.get(e.category) ?? { amount: 0, count: 0 };
    cur.amount += e.amount;
    cur.count += 1;
    m.set(e.category, cur);
  }
  return Array.from(m.entries())
    .map(([key, v]) => ({ key, ...v }))
    .sort((a, b) => b.amount - a.amount);
}

/** 終わった期間のうち、予算内で過ごせた連続の月数（直近から数える） */
export function withinStreak(list: PeriodSummary[], currentKey: string): number {
  let n = 0;
  for (let i = list.length - 1; i >= 0; i--) {
    if (list[i].key >= currentKey) continue;
    if (list[i].remain >= 0) n++;
    else break;
  }
  return n;
}

export function yen(n: number): string {
  const sign = n < 0 ? '-' : '';
  return `${sign}${Math.abs(Math.round(n)).toLocaleString('ja-JP')}円`;
}
