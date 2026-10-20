"use client";

// Tiny localStorage-backed stores (no backend, no accounts). Reads are guarded:
// storage can be unavailable (private mode) and the UI must still work.
import { useCallback, useSyncExternalStore } from "react";

function createStore<T>(key: string, fallback: T) {
  const listeners = new Set<() => void>();
  let cache: { raw: string | null; value: T } | null = null;

  const read = (): T => {
    let raw: string | null = null;
    try {
      raw = window.localStorage.getItem(key);
    } catch {
      return fallback;
    }
    if (cache && cache.raw === raw) return cache.value;
    let value = fallback;
    try {
      if (raw) value = JSON.parse(raw) as T;
    } catch {
      value = fallback;
    }
    cache = { raw, value };
    return value;
  };

  const write = (value: T) => {
    try {
      window.localStorage.setItem(key, JSON.stringify(value));
    } catch {
      // Ignore: the value just will not persist.
    }
    cache = null;
    listeners.forEach((listener) => listener());
  };

  const subscribe = (listener: () => void) => {
    listeners.add(listener);
    window.addEventListener("storage", listener);
    return () => {
      listeners.delete(listener);
      window.removeEventListener("storage", listener);
    };
  };

  return { read, write, subscribe, fallback };
}

const savedStore = createStore<string[]>("shortlist.saved", []);

export function useSavedJobs() {
  const saved = useSyncExternalStore(savedStore.subscribe, savedStore.read, () => savedStore.fallback);
  const toggle = useCallback((key: string) => {
    const current = savedStore.read();
    savedStore.write(current.includes(key) ? current.filter((item) => item !== key) : [...current, key]);
  }, []);
  return { saved, isSaved: (key: string) => saved.includes(key), toggle };
}
