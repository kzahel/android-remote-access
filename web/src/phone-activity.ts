import { useEffect, useState } from "react";

const prefix = "remote-access-phone:";
const changes = new EventTarget();
const channel =
  typeof BroadcastChannel === "undefined"
    ? undefined
    : new BroadcastChannel("remote-access-activity");
export function activityChanged() {
  changes.dispatchEvent(new Event("change"));
  channel?.postMessage("change");
}
/** Browser-held leases mean "in use", not global phone reachability. Querying
 * local locks also recovers from a tab disappearing without sending a message. */
export function usePhoneActivity(): ReadonlySet<string> {
  const [active, setActive] = useState<ReadonlySet<string>>(new Set());
  useEffect(() => {
    let stopped = false;
    let generation = 0;
    async function refresh() {
      if (!navigator.locks || document.visibilityState !== "visible") return;
      const current = ++generation;
      try {
        const snapshot = await navigator.locks.query();
        if (!stopped && generation === current)
          setActive(
            new Set(
              snapshot.held?.flatMap((lock) =>
                lock.name?.startsWith(prefix)
                  ? [lock.name.slice(prefix.length)]
                  : [],
              ),
            ),
          );
      } catch {
        /* Phone/relay admission remains authoritative without lock queries. */
      }
    }
    const update = () => {
      void refresh();
    };
    changes.addEventListener("change", update);
    channel?.addEventListener("message", update);
    window.addEventListener("focus", update);
    document.addEventListener("visibilitychange", update);
    const timer = setInterval(update, 10000);
    update();
    return () => {
      stopped = true;
      clearInterval(timer);
      changes.removeEventListener("change", update);
      channel?.removeEventListener("message", update);
      window.removeEventListener("focus", update);
      document.removeEventListener("visibilitychange", update);
    };
  }, []);
  return active;
}
