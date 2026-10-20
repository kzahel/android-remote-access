import { type Bytes, type Identity, ViewerHandshake } from "@remote/protocol";
import { fromHex, type Grant, keyBytes } from "@remote/protocol/enrollment";
import { fragmentRecord, RecordAssembler } from "@remote/protocol/framing";

/** A fresh E2E lane over ordered SCTP. Signaling is already protected by the relay lane. */
export async function openDirectLane(
  identity: Identity,
  grant: Grant,
  offer: (sdp: string) => Promise<string>,
  signal: AbortSignal,
) {
  const pc = new RTCPeerConnection({
    iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
  });
  const dc = pc.createDataChannel("remote-records", { ordered: true });
  dc.binaryType = "arraybuffer";
  const assembler = new RecordAssembler(),
    queue: Bytes[] = [];
  let active = true,
    bytesQueued = 0,
    wake: (() => void) | undefined;
  let secure: Awaited<ReturnType<ViewerHandshake["finish"]>> | undefined;
  const close = () => {
    if (!active) return;
    active = false;
    secure?.close();
    dc.close();
    pc.close();
    wake?.();
    signal.removeEventListener("abort", close);
  };
  signal.addEventListener("abort", close, { once: true });
  dc.onclose = close;
  dc.onerror = close;
  pc.onconnectionstatechange = () => {
    if (["failed", "closed", "disconnected"].includes(pc.connectionState))
      close();
  };
  dc.onmessage = (event) => {
    try {
      if (!(event.data instanceof ArrayBuffer))
        throw new Error("Invalid direct data");
      const record = assembler.accept(
        new Uint8Array(event.data),
        performance.now(),
      );
      if (!record) return;
      bytesQueued += record.length;
      if (queue.length >= 32 || bytesQueued > 2097152)
        throw new Error("Slow direct receiver");
      queue.push(record);
      wake?.();
    } catch {
      close();
    }
  };
  async function readRecord(timeout: number): Promise<Bytes | undefined> {
    const deadline = performance.now() + timeout;
    while (!queue.length && active && performance.now() < deadline)
      await new Promise<void>((resolve) => {
        const timer = setTimeout(
          resolve,
          Math.max(1, deadline - performance.now()),
        );
        wake = () => {
          clearTimeout(timer);
          resolve();
        };
      });
    if (!active) throw new Error("Direct connection ended");
    const next = queue.shift();
    if (next) bytesQueued -= next.length;
    return next;
  }
  function sendRecord(record: Bytes) {
    if (
      !active ||
      dc.readyState !== "open" ||
      dc.bufferedAmount + record.length > 1048640
    )
      throw new Error("Direct connection unavailable");
    for (const chunk of fragmentRecord(record)) dc.send(chunk);
  }
  const setupTimer = setTimeout(close, 6500);
  try {
    if (signal.aborted) throw new Error("Session ended");
    await pc.setLocalDescription(await pc.createOffer());
    await Promise.race([
      new Promise<void>((resolve) => {
        if (pc.iceGatheringState === "complete") resolve();
        else
          pc.onicegatheringstatechange = () => {
            if (pc.iceGatheringState === "complete") resolve();
          };
      }),
      new Promise<void>((resolve) => setTimeout(resolve, 1200)),
    ]);
    const sdp = pc.localDescription?.sdp;
    if (!sdp || !active) throw new Error("Direct setup unavailable");
    await pc.setRemoteDescription({ type: "answer", sdp: await offer(sdp) });
    await new Promise<void>((resolve, reject) => {
      if (dc.readyState === "open") {
        resolve();
        return;
      }
      const timer = setTimeout(
        () => reject(new Error("Direct setup timed out")),
        2500,
      );
      dc.onopen = () => {
        clearTimeout(timer);
        resolve();
      };
    });
    const handshake = await ViewerHandshake.start(identity, {
      id: fromHex(grant.id, 16),
      generation: 1,
      peer: keyBytes(grant.phone),
      current: () => active && !signal.aborted,
    });
    sendRecord(handshake.hello);
    const response = await readRecord(1200);
    if (!response) throw new Error("Missing direct handshake");
    sendRecord(await handshake.answer(response));
    const confirmation = await readRecord(1200);
    if (!confirmation) throw new Error("Missing direct confirmation");
    secure = await handshake.finish(confirmation);
    const channel = secure;
    clearTimeout(setupTimer);
    return {
      close,
      async send(bytes: Bytes) {
        sendRecord(await channel.seal(bytes));
      },
      async read(timeout = 15000) {
        const record = await readRecord(timeout);
        return record ? channel.open(record) : undefined;
      },
    };
  } catch (error) {
    close();
    throw error;
  } finally {
    clearTimeout(setupTimer);
  }
}
