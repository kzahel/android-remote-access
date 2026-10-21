import { useState } from "react";
import {
  type ClientSettings,
  updateClientSettings,
  useClientSettings,
} from "./client-settings.js";

export function SettingsPanel() {
  const settings = useClientSettings();
  const [error, setError] = useState("");
  function change(patch: Partial<ClientSettings>) {
    setError(
      updateClientSettings(patch)
        ? ""
        : "Applied for this tab, but settings couldn’t be saved.",
    );
  }
  return (
    <div className="settings-panel">
      <fieldset>
        <legend>Appearance</legend>
        <div className="theme-options">
          {(["system", "light", "dark"] as const).map((theme) => (
            <label key={theme}>
              <input
                type="radio"
                name="appearance"
                value={theme}
                checked={settings.theme === theme}
                onChange={() => change({ theme })}
              />
              {theme === "system"
                ? "System"
                : theme === "light"
                  ? "Light"
                  : "Dark"}
            </label>
          ))}
        </div>
      </fieldset>
      <fieldset>
        <legend>Viewer</legend>
        <label className="setting-toggle">
          <span>Show control labels</span>
          <input
            type="checkbox"
            checked={settings.controlLabels}
            onChange={(event) =>
              change({ controlLabels: event.target.checked })
            }
          />
        </label>
      </fieldset>
      {error && <p role="alert">{error}</p>}
    </div>
  );
}
