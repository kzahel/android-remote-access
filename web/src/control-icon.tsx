export type ControlIconName =
  | "back"
  | "home"
  | "recents"
  | "wake"
  | "lock"
  | "disconnect";

/** Small, consistent line icons; the enclosing button supplies its accessible name. */
export function ControlIcon({ name }: { name: ControlIconName }) {
  const shapes = {
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
