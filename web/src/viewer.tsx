import { b64 } from "@remote/protocol";
import {
  createBytes,
  encodeInvitation,
  type Grant,
  grantBytes,
  hex,
  type Invitation,
  verifyOffer,
} from "@remote/protocol/enrollment";
import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { encode } from "uqr";
import { encryptedCheck } from "./relay.js";
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
function App() {
  const [grant, setGrant] = useState<Grant>();
  const [invitation, setInvitation] = useState<Invitation>();
  const [status, setStatus] = useState("Loading saved phone…");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    void savedGrant()
      .then((g) => {
        setGrant(g);
        setStatus(
          g
            ? "Phone paired. Open the Android app to check the connection."
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
            "Phone paired. Open the Android app to check the connection.",
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
        "In the Android app, tap Pair browser, scan this code, then tap Grant.",
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
      <p className="eyebrow">Android Remote Access · Development</p>
      <h1>Reach your phone.</h1>
      <p>
        Pairing and encrypted connection checks are available. Screen viewing
        and control are coming next.
      </p>
      <p role="status">{status}</p>
      {grant ? (
        <>
          <button
            disabled={busy}
            type="button"
            onClick={async () => {
              setBusy(true);
              setStatus("Connecting to your phone…");
              try {
                await encryptedCheck(await browserIdentity(), grant);
                setStatus("Encrypted connection passed.");
              } catch (error) {
                setStatus(
                  error instanceof Error ? error.message : "Connection failed",
                );
              } finally {
                setBusy(false);
              }
            }}
          >
            Check encrypted connection
          </button>
          <button
            className="secondary"
            disabled={busy}
            type="button"
            onClick={async () => {
              await save("grant", undefined);
              setGrant(undefined);
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
