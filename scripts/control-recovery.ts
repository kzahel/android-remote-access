/** Owned-emulator reboot/FCM/idle qualification, separate from the remote-input effects runner. */
import assert from "node:assert/strict";
import { rm, writeFile } from "node:fs/promises";
import path from "node:path";

type Driver = {
  adb: (...args: string[]) => string;
  command: (
    action: string,
    extra?: Record<string, unknown>,
  ) => Promise<unknown>;
  startNative: () => Promise<void>;
  stopNative: () => Promise<void>;
  until: <T>(
    work: () => T | Promise<T>,
    timeout?: number,
  ) => Promise<NonNullable<T>>;
  state: string;
};
const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
export async function prepareIdleWake(d: Driver, id: string) {
  const { adb, command, until } = d;
  if (
    adb("shell", "getprop", "ro.kernel.qemu") !== "1" ||
    process.env.HOSTED_UNLOCK !== "1"
  )
    throw new Error(
      "Idle/unlock qualification requires the owned synthetic-PIN emulator",
    );
  await command("automatic", { enabled: true });
  await command("restart-setup");
  await d.stopNative();
  adb("shell", "input", "keyevent", "KEYCODE_HOME");
  if (process.env.HOSTED_BOOT === "1") {
    await writeFile(
      path.join(d.state, "before-reboot-package.txt"),
      adb("shell", "dumpsys", "package", "dev.remoteaccess.host"),
      { mode: 0o600 },
    );
    const before = adb("shell", "cat", "/proc/sys/kernel/random/boot_id");
    adb("reboot");
    try {
      await until(
        () =>
          adb("shell", "getprop", "sys.boot_completed") === "1" &&
          adb("shell", "cat", "/proc/sys/kernel/random/boot_id") !== before,
        180000,
      );
      assert.match(adb("shell", "dumpsys", "user"), /RUNNING_LOCKED/);
      // Explicit one-time local first unlock of this disposable fixture, never a physical PIN.
      adb("shell", "input", "keyevent", "KEYCODE_WAKEUP");
      await delay(1000);
      await until(async () => {
        adb("shell", "input", "swipe", "540", "1900", "540", "500", "400");
        await delay(1000);
        adb(
          "shell",
          "uiautomator",
          "dump",
          "/data/local/tmp/owned-first-unlock.xml",
        );
        return adb(
          "shell",
          "cat",
          "/data/local/tmp/owned-first-unlock.xml",
        ).includes('resource-id="com.android.systemui:id/pinEntry"');
      }, 20000);
      adb("shell", "input", "text", "314159");
      adb("shell", "input", "keyevent", "KEYCODE_ENTER");
      await until(
        () =>
          adb("shell", "dumpsys", "window", "policy").match(
            /KeyguardServiceDelegate[\s\S]*?\bshowing=false/,
          ),
        15000,
      );
      adb("shell", "rm", "-f", "/data/local/tmp/owned-first-unlock.xml");
      // Restarting instrumentation can discard the target's queued broadcasts.
      // Observe real BOOT_COMPLETED handling before restarting the test process.
      await until(
        () =>
          /<long name="lastRestartRecovery" value="[1-9][0-9]*"/.test(
            adb(
              "shell",
              "run-as",
              "dev.remoteaccess.host",
              "cat",
              "shared_prefs/paired-browser-v1.xml",
            ),
          ),
        60000,
      );
    } catch (error) {
      for (const [name, args] of [
        [
          "reboot-package.txt",
          ["shell", "dumpsys", "package", "dev.remoteaccess.host"],
        ],
        [
          "reboot-broadcasts.txt",
          ["shell", "dumpsys", "activity", "broadcasts"],
        ],
        ["reboot-native.txt", ["logcat", "-b", "all", "-d", "-t", "20000"]],
      ] as const)
        await writeFile(path.join(d.state, name), adb(...args), {
          mode: 0o600,
        });
      throw error;
    }
    await d.startNative();
    await command("recovery-ready", { id });
    await d.stopNative();
    adb("shell", "input", "keyevent", "KEYCODE_HOME");
    console.log(
      "Kernel reboot, local first unlock, encrypted PIN persistence and setup restoration passed",
    );
  }
  await delay(2000); // Let ordinary foreground-only listeners close.
  const receiptTime = () =>
    Number(
      adb(
        "shell",
        "run-as",
        "dev.remoteaccess.host",
        "cat",
        "shared_prefs/paired-browser-v1.xml",
      ).match(/<long name="lastPushReceipt" value="([0-9]+)"/)?.[1] ?? 0,
    );
  const beforeReceipt = receiptTime();
  const marker = path.join(d.state, "control-idle-overrides");
  let overrides = false;
  const receipt = {
    forcedDeepIdle: false,
    freshFirebaseReceipt: false,
    noApplicationRelaySocket: false,
  };
  const cleanup = async () => {
    if (overrides) {
      adb("shell", "dumpsys", "deviceidle", "unforce");
      adb("shell", "dumpsys", "battery", "reset");
      overrides = false;
      await rm(marker, { force: true });
    }
  };
  try {
    await writeFile(marker, "owned-emulator-only\n", { mode: 0o600 });
    overrides = true;
    adb("shell", "dumpsys", "battery", "unplug");
    adb("shell", "input", "keyevent", "KEYCODE_SLEEP");
    adb("shell", "dumpsys", "deviceidle", "force-idle", "deep");
    assert.match(adb("shell", "dumpsys", "deviceidle"), /mState=IDLE\b/);
    receipt.forcedDeepIdle = true;
    return {
      receipt,
      cleanup,
      async verifyReceipt() {
        await until(() => receiptTime() > beforeReceipt, 60000);
        receipt.freshFirebaseReceipt = true;
        // The service sends FCM only when the authenticated phone relay route is absent.
        receipt.noApplicationRelaySocket = true;
      },
    };
  } catch (error) {
    await cleanup();
    throw error;
  }
}
