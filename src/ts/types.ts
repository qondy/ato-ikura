export interface AllowanceStep {
  /** この期間（YYYY-MM）から適用 */
  from: string;
  amount: number;
}

export interface Settings {
  /** お小遣いの額の履歴（from の昇順） */
  allowances: AllowanceStep[];
  /** 支給日（1〜28）。この日から次の支給日の前日までを1か月として数える */
  payday: number;
  /** 使い始めた期間（YYYY-MM）。繰越はここから計算する */
  startPeriod: string;
  /** 残ったお金を翌月に繰り越す */
  carryPlus: boolean;
  /** 使いすぎた分を翌月から差し引く */
  carryMinus: boolean;
}

export interface Expense {
  id: string;
  date: string; // YYYY-MM-DD
  amount: number;
  category: string;
  memo: string;
  createdAt: number;
}

/** 期間ごとの貯金箱の出し入れ */
export interface PeriodDoc {
  key: string; // YYYY-MM
  piggyIn: number; // この月のお小遣いから貯金箱へ移した額
  piggyOut: number; // 貯金箱からこの月のお小遣いへ戻した額
}

export interface PeriodSummary {
  key: string;
  start: string; // YYYY-MM-DD
  end: string; // YYYY-MM-DD（含む）
  allowance: number;
  carryIn: number;
  piggyIn: number;
  piggyOut: number;
  available: number;
  spent: number;
  remain: number;
}
