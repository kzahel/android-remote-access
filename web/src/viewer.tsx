import { b64 } from "@remote/protocol";
import type { ControlState } from "@remote/protocol/control";
import {
  createBytes,
  encodeInvitation,
  type Grant,
  grantBytes,
  hex,
  type Invitation,
  verifyOffer,
} from "@remote/protocol/enrollment";
import type { FeatureState, PhoneFeatures } from "@remote/protocol/features";
import { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { encode } from "uqr";
import { RemoteSession } from "./control-session.js";
import { encryptedCheck } from "./relay.js";
import { RemoteScreen } from "./remote-screen.js";
import { browserIdentity, save, savedGrant } from "./store.js";
import "./viewer.css";
async function api(id: string, action = "", body?: unknown) {
  const response = await fetch(
    `/api/pair/${id}${action ? `/${action}` : ""}`,
    body === undefined
      ? {}
      : {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        },
  );
  if (!response.ok)
    throw new Error(
      "Pairing expired, revoked, or unavailable. Try a new code.",
    );
  return response.json() as Promise<{ state: string; grant?: Grant }>;
}
function featureLabel(state: FeatureState): string {
  return state === "enabled"
    ? "Enabled on the phone"
    : state === "permission-needed"
      ? "Enable this feature in the phone app"
      : "Not available in this version";
}
function App() {
  const [grant, setGrant] = useState<Grant>();
  const [invitation, setInvitation] = useState<Invitation>();
  const [status, setStatus] = useState("Loading saved phone…");
  const [busy, setBusy] = useState(false);
  const [features, setFeatures] = useState<PhoneFeatures>();
  const [checked, setChecked] = useState(false);
  const [remote, setRemote] = useState<{
    session: RemoteSession;
    state: ControlState;
  }>();
  const connection = useRef<AbortController | undefined>(undefined);
  useEffect(
    () => () => {
      connection.current?.abort();
    },
    [],
  );
  function disconnect() {
    connection.current?.abort();
    remote?.session.close();
    setRemote(undefined);
    setBusy(false);
    setStatus("Disconnected");
  }
  useEffect(() => {
    void savedGrant()
      .then((g) => {
        setGrant(g);
        setStatus(
          g
            ? "Phone paired. Keep the phone app open to connect, or enable connection requests in Feature setup."
            : "Pair your phone to this browser.",
        );
      })
      .catch(() =>
        setStatus(
          "Browser storage is unavailable. Enable site storage to pair.",
        ),
      );
  }, []);
  useEffect(() => {
    if (!invitation) return;
    let stopped = false;
    let polling = false;
    const timer = setInterval(async () => {
      if (stopped || polling) return;
      polling = true;
      try {
        if (Date.now() >= invitation.expires * 1000)
          throw new Error("Code expired. Create a new code.");
        const result = await api(invitation.id);
        if (result.state === "offered" && result.grant) {
          const g = result.grant;
          if (stopped) return;
          await verifyOffer(invitation, g);
          const identity = await browserIdentity();
          const viewerSignature = b64(
            await identity.sign(grantBytes(invitation.origin, g)),
          );
          if (stopped) return;
          const accepted = await api(invitation.id, "complete", {
            viewerSignature,
          });
          if (stopped) return;
          if (accepted.state !== "paired") throw new Error("Pairing failed");
          const paired: Grant = { ...g, viewerSignature };
          await save("grant", paired);
          setGrant(paired);
          setInvitation(undefined);
          setStatus(
            "Phone paired. Keep the phone app open to connect, or enable connection requests in Feature setup.",
          );
        }
      } catch (error) {
        if (!stopped) {
          setInvitation(undefined);
          setStatus(error instanceof Error ? error.message : "Pairing failed");
        }
      } finally {
        polling = false;
      }
    }, 1000);
    return () => {
      stopped = true;
      clearInterval(timer);
    };
  }, [invitation]);
  async function pair() {
    setBusy(true);
    try {
      const identity = await browserIdentity();
      const i: Invitation = {
        v: 1,
        origin: location.origin,
        id: hex(crypto.getRandomValues(new Uint8Array(16))),
        viewer: b64(identity.publicKey),
        secret: hex(crypto.getRandomValues(new Uint8Array(32))),
        expires: Math.floor(Date.now() / 1000) + 300,
      };
      await api(i.id, "", {
        viewer: i.viewer,
        expires: i.expires,
        signature: b64(await identity.sign(createBytes(i.origin, i))),
      });
      setInvitation(i);
      setStatus(
        "On your phone, open Set up sharing or Add browser, tap Scan pairing code, then approve this browser.",
      );
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Pairing failed");
    } finally {
      setBusy(false);
    }
  }
  const qr = invitation
    ? encode(encodeInvitation(invitation), { ecc: "M" })
    : undefined;
  return (
    <main>
      <p className="eyebrow">Android Remote Access</p>
      <h1>Connect to your phone.</h1>
      {!grant && !invitation && (
        <p>Pair this browser once. Return here whenever you want to connect.</p>
      )}
      <p role="status">{status}</p>
      {grant ? (
        <>
          {remote ? (
            <RemoteScreen
              session={remote.session}
              initial={remote.state}
              disconnect={disconnect}
            />
          ) : (
            <button
              type="button"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                setStatus("Connecting to your phone…");
                const abort = new AbortController();
                connection.current = abort;
                try {
                  const result = await RemoteSession.connect(
                    await browserIdentity(),
                    grant,
                    setStatus,
                    abort.signal,
                  );
                  if (!abort.signal.aborted) {
                    setRemote(result);
                    setStatus("Connected securely");
                  } else result.session.close();
                } catch (error) {
                  setStatus(
                    error instanceof Error
                      ? error.message
                      : "Connection failed",
                  );
                } finally {
                  setBusy(false);
                }
              }}
            >
              Connect to phone
            </button>
          )}
          <button
            disabled={busy || !!remote}
            type="button"
            onClick={async () => {
              setBusy(true);
              setFeatures(undefined);
              setChecked(false);
              setStatus("Connecting to your phone…");
              try {
                const result = await encryptedCheck(
                  await browserIdentity(),
                  grant,
                  setStatus,
                );
                setFeatures(result);
                setChecked(true);
                setStatus("Secure connection verified.");
              } catch (error) {
                setStatus(
                  error instanceof Error ? error.message : "Connection failed",
                );
              } finally {
                setBusy(false);
              }
            }}
          >
            Check connection
          </button>
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
          <details>
            <summary>Connection help</summary>
            <p>
              Keep the Android app open to connect without additional
              permissions. For requests while it is closed, open Feature setup
              on the phone and enable connection requests.
            </p>
            <p>
              Pairing stays saved if a permission is declined. Screen viewing
              and touch control each need their own support and setup on the
              phone.
            </p>
          </details>
          <button
            className="secondary"
            disabled={busy || !!remote}
            type="button"
            onClick={async () => {
              await save("grant", undefined);
              setGrant(undefined);
              setFeatures(undefined);
              setChecked(false);
              setStatus(
                "Forgotten in this browser. Remove it in the phone app to revoke access.",
              );
            }}
          >
            Forget this phone
          </button>
        </>
      ) : (
        <button
          disabled={busy || !!invitation}
          type="button"
          onClick={() => void pair()}
        >
          Create pairing code
        </button>
      )}
      {qr && invitation && (
        <section aria-label="Pairing code">
          <svg
            role="img"
            aria-label="Scan to pair this browser"
            viewBox={`-4 -4 ${qr.size + 8} ${qr.size + 8}`}
            width="360"
            height="360"
          >
            <title>Scan to pair this browser</title>
            <rect
              x="-4"
              y="-4"
              width={qr.size + 8}
              height={qr.size + 8}
              fill="white"
            />
            <path
              fill="black"
              d={qr.data
                .flatMap((row, y) =>
                  row.map((cell, x) => (cell ? `M${x},${y}h1v1h-1z` : "")),
                )
                .join("")}
            />
          </svg>
          <p>
            This code expires after five minutes. Share it only with your phone.
          </p>
          <button
            className="secondary"
            type="button"
            onClick={() => {
              setInvitation(undefined);
              setStatus("Create a fresh code when ready.");
            }}
          >
            Cancel
          </button>
        </section>
      )}
    </main>
  );
}
const root = document.getElementById("root");
if (!root) throw new Error("Missing root");
createRoot(root).render(<App />);
