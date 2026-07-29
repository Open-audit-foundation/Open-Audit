"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

type JsonValue = unknown;

export interface UseLocalStorageOptions<T> {
    /**
     * If true, merges stored value (if object) into the provided defaultValue.
     * Only useful when T is an object type.
     */
    merge?: boolean;
    /** Custom serializer. Defaults to JSON.stringify */
    serialize?: (value: T) => string;
    /** Custom deserializer. Defaults to JSON.parse */
    deserialize?: (raw: string) => T;
}

export interface UseLocalStorageResult<T> {
    value: T;
    ready: boolean;
    setValue: (next: T | ((prev: T) => T)) => void;
    remove: () => void;
}

export function useLocalStorage<T>(
    key: string,
    defaultValue: T,
    options: UseLocalStorageOptions<T> = {}
): UseLocalStorageResult<T> {
    const {
        merge = false,
        serialize = (v) => JSON.stringify(v),
        deserialize = (raw) => JSON.parse(raw) as T,
    } = options;

    // Avoid hydration mismatches by never reading localStorage during render.
    const [value, setValueState] = useState<T>(defaultValue);
    const [ready, setReady] = useState(false);

    // Track whether we've already tried to hydrate to prevent edge-case loops.
    const hydratedRef = useRef(false);

    useEffect(() => {
        if (hydratedRef.current) return;
        hydratedRef.current = true;

        try {
            const raw = localStorage.getItem(key);
            if (raw == null) {
                setReady(true);
                return;
            }

            const parsed = deserialize(raw) as JsonValue;

            if (merge && parsed && typeof parsed === "object") {
                setValueState((prev: T) => ({ ...(prev as any), ...(parsed as any) }));
            } else {
                setValueState(parsed as T);
            }
        } catch {
            // Storage disabled, invalid JSON, or blocked access — silently fall back.
        } finally {
            setReady(true);
        }
    }, [deserialize, key, merge]);

    const setValue = useCallback(
        (next: T | ((prev: T) => T)) => {
            setValueState((prev: T) => {
                const resolved = typeof next === "function" ? (next as (p: T) => T)(prev) : next;
                try {
                    localStorage.setItem(key, serialize(resolved));
                } catch {
                    // ignore
                }
                return resolved;
            });
        },
        [key, serialize]
    );

    const remove = useCallback(() => {
        try {
            localStorage.removeItem(key);
        } catch {
            // ignore
        }
        setValueState(defaultValue);
    }, [defaultValue, key]);

    // Memoize return object to reduce rerenders in consumers.
    return useMemo(() => ({ value, ready, setValue, remove }), [remove, ready, setValue, value]);
}

