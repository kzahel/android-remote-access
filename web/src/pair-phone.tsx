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
import { encode } from "uqr";
import { browserName } from "./browser-name.js";
import { browserIdentity, phoneURL, rememberPhone } from "./store.js";
import { ViewerHeading } from "./viewer-heading.js";

async function api(
  id: string,
  action = "",
  body?: unknown,
  wait?: { seen: string; signal: AbortSignal },
) {
  const response = await fetch(
    `/api/pair/${id}${action ? `/${action}` : ""}`,
    body === undefined
      ? wait
        ? // The relay holds this poll until the state differs from `seen`.
          { headers: { "Pair-Wait": wait.seen }, signal: wait.signal }
        : {}
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
export function PairPhone() {
  const [alias, setAlias] = useState("");
  const [invitation, setInvitation] = useState<Invitation>();
  const [status, setStatus] = useState(
    "On the phone, choose Add browser or Set up sharing, then scan the code.",
  );
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!invitation) return;
    const abort = new AbortController();
    const stopped = () => abort.signal.aborted;
    void (async () => {
      let seen = "waiting";
      try {
        while (!stopped()) {
          if (Date.now() >= invitation.expires * 1000)
            throw new Error("Code expired. Create a new code.");
          const asked = Date.now();
          const result = await api(invitation.id, "", undefined, {
            seen,
            signal: abort.signal,
          });
          if (result.state === "offered" && result.grant) {
            const g = result.grant;
            await verifyOffer(invitation, g);
            const identity = await browserIdentity();
            const viewerSignature = b64(
              await identity.sign(grantBytes(invitation.origin, g)),
            );
            if (stopped()) return;
            const accepted = await api(invitation.id, "complete", {
              viewerSignature,
            });
            if (stopped()) return;
            if (accepted.state !== "paired") throw new Error("Pairing failed");
            const paired: Grant = { ...g, viewerSignature };
            const id = await rememberPhone(paired, alias);
            location.assign(phoneURL(id));
            return;
          }
          seen = result.state;
          // A relay without held polls answers at once; keep the earlier pace.
          if (Date.now() - asked < 500)
            await new Promise((resolve) => setTimeout(resolve, 1000));
        }
      } catch (error) {
        if (!stopped()) {
          setInvitation(undefined);
          setStatus(error instanceof Error ? error.message : "Pairing failed");
        }
      }
    })();
    return () => abort.abort();
  }, [invitation, alias]);
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
        name: browserName(),
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
      <ViewerHeading name="Add phone" status={status} />
      <p>Pair each phone once. Your other saved phones will stay available.</p>
      {!invitation && (
        <label>
          Phone name (optional)
          <input
            value={alias}
            disabled={busy}
            maxLength={60}
            placeholder="For example, Travel phone"
            onChange={(event) => setAlias(event.target.value)}
          />
        </label>
      )}
      <button
        disabled={busy || !!invitation}
        type="button"
        onClick={() => void pair()}
      >
        Create pairing code
      </button>
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
