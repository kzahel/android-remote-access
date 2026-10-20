import { firebaseSender } from "./push.js";
import { createRelay } from "./server.js";

const port = Number(process.env.PORT ?? "4888");
if (!Number.isInteger(port) || port < 1 || port > 65535)
  throw new Error("Invalid port");
const origin = process.env.PUBLIC_ORIGIN;
const stateDir = process.env.STATE_DIRECTORY;
if (!origin || !stateDir)
  throw new Error("PUBLIC_ORIGIN and STATE_DIRECTORY required");
const push = process.env.FIREBASE_PROJECT_ID
  ? firebaseSender(process.env.FIREBASE_PROJECT_ID)
  : undefined;
const relay = createRelay({
  ...(push ? { sender: push.send } : {}),
  origin,
  stateDir,
  revision: process.env.REVISION ?? "development",
  trustProxy: process.env.TRUST_PROXY === "loopback",
});
relay.server.listen(port, "127.0.0.1", () =>
  console.log("Remote access development relay listening"),
);
for (const signal of ["SIGINT", "SIGTERM"] as const)
  process.once(signal, () => {
    void relay
      .close()
      .then(() => push?.close())
      .then(() => process.exit(0));
  });
