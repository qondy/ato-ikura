const pad = (n: number): string => String(n).padStart(2, '0');

export function ymd(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function todayKey(): string {
  return ymd(new Date());
}

export function parseYmd(s: string): Date {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
}

/** 期間キー（YYYY-MM）→ [年, 月(1-12)] */
export function splitPeriod(key: string): [number, number] {
  const [y, m] = key.split('-').map(Number);
  return [y, m];
}

export function periodKeyOf(y: number, m1: number): string {
  const d = new Date(y, m1 - 1, 1);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
}

export function shiftPeriod(key: string, delta: number): string {
  const [y, m] = splitPeriod(key);
  return periodKeyOf(y, m + delta);
}

/** 日付がどの期間に入るか（支給日より前なら前の月の期間） */
export function periodOfDate(dateStr: string, payday: number): string {
  const d = parseYmd(dateStr);
  const y = d.getFullYear();
  const m = d.getMonth() + 1;
  return d.getDate() >= payday ? periodKeyOf(y, m) : periodKeyOf(y, m - 1);
}

export function periodRange(key: string, payday: number): { start: string; end: string } {
  const [y, m] = splitPeriod(key);
  const start = new Date(y, m - 1, payday);
  const end = new Date(y, m, payday - 1);
  return { start: ymd(start), end: ymd(end) };
}

export function daysBetween(a: string, b: string): number {
  return Math.round((parseYmd(b).getTime() - parseYmd(a).getTime()) / 86400000);
}

/** 期間の呼び名。支給日が1日なら「11月」、それ以外は「11月分」 */
export function periodLabel(key: string, payday: number): string {
  const [y, m] = splitPeriod(key);
  const now = new Date();
  const yearPart = y === now.getFullYear() ? '' : `${y}年`;
  return payday === 1 ? `${yearPart}${m}月` : `${yearPart}${m}月分`;
}

export function rangeLabel(key: string, payday: number): string {
  const { start, end } = periodRange(key, payday);
  return `${shortDate(start)}〜${shortDate(end)}`;
}

export function shortDate(s: string): string {
  const d = parseYmd(s);
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

const WEEK = ['日', '月', '火', '水', '木', '金', '土'];

export function dayLabel(s: string): string {
  const d = parseYmd(s);
  return `${d.getMonth() + 1}月${d.getDate()}日（${WEEK[d.getDay()]}）`;
}
