import { activityChanged } from "./phone-activity.js";
/** Coordinate tabs before creating sockets or wake requests. The phone still
 * enforces its own session authority across browsers and computers. */
export async function phoneLease(id: string, signal: AbortSignal) {
  const abort = () => new DOMException("Connection cancelled", "AbortError");
  if (signal.aborted) throw abort();
  if (!navigator.locks) return () => {};
  let held: Promise<void> = Promise.resolve();
  const release = await new Promise<() => void>((resolve, reject) => {
    held = navigator.locks
      .request(`remote-access-phone:${id}`, { ifAvailable: true }, (lock) => {
        if (!lock) {
          reject(
            new Error(
              "This phone is already in use in another tab. Disconnect there before connecting here.",
            ),
          );
          return;
        }
        return new Promise<void>((done) => resolve(done));
      })
      .then(() => {});
    void held.catch(reject);
  });
  let released = false;
  const close = () => {
    if (released) return;
    released = true;
    signal.removeEventListener("abort", close);
    release();
    void held.then(activityChanged);
  };
  if (signal.aborted) {
    close();
    throw abort();
  }
  signal.addEventListener("abort", close, { once: true });
  activityChanged();
  return close;
}
