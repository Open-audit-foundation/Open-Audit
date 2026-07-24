"use client";

import { createContext, useContext, useState, useEffect, type ReactNode } from "react";

export type Language = "en" | "es" | "fr" | "zh";

interface LanguageContextType {
  language: Language;
  ready: boolean;
  setLanguage: (lang: Language) => void;
}

const STORAGE_KEY = "oa:language";

const SUPPORTED_LANGUAGES: readonly Language[] = ["en", "es", "fr", "zh"];

function loadStoredLanguage(): Language | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw && SUPPORTED_LANGUAGES.includes(raw as Language)) {
      return raw as Language;
    }
  } catch {
    // storage unavailable
  }
  return null;
}

function matchNavigatorLanguage(): Language {
  try {
    const navLang = navigator.language?.toLowerCase() ?? "";
    if (!navLang) return "en";
    const prefix = navLang.split("-")[0];
    if (SUPPORTED_LANGUAGES.includes(prefix as Language)) {
      return prefix as Language;
    }
  } catch {
    // navigator unavailable
  }
  return "en";
}

const LanguageContext = createContext<LanguageContextType | undefined>(undefined);

export function LanguageProvider({ children }: { children: ReactNode }): React.JSX.Element {
  const [language, setLanguage] = useState<Language>("en");
  const [ready, setReady] = useState(false);

  useEffect(function () {
    const stored = loadStoredLanguage();
    if (stored) {
      setLanguage(stored);
    } else {
      setLanguage(matchNavigatorLanguage());
    }
    setReady(true);
  }, []);

  const updateLanguage = function (lang: Language) {
    setLanguage(lang);
    try {
      localStorage.setItem(STORAGE_KEY, lang);
    } catch {
      // storage quota or private browsing — silently degrade
    }
  };

  return (
    <LanguageContext.Provider value={{ language, ready, setLanguage: updateLanguage }}>
      {children}
    </LanguageContext.Provider>
  );
}

export function useLanguage(): LanguageContextType {
  const context = useContext(LanguageContext);
  if (!context) {
    throw new Error("useLanguage must be used within a LanguageProvider");
  }
  return context;
}
