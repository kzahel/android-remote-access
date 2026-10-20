// External, parser-blocking bootstrap: honor a saved override before first paint.
// Keep the storage key/theme values aligned with src/client-settings.ts.
(() => {
  try {
    const value = JSON.parse(
      localStorage.getItem("remote-access-preferences-v1") || "null",
    );
    if (value?.theme === "light" || value?.theme === "dark") {
      document.documentElement.dataset.theme = value.theme;
    }
  } catch {
    /* Unavailable storage uses the system appearance. */
  }
})();
