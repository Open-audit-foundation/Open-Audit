import { EN_TRANSLATIONS } from "./en";
import { ES_TRANSLATIONS } from "./es";
import { FR_TRANSLATIONS } from "./fr";
import { ZH_TRANSLATIONS } from "./zh";
import type { Language } from "../types";

export const TRANSLATIONS: Record<Language, typeof EN_TRANSLATIONS> = {
  en: EN_TRANSLATIONS,
  es: ES_TRANSLATIONS,
  fr: FR_TRANSLATIONS,
  zh: ZH_TRANSLATIONS,
};

export function getTranslation(lang: Language): typeof EN_TRANSLATIONS {
  return TRANSLATIONS[lang] || TRANSLATIONS.en;
}
