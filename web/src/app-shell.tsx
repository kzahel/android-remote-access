import { type ReactNode, useEffect, useRef, useState } from "react";
import { updateClientSettings, useClientSettings } from "./client-settings.js";
import { ControlIcon } from "./control-icon.js";
import { usePhoneActivity } from "./phone-activity.js";
import { PhoneManagement } from "./phone-management.js";
import { SettingsPanel } from "./settings-panel.js";
import { phoneName, phoneURL, type SavedPhone } from "./store.js";
import { HeadingTarget } from "./viewer-heading.js";

export function AppShell({
  phones,
  current,
  children,
}: {
  phones: SavedPhone[];
  current?: SavedPhone | undefined;
  children: ReactNode;
}) {
  const settings = useClientSettings();
  const [wide, setWide] = useState(
    () => matchMedia("(min-width: 900px)").matches,
  );
  const [heading, setHeading] = useState<HTMLDivElement | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const drawer = useRef<HTMLDialogElement>(null);
  const preferences = useRef<HTMLDialogElement>(null);
  const activity = usePhoneActivity();
  useEffect(() => {
    const query = matchMedia("(min-width: 900px)");
    const change = () => {
      drawer.current?.close();
      setDrawerOpen(false);
      setWide(query.matches);
    };
    query.addEventListener("change", change);
    return () => query.removeEventListener("change", change);
  }, []);
  useEffect(() => {
    if (settingsOpen) preferences.current?.showModal();
  }, [settingsOpen]);
  function showSettings() {
    drawer.current?.close();
    setSettingsOpen(true);
  }
  const navigation = (
    <nav className="sidebar-navigation" aria-label="Main navigation">
      <div className="sidebar-top-links">
        <a
          href="/"
          className="sidebar-link"
          aria-current={location.pathname === "/" ? "page" : undefined}
        >
          <ControlIcon name="phones" />
          <span>All phones</span>
        </a>
        <a
          href="/pair"
          className="sidebar-link"
          aria-label="Pair another phone"
          aria-current={location.pathname === "/pair" ? "page" : undefined}
        >
          <ControlIcon name="plus" />
          <span>Add phone</span>
        </a>
      </div>
      <div className="sidebar-phone-list">
        <h2>Phones</h2>
        {phones.length ? (
          [...phones]
            .sort((a, b) => b.pairedAt - a.pairedAt || a.id.localeCompare(b.id))
            .map((phone) => (
              <div
                className="sidebar-phone-row"
                key={phone.id}
                data-selected={phone.id === current?.id || undefined}
              >
                <a
                  href={phoneURL(phone.id)}
                  className="sidebar-phone-link"
                  aria-label={`Switch to ${phoneName(phone)}`}
                  aria-current={phone.id === current?.id ? "page" : undefined}
                >
                  <ControlIcon name="phone" />
                  <span className="sidebar-phone-name">
                    {phoneName(phone)}
                    {activity.has(phone.id) && (
                      <span className="phone-use">
                        <span className="activity-dot" />
                        In use
                      </span>
                    )}
                  </span>
                </a>
                <PhoneManagement
                  phone={phone}
                  label={`Details for ${phoneName(phone)}`}
                />
              </div>
            ))
        ) : (
          <p className="sidebar-empty">No saved phones</p>
        )}
      </div>
      <div className="sidebar-footer">
        <button className="sidebar-link" type="button" onClick={showSettings}>
          <ControlIcon name="settings" />
          <span>Settings</span>
        </button>
      </div>
    </nav>
  );
  return (
    <HeadingTarget.Provider value={heading}>
      <div
        className="app-shell"
        data-sidebar={wide && settings.desktopSidebar ? "open" : "closed"}
      >
        <header className="app-topbar">
          <button
            className="icon-button menu-toggle"
            type="button"
            aria-label="Toggle navigation"
            title="Toggle navigation"
            aria-controls="app-sidebar"
            aria-expanded={wide ? settings.desktopSidebar : drawerOpen}
            onClick={() => {
              if (wide)
                updateClientSettings({
                  desktopSidebar: !settings.desktopSidebar,
                });
              else {
                drawer.current?.showModal();
                setDrawerOpen(true);
              }
            }}
          >
            <ControlIcon name="menu" />
          </button>
          <div className="topbar-heading" ref={setHeading} />
          {current && <PhoneManagement phone={current} />}
        </header>
        {wide ? (
          <aside
            id="app-sidebar"
            className="app-sidebar"
            hidden={!settings.desktopSidebar}
          >
            {navigation}
          </aside>
        ) : (
          <dialog
            id="app-sidebar"
            className="navigation-drawer"
            ref={drawer}
            aria-label="Navigation"
            onClose={() => setDrawerOpen(false)}
            onPointerDown={(event) => {
              if (event.target === event.currentTarget) {
                const rect = event.currentTarget.getBoundingClientRect();
                if (
                  event.clientX > rect.right ||
                  event.clientY > rect.bottom ||
                  event.clientX < rect.left ||
                  event.clientY < rect.top
                )
                  drawer.current?.close();
              }
            }}
          >
            <div className="drawer-heading">
              <span>Navigation</span>
              <button
                className="icon-button"
                type="button"
                aria-label="Close navigation"
                onClick={() => drawer.current?.close()}
              >
                <ControlIcon name="close" />
              </button>
            </div>
            {navigation}
          </dialog>
        )}
        <div className="app-content">{children}</div>
        <dialog
          ref={preferences}
          aria-labelledby="client-settings-title"
          onClose={() => setSettingsOpen(false)}
        >
          {settingsOpen && (
            <>
              <div className="dialog-heading">
                <h2 id="client-settings-title">Settings</h2>
                <button
                  className="icon-button"
                  type="button"
                  aria-label="Close settings"
                  onClick={() => preferences.current?.close()}
                >
                  <ControlIcon name="close" />
                </button>
              </div>
              <SettingsPanel />
            </>
          )}
        </dialog>
      </div>
    </HeadingTarget.Provider>
  );
}
