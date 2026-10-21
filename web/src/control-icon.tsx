export type ControlIconName =
  | "back"
  | "fullscreen"
  | "exit-fullscreen"
  | "home"
  | "recents"
  | "wake"
  | "lock"
  | "disconnect"
  | "menu"
  | "settings"
  | "phone"
  | "phones"
  | "plus"
  | "info"
  | "close"
  | "quality"
  | "screen"
  | "touch"
  | "notifications"
  | "keyboard";

/** Small, consistent line icons; the enclosing button supplies its accessible name. */
export function ControlIcon({ name }: { name: ControlIconName }) {
  const shapes = {
    fullscreen: <path d="M9 3H3v6m12-6h6v6M3 15v6h6m12-6v6h-6" />,
    "exit-fullscreen": <path d="M3 9h6V3m12 6h-6V3M9 21v-6H3m12 6v-6h6" />,
    screen: (
      <>
        <rect x="3" y="3" width="18" height="14" rx="2" />
        <path d="M8 21h8m-4-4v4" />
      </>
    ),
    touch: (
      <>
        <path d="M8 13V6a2 2 0 0 1 4 0v6l2-1 6 3-1 6H9l-5-6a2 2 0 0 1 3-2l1 1Z" />
        <path d="M4 5a6 6 0 0 1 12 0" />
      </>
    ),
    notifications: (
      <>
        <path d="M5 9a7 7 0 0 1 14 0v5l2 3H3l2-3V9Zm4 11a3 3 0 0 0 6 0" />
      </>
    ),
    menu: <path d="M4 6h16M4 12h16M4 18h16" />,
    close: <path d="m6 6 12 12M6 18 18 6" />,
    phone: (
      <>
        <rect x="6" y="2" width="12" height="20" rx="3" />
        <path d="M10 18h4" />
      </>
    ),
    phones: (
      <>
        <rect x="9" y="5" width="11" height="17" rx="2" />
        <path d="M6 18H4V2h11v1m-2 15h3" />
      </>
    ),
    plus: <path d="M12 4v16M4 12h16" />,
    info: (
      <>
        <circle cx="12" cy="12" r="9" />
        <path d="M12 11v6m0-10v.5" />
      </>
    ),
    settings: (
      <>
        <path d="m9 3-1 3-3 1 1 3-2 2 2 2-1 3 3 1 1 3h6l1-3 3-1-1-3 2-2-2-2 1-3-3-1-1-3Z" />
        <circle cx="12" cy="12" r="3" />
      </>
    ),
    quality: (
      <>
        <rect x="3" y="5" width="18" height="14" rx="2" />
        <path d="m10 9 5 3-5 3Z" />
      </>
    ),
    keyboard: (
      <>
        <rect x="2" y="5" width="20" height="14" rx="2" />
        <path d="M6 9h.5M10 9h.5M14 9h.5M18 9h.5M6 12h.5M10 12h.5M14 12h.5M18 12h.5M7 15h10" />
      </>
    ),
    back: <path d="m15 5-7 7 7 7" />,
    home: <circle cx="12" cy="12" r="7" />,
    recents: <rect x="5" y="5" width="14" height="14" rx="2" />,
    wake: (
      <>
        <circle cx="12" cy="12" r="4" />
        <path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.5 1.5m11 11L19 19M5 19l1.5-1.5m11-11L19 5" />
      </>
    ),
    lock: (
      <>
        <rect x="5" y="10" width="14" height="11" rx="2" />
        <path d="M8 10V7a4 4 0 0 1 8 0v3m-4 5v2" />
      </>
    ),
    disconnect: <path d="M9 5H5v14h4m5-14 7 7-7 7m-5-7h12" />,
  };
  return (
    <svg
      className="control-icon"
      viewBox="0 0 24 24"
      width="24"
      height="24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {shapes[name]}
    </svg>
  );
}
