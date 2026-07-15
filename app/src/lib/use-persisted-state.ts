import { useCallback, useSyncExternalStore } from "react";

// SSR-safe, lint-clean persisted UI state (panel open/closed, chosen model, …).
//
// Reads straight from localStorage on the client via useSyncExternalStore, so
// there's no post-mount setState (which the react-hooks "set-state-in-effect"
// rule flags as a cascading render) and no hydration mismatch: the server
// snapshot is the default, which React reconciles to the client value right
// after hydration — exactly the behaviour we want for a browser-only preference.
//
// decode maps the stored string (or null when unset) to the value; encode maps
// it back. Both must be referentially stable (define them at module scope).
const SAME_TAB_EVENT = "tess:pref-change";

export function usePersistedState<T>(
  key: string,
  fallback: T,
  decode: (raw: string | null) => T,
  encode: (value: T) => string,
): [T, (value: T) => void] {
  const subscribe = useCallback((onChange: () => void) => {
    // "storage" fires for changes in *other* tabs; the custom event covers
    // same-tab writes so the setter updates this component immediately.
    window.addEventListener("storage", onChange);
    window.addEventListener(SAME_TAB_EVENT, onChange);
    return () => {
      window.removeEventListener("storage", onChange);
      window.removeEventListener(SAME_TAB_EVENT, onChange);
    };
  }, []);

  const value = useSyncExternalStore(
    subscribe,
    () => decode(localStorage.getItem(key)), // client snapshot
    () => fallback, // server snapshot (no localStorage during SSR)
  );

  const set = useCallback(
    (next: T) => {
      localStorage.setItem(key, encode(next));
      window.dispatchEvent(new Event(SAME_TAB_EVENT));
    },
    [key, encode],
  );

  return [value, set];
}
