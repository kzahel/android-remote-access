/** Coordinate tabs before creating sockets or wake requests. The phone still
 * enforces its own session authority across browsers and computers. */
export async function phoneLease(id: string, signal: AbortSignal) {
  const abort = () => new DOMException("Connection cancelled", "AbortError");
  if (signal.aborted) throw abort();
  if (!navigator.locks) return () => {};
  const release = await new Promise<() => void>((resolve, reject) => {
    void navigator.locks
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
      .catch(reject);
  });
  if (signal.aborted) {
    release();
    throw abort();
  }
  signal.addEventListener("abort", release, { once: true });
  return () => {
    signal.removeEventListener("abort", release);
    release();
  };
}
