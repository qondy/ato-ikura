import {
  collection, doc, onSnapshot, addDoc, updateDoc, deleteDoc, setDoc, serverTimestamp,
} from 'firebase/firestore';
import { db } from './firebase';
import { AllowanceStep, Expense, PeriodDoc, Settings } from './types';
import { CATEGORY_KEYS } from './data';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const PERIOD_RE = /^\d{4}-\d{2}$/;

export const MAX_AMOUNT = 9_999_999;
export const MAX_MEMO = 40;

const str = (v: unknown): string => (typeof v === 'string' ? v : '');
const int = (v: unknown, max = MAX_AMOUNT): number =>
  (typeof v === 'number' && Number.isFinite(v) ? Math.min(max, Math.max(0, Math.round(v))) : 0);
const millis = (v: unknown): number =>
  (v && typeof (v as { toMillis?: unknown }).toMillis === 'function'
    ? (v as { toMillis: () => number }).toMillis() : Date.now());

type OnError = (err: Error) => void;

const userDoc = (uid: string, ...path: string[]) => doc(db, 'users', uid, ...path);

// ============================================================
// 設定
// ============================================================
function cleanAllowances(v: unknown): AllowanceStep[] {
  if (!Array.isArray(v)) return [];
  return v
    .map((s) => {
      const o = (s && typeof s === 'object' ? s : {}) as Record<string, unknown>;
      return { from: PERIOD_RE.test(str(o.from)) ? str(o.from) : '', amount: int(o.amount) };
    })
    .filter((s) => s.from)
    .sort((a, b) => (a.from < b.from ? -1 : 1))
    .slice(-60);
}

export function subscribeSettings(uid: string, onData: (s: Settings | null) => void, onError: OnError): () => void {
  return onSnapshot(userDoc(uid, 'settings', 'main'), (snap) => {
    if (!snap.exists()) { onData(null); return; }
    const d = snap.data();
    const allowances = cleanAllowances(d.allowances);
    const startPeriod = PERIOD_RE.test(str(d.startPeriod)) ? str(d.startPeriod) : '';
    if (!allowances.length || !startPeriod) { onData(null); return; }
    const payday = typeof d.payday === 'number' && d.payday >= 1 && d.payday <= 28 ? Math.floor(d.payday) : 1;
    onData({
      allowances,
      payday,
      startPeriod,
      carryPlus: d.carryPlus !== false,
      carryMinus: d.carryMinus !== false,
    });
  }, onError);
}

export function saveSettings(uid: string, s: Settings): Promise<void> {
  return setDoc(userDoc(uid, 'settings', 'main'), {
    allowances: cleanAllowances(s.allowances),
    payday: Math.min(28, Math.max(1, Math.floor(s.payday))),
    startPeriod: s.startPeriod,
    carryPlus: !!s.carryPlus,
    carryMinus: !!s.carryMinus,
    updatedAt: serverTimestamp(),
  });
}

// ============================================================
// 支出
// ============================================================
export interface ExpenseInput {
  date: string;
  amount: number;
  category: string;
  memo: string;
}

function cleanInput(input: ExpenseInput): ExpenseInput {
  return {
    date: DATE_RE.test(input.date) ? input.date : '',
    amount: int(input.amount),
    category: CATEGORY_KEYS.includes(input.category) ? input.category : 'other',
    memo: input.memo.trim().slice(0, MAX_MEMO),
  };
}

export function subscribeExpenses(uid: string, onData: (items: Expense[]) => void, onError: OnError): () => void {
  return onSnapshot(collection(db, 'users', uid, 'expenses'), (snap) => {
    const list: Expense[] = [];
    snap.forEach((d) => {
      const data = d.data();
      const date = str(data.date);
      const amount = int(data.amount);
      if (!DATE_RE.test(date) || !amount) return;
      list.push({
        id: d.id,
        date,
        amount,
        category: CATEGORY_KEYS.includes(str(data.category)) ? str(data.category) : 'other',
        memo: str(data.memo).slice(0, MAX_MEMO),
        createdAt: millis(data.createdAt),
      });
    });
    onData(list);
  }, onError);
}

export async function createExpense(uid: string, input: ExpenseInput): Promise<void> {
  const c = cleanInput(input);
  if (!c.date || !c.amount) throw new Error('invalid expense');
  await addDoc(collection(db, 'users', uid, 'expenses'), { ...c, createdAt: serverTimestamp() });
}

export async function updateExpense(uid: string, id: string, input: ExpenseInput): Promise<void> {
  const c = cleanInput(input);
  if (!c.date || !c.amount) throw new Error('invalid expense');
  await updateDoc(userDoc(uid, 'expenses', id), { ...c });
}

export function deleteExpense(uid: string, id: string): Promise<void> {
  return deleteDoc(userDoc(uid, 'expenses', id));
}

// ============================================================
// 期間ごとの貯金箱の出し入れ
// ============================================================
export function subscribePeriods(uid: string, onData: (items: PeriodDoc[]) => void, onError: OnError): () => void {
  return onSnapshot(collection(db, 'users', uid, 'periods'), (snap) => {
    const list: PeriodDoc[] = [];
    snap.forEach((d) => {
      if (!PERIOD_RE.test(d.id)) return;
      const data = d.data();
      list.push({ key: d.id, piggyIn: int(data.piggyIn), piggyOut: int(data.piggyOut) });
    });
    onData(list);
  }, onError);
}

export function savePeriod(uid: string, p: PeriodDoc): Promise<void> {
  if (!PERIOD_RE.test(p.key)) return Promise.reject(new Error('invalid period'));
  return setDoc(userDoc(uid, 'periods', p.key), {
    piggyIn: int(p.piggyIn),
    piggyOut: int(p.piggyOut),
    updatedAt: serverTimestamp(),
  });
}
