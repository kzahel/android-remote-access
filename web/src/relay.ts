import {
  type Bytes,
  b64,
  type Channel,
  equal,
  type Identity,
  utf8,
  ViewerHandshake,
} from "@remote/protocol";
import {
  authBytes,
  fromHex,
  type Grant,
  keyBytes,
} from "@remote/protocol/enrollment";
export async function encryptedCheck(
  identity: Identity,
  grant: Grant,
): Promise<void> {
  let active = true;
  const url = new URL("/api/socket", location.origin);
  url.protocol = "wss:";
  const ws = new WebSocket(url);
  ws.binaryType = "arraybuffer";
  const queue: (Bytes | { type: string; nonce?: string })[] = [];
  let wake: (() => void) | undefined;
  let ended = false;
  ws.onmessage = (event) => {
    queue.push(
      typeof event.data === "string"
        ? JSON.parse(event.data)
        : new Uint8Array(event.data as ArrayBuffer),
    );
    wake?.();
  };
  ws.onclose = () => {
    ended = true;
    active = false;
    wake?.();
  };
  ws.onerror = () => {
    ended = true;
    active = false;
    wake?.();
  };
  async function next() {
    const deadline = Date.now() + 20000;
    while (!queue.length && !ended && Date.now() < deadline)
      await new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, Math.max(1, deadline - Date.now()));
        wake = () => {
          clearTimeout(timer);
          resolve();
        };
      });
    const value = queue.shift();
    if (!value || ended)
      throw new Error("Phone is unavailable. Open the app and try again.");
    return value;
  }
  const binary = async (): Promise<Bytes> => {
    const value = await next();
    if (!(value instanceof Uint8Array))
      throw new Error("Unexpected relay message");
    return value;
  };
  let channel: Channel | undefined;
  try {
    const challenge = await next();
    if (
      challenge instanceof Uint8Array ||
      challenge.type !== "challenge" ||
      !challenge.nonce
    )
      throw new Error("Invalid relay challenge");
    fromHex(challenge.nonce, 32);
    ws.send(
      JSON.stringify({
        id: grant.id,
        role: "viewer",
        signature: b64(
          await identity.sign(
            authBytes(location.origin, grant.id, "viewer", challenge.nonce),
          ),
        ),
      }),
    );
    let ready = false;
    while (!ready) {
      const value = await next();
      if (
        value instanceof Uint8Array ||
        !["authenticated", "ready"].includes(value.type)
      )
        throw new Error("Invalid relay state");
      ready = value.type === "ready";
    }
    const handshake = await ViewerHandshake.start(identity, {
      id: fromHex(grant.id, 16),
      generation: 1,
      peer: keyBytes(grant.phone),
      current: () => active,
    });
    ws.send(handshake.hello);
    ws.send(await handshake.answer(await binary()));
    channel = await handshake.finish(await binary());
    const canary = utf8("Encrypted connection check 🌞");
    ws.send(await channel.seal(canary));
    if (!equal(await channel.open(await binary()), canary))
      throw new Error("Connection check failed");
  } finally {
    active = false;
    channel?.close();
    ws.close();
  }
}
