import { EN_TRANSLATIONS } from "./en";
import { ES_TRANSLATIONS } from "./es";
import { FR_TRANSLATIONS } from "./fr";
import { ZH_TRANSLATIONS } from "./zh";
import type { Language, TranslationMap } from "../types";

export const TRANSLATIONS: Record<Language, TranslationMap> = {
  en: EN_TRANSLATIONS,
  es: ES_TRANSLATIONS,
  fr: FR_TRANSLATIONS,
  zh: ZH_TRANSLATIONS,
};

export function getTranslation(lang: Language): TranslationMap {
  return TRANSLATIONS[lang] || TRANSLATIONS.en;
}
