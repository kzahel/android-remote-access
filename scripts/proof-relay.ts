/** Test-only cookie admission for the isolated Cloudflare acceptance deployment. */
import { readFile, stat } from "node:fs/promises";
import type { BrowserContext } from "@playwright/test";
export async function admitProofBrowser(
  context: BrowserContext,
  origin: string,
) {
  const file = process.env.HOSTED_PROOF_SECRETS;
  if (!file) return;
  const host = new URL(origin).hostname;
  if (
    !host.startsWith("yepcontrol-relay-proof.") ||
    !host.endsWith(".workers.dev") ||
    process.env.HOSTED_DEVICE
  )
    throw new Error(
      "Proof admission only supports the isolated service and owned emulator",
    );
  if (((await stat(file)).mode & 0o077) !== 0)
    throw new Error("Proof secrets must be owner-only");
  const key: string = JSON.parse(await readFile(file, "utf8")).PROOF_KEY;
  if (!/^[0-9a-f]{64}$/.test(key)) throw new Error("Invalid proof key");
  await context.addCookies([
    {
      name: "__Host-yepcontrol-proof",
      value: key,
      url: origin,
      httpOnly: true,
      secure: true,
      sameSite: "Strict",
    },
  ]);
}
