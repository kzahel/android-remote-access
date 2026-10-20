import { useSyncExternalStore } from "react";

export type Theme = "system" | "light" | "dark";
export interface ClientSettings {
  theme: Theme;
  controlLabels: boolean;
  desktopSidebar: boolean;
}
// The small parser-blocking public/appearance.js uses the same key before paint.
const key = "remote-access-preferences-v1";
const defaults: ClientSettings = {
  theme: "system",
  controlLabels: false,
  desktopSidebar: true,
};
function read(): ClientSettings {
  try {
    const value = JSON.parse(
      localStorage.getItem(key) ?? "null",
    ) as Partial<ClientSettings> | null;
    return {
      theme:
        value?.theme === "light" || value?.theme === "dark"
          ? value.theme
          : "system",
      controlLabels: value?.controlLabels === true,
      desktopSidebar: value?.desktopSidebar !== false,
    };
  } catch {
    return { ...defaults };
  }
}
let current = read();
const listeners = new Set<() => void>();
function apply() {
  if (current.theme === "system") delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = current.theme;
  for (const listener of listeners) listener();
}
window.addEventListener("storage", (event) => {
  if (event.key === key || event.key === null) {
    current = read();
    apply();
  }
});
function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
export function useClientSettings(): ClientSettings {
  return useSyncExternalStore(subscribe, () => current);
}
/** Applies immediately; false means persistence failed, so the UI can explain it. */
export function updateClientSettings(patch: Partial<ClientSettings>): boolean {
  current = { ...current, ...patch };
  apply();
  try {
    localStorage.setItem(key, JSON.stringify(current));
    return true;
  } catch {
    return false;
  }
}
