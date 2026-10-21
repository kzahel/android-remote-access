import { useEffect, useRef, useState } from "react";

/** Browser exits change presentation only; they never navigate or reconnect. */
export function useViewerFullscreen(releaseInput: () => void) {
  const element = useRef<HTMLElement>(null);
  const [active, setActive] = useState(false);
  const fallback = useRef(false);
  const mounted = useRef(false);
  const pending = useRef(false);
  const release = useRef(releaseInput);
  release.current = releaseInput;
  useEffect(() => {
    mounted.current = true;
    const target = element.current;
    const changed = () => {
      release.current();
      fallback.current = false;
      setActive(document.fullscreenElement === target);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (
        event.key === "Escape" &&
        fallback.current &&
        !event.defaultPrevented &&
        !target?.querySelector("dialog[open]")
      ) {
        event.preventDefault();
        release.current();
        fallback.current = false;
        setActive(false);
      }
    };
    document.addEventListener("fullscreenchange", changed);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      mounted.current = false;
      document.removeEventListener("fullscreenchange", changed);
      document.removeEventListener("keydown", onKeyDown);
      if (document.fullscreenElement === target)
        void document.exitFullscreen().catch(() => {});
    };
  }, []);
  async function toggle() {
    const target = element.current;
    if (!target || pending.current) return;
    release.current();
    if (fallback.current) {
      fallback.current = false;
      setActive(false);
      return;
    }
    pending.current = true;
    try {
      if (document.fullscreenElement === target) {
        await document.exitFullscreen();
      } else {
        // Call directly from the button to preserve browser user activation.
        if (!document.fullscreenEnabled || !target.requestFullscreen)
          throw new Error("Fullscreen unavailable");
        await target.requestFullscreen({ navigationUI: "hide" });
        if (!mounted.current && document.fullscreenElement === target)
          await document.exitFullscreen();
      }
    } catch {
      if (mounted.current && document.fullscreenElement !== target) {
        fallback.current = true;
        setActive(true);
      }
    } finally {
      pending.current = false;
    }
  }
  return { element, active, toggle };
}
