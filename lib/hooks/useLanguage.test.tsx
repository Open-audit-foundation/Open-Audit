import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { LanguageProvider, useLanguage, type Language } from "./useLanguage";

function renderUseLanguage(localStorageData: Record<string, string> = {}, navigatorLang = "en-US") {
  const localStorageMap = new Map(Object.entries(localStorageData));
  const getItem = vi.fn((key: string) => (localStorageMap.has(key) ? localStorageMap.get(key)! : null));
  const setItem = vi.fn((key: string, value: string) => localStorageMap.set(key, value));
  const removeItem = vi.fn((key: string) => localStorageMap.delete(key));

  vi.stubGlobal("localStorage", {
    getItem,
    setItem,
    removeItem,
    clear: vi.fn(() => localStorageMap.clear()),
  });

  const origNavigatorLanguage = (globalThis as any).navigator?.language;
  Object.defineProperty(globalThis, "navigator", {
    value: { language: navigatorLang },
    writable: true,
    configurable: true,
  });

  const { result } = renderHook(() => useLanguage(), {
    wrapper: LanguageProvider,
  });

  return { result, getItem, setItem, restoreNavigator: () => { (globalThis as any).navigator.language = origNavigatorLanguage; } };
}

describe("useLanguage", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("loads the stored preference on mount", async () => {
    const { result, getItem } = renderUseLanguage({ "oa:language": "es" });

    await act(async () => {
      await Promise.resolve();
    });

    expect(result.current.language).toBe("es");
    expect(result.current.ready).toBe(true);
    expect(getItem).toHaveBeenCalledWith("oa:language");
  });

  it("falls back to English when an invalid stored value exists", async () => {
    const { result } = renderUseLanguage({ "oa:language": "xx" });

    await act(async () => {
      await Promise.resolve();
    });

    expect(result.current.language).toBe("en");
    expect(result.current.ready).toBe(true);
  });

  it("writes the new preference to localStorage on change", async () => {
    const { result, setItem } = renderUseLanguage();

    await act(async () => {
      await Promise.resolve();
    });

    act(() => {
      result.current.setLanguage("fr");
    });

    expect(result.current.language).toBe("fr");
    expect(setItem).toHaveBeenCalledWith("oa:language", "fr");
  });

  it("falls back to navigator.language when no stored value exists", async () => {
    const { result } = renderUseLanguage({}, "fr-CA");

    await act(async () => {
      await Promise.resolve();
    });

    expect(result.current.language).toBe("fr");
    expect(result.current.ready).toBe(true);
  });

  it("falls back to English when navigator.language is unsupported", async () => {
    const { result } = renderUseLanguage({}, "de-DE");

    await act(async () => {
      await Promise.resolve();
    });

    expect(result.current.language).toBe("en");
    expect(result.current.ready).toBe(true);
  });

  it("matches navigator.language by prefix", async () => {
    const { result } = renderUseLanguage({}, "es-MX");

    await act(async () => {
      await Promise.resolve();
    });

    expect(result.current.language).toBe("es");
  });

  it("silently degrades when localStorage.setItem throws", async () => {
    const setItem = vi.fn(() => {
      throw new Error("QuotaExceededError");
    });
    vi.stubGlobal("localStorage", {
      getItem: vi.fn(() => null),
      setItem,
      removeItem: vi.fn(),
    });

    const { result } = renderHook(() => useLanguage(), {
      wrapper: LanguageProvider,
    });

    await act(async () => {
      await Promise.resolve();
    });

    expect(() => {
      act(() => {
        result.current.setLanguage("zh");
      });
    }).not.toThrow();

    expect(result.current.language).toBe("zh");
  });
});
