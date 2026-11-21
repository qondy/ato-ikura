// カテゴリの key は Firestore に保存するので変更しないこと（表示名は変えてよい）
export interface Category {
  key: string;
  label: string;
}

export const CATEGORIES: Category[] = [
  { key: 'lunch', label: '昼ごはん' },
  { key: 'cafe', label: 'コーヒー・喫茶' },
  { key: 'drink', label: '飲み代' },
  { key: 'tobacco', label: 'タバコ・お酒' },
  { key: 'hobby', label: '趣味' },
  { key: 'play', label: '遊び' },
  { key: 'phone', label: 'スマホ代' },
  { key: 'pc', label: 'PC・通信' },
  { key: 'car', label: '車・ガソリン' },
  { key: 'grooming', label: '身だしなみ' },
  { key: 'other', label: 'その他' },
];

export const CATEGORY_KEYS = CATEGORIES.map((c) => c.key);

export function categoryLabel(key: string): string {
  return CATEGORIES.find((c) => c.key === key)?.label ?? 'その他';
}

/**
 * みんなの使いみち（固定データ）
 * 出典: SBI新生銀行（当時 新生銀行）「2019年サラリーマンのお小遣い調査」
 * 男性会社員が「お小遣いの使いみちとして必要不可欠」と答えた上位10項目（%）と、その月々の必要額（円）
 */
export interface SurveyItem {
  key: string;
  label: string;
  percent: number;
  need: number;
}

export const SURVEY_ITEMS: SurveyItem[] = [
  { key: 'lunch', label: '昼食代', percent: 43.1, need: 9907 },
  { key: 'phone', label: '携帯電話代', percent: 25.1, need: 6940 },
  { key: 'tobacco', label: '嗜好品代（タバコ・お酒など）', percent: 18.8, need: 9813 },
  { key: 'hobby', label: '趣味の費用', percent: 18.1, need: 11995 },
  { key: 'car', label: '車関係・ガソリン代', percent: 17.2, need: 8664 },
  { key: 'drink', label: '飲み代', percent: 16.9, need: 12376 },
  { key: 'play', label: '遊興費', percent: 8.3, need: 12363 },
  { key: 'grooming', label: '身だしなみのための費用', percent: 8.1, need: 3629 },
  { key: 'cafe', label: '喫茶代', percent: 7.7, need: 3604 },
  { key: 'pc', label: 'パソコン関連・通信料', percent: 7.5, need: 5303 },
];

export const SURVEY_SOURCE = 'SBI新生銀行（当時 新生銀行）「2019年サラリーマンのお小遣い調査」男性会社員・お小遣いがある人ベース';

/** 出典: SBI新生銀行「2024年会社員のお小遣い調査」男性会社員 */
export const SURVEY_2024 = {
  allowance: 39081,
  lunch: 709,
  drinkMonth: 13533,
  source: 'SBI新生銀行「2024年会社員のお小遣い調査」男性会社員',
};

export const PAYDAY_OPTIONS = Array.from({ length: 28 }, (_, i) => i + 1);
