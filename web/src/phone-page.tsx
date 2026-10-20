import type { ControlState } from "@remote/protocol/control";
import type { FeatureState, PhoneFeatures } from "@remote/protocol/features";
import { useCallback, useEffect, useRef, useState } from "react";
import { RemoteSession } from "./control-session.js";
import { phoneLease } from "./phone-lease.js";
import { LastContact } from "./phone-list.js";
import { encryptedCheck } from "./relay.js";
import { RemoteScreen } from "./remote-screen.js";
import {
  browserIdentity,
  contactedPhone,
  phoneName,
  type SavedPhone,
} from "./store.js";
import { ViewerHeading } from "./viewer-heading.js";
export const viewerServices = {
  connect: RemoteSession.connect,
  check: encryptedCheck,
};
export type ViewerServices = typeof viewerServices;
function featureLabel(state: FeatureState): string {
  return state === "enabled"
    ? "Enabled on the phone"
    : state === "permission-needed"
      ? "Enable this feature in the phone app"
      : "Not available in this version";
}
export function PhonePage({
  phone,
  services,
}: {
  phone: SavedPhone;
  services: ViewerServices;
}) {
  const [status, setStatus] = useState("Ready to connect");
  const [busy, setBusy] = useState(false);
  const [features, setFeatures] = useState<PhoneFeatures>();
  const [checked, setChecked] = useState(false);
  const [remote, setRemote] = useState<{
    session: RemoteSession;
    state: ControlState;
  }>();
  const [storageWarning, setStorageWarning] = useState("");
  const connection = useRef<AbortController | undefined>(undefined);
  const live = useRef<RemoteSession | undefined>(undefined);
  const release = useRef<(() => void) | undefined>(undefined);
  const lastRecorded = useRef(0);
  const close = useCallback(() => {
    connection.current?.abort();
    live.current?.close();
    release.current?.();
    release.current = undefined;
  }, []);
  useEffect(() => {
    const restored = (event: PageTransitionEvent) => {
      if (event.persisted) {
        close();
        setRemote(undefined);
        setBusy(false);
        setStatus("Disconnected");
      }
    };
    window.addEventListener("pagehide", close);
    window.addEventListener("pageshow", restored);
    return () => {
      window.removeEventListener("pagehide", close);
      window.removeEventListener("pageshow", restored);
      close();
    };
  }, [close]);
  function recordContact(state?: ControlState, force = false) {
    if (
      !force &&
      Date.now() - lastRecorded.current < 15000 &&
      (!state?.phoneName || state.phoneName === phone.model)
    )
      return;
    lastRecorded.current = Date.now();
    void contactedPhone(phone.id, state?.phoneName).catch(() =>
      setStorageWarning(
        "Connected, but contact history couldn’t be saved in this browser.",
      ),
    );
  }
  function disconnect() {
    close();
    setRemote(undefined);
    setBusy(false);
    setStatus("Disconnected");
  }
  async function start(mode: "control" | "check") {
    const abort = new AbortController();
    connection.current = abort;
    setBusy(true);
    setStatus("Connecting to your phone…");
    if (mode === "check") {
      setFeatures(undefined);
      setChecked(false);
    }
    let ownedLease: (() => void) | undefined;
    let connected = false;
    try {
      ownedLease = await phoneLease(phone.id, abort.signal);
      release.current = ownedLease;
      const identity = await browserIdentity();
      if (abort.signal.aborted) return;
      const report = (message: string) => {
        if (!abort.signal.aborted) setStatus(message);
      };
      if (mode === "control") {
        const result = await services.connect(
          identity,
          phone.grant,
          report,
          abort.signal,
        );
        if (abort.signal.aborted) {
          result.session.close();
          return;
        }
        connected = true;
        live.current = result.session;
        setRemote(result);
        recordContact(result.state, true);
      } else {
        const result = await services.check(
          identity,
          phone.grant,
          report,
          abort.signal,
        );
        if (abort.signal.aborted) return;
        setFeatures(result);
        setChecked(true);
        recordContact(undefined, true);
        setStatus("Secure connection verified.");
      }
    } catch (error) {
      if (!abort.signal.aborted)
        setStatus(error instanceof Error ? error.message : "Connection failed");
    } finally {
      if (!connected) {
        ownedLease?.();
        if (release.current === ownedLease) release.current = undefined;
      }
      if (!abort.signal.aborted) setBusy(false);
    }
  }
  return (
    <main className={remote ? "connected-viewer" : "phone-page"}>
      {remote ? (
        <RemoteScreen
          session={remote.session}
          initial={remote.state}
          name={phoneName(phone)}
          notice={storageWarning}
          onContact={recordContact}
          onEnded={() => {
            release.current?.();
            release.current = undefined;
          }}
          disconnect={disconnect}
        />
      ) : (
        <>
          <ViewerHeading
            name={phoneName(phone)}
            status={storageWarning || status}
          />
          <p className="contact-detail">
            <LastContact at={phone.lastContactAt} />
          </p>
          <button
            type="button"
            disabled={busy}
            onClick={() => void start("control")}
          >
            Connect to phone
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => void start("check")}
          >
            Check connection
          </button>
          {busy && (
            <button
              className="secondary"
              type="button"
              onClick={() => {
                close();
                setBusy(false);
                setStatus("Connection cancelled");
              }}
            >
              Cancel connection
            </button>
          )}
          {features && (
            <section aria-label="Phone features">
              <h2>Phone features</h2>
              <dl>
                <dt>Screen viewing</dt>
                <dd>{featureLabel(features.screenViewing)}</dd>
                <dt>Touch control</dt>
                <dd>{featureLabel(features.touchControl)}</dd>
                <dt>Connection requests while the app is closed</dt>
                <dd>
                  {features.connectionRequests === "enabled"
                    ? "Enabled on the phone"
                    : features.connectionRequests === "off"
                      ? "Off · Enable in the phone app’s Feature setup"
                      : features.connectionRequests === "notifications-needed"
                        ? "Notifications needed · Enable them on the phone"
                        : features.connectionRequests === "setup-needed"
                          ? "Setup incomplete · Review connection settings on the phone"
                          : "Unavailable in this installation"}
                </dd>
              </dl>
              <p className="hint">
                Reported by your phone during this connection. Check again after
                changing its settings.
              </p>
            </section>
          )}
          {checked && !features && (
            <p>
              Feature status is unavailable from this phone. Update its app to
              see setup guidance.
            </p>
          )}
        </>
      )}
    </main>
  );
}
