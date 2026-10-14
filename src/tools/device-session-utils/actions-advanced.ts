import fs from "fs";
import path from "path";
import { BrowserStackConfig } from "../../lib/types.js";
import { validateUploadPath } from "../../lib/upload-validator.js";
import appConfig from "../../config.js";
import { annotate, DeviceToolError, onDevice } from "./actions.js";
import { MEDIA_EXTENSIONS, updateSessionNetwork } from "./rest.js";
import { DeviceSession } from "./session.js";

/**
 * App Automate capabilities beyond basic input: biometric,
 * adb shell, files, camera injection, GPS and network. Each is a thin call
 * onto a BrowserStack executor, Appium command, or REST endpoint.
 */

async function executor(b: any, action: string, args: Record<string, unknown>) {
  return b.execute(
    `browserstack_executor: ${JSON.stringify({ action, arguments: args })}`,
  );
}

/** The session must have been started with enableBiometric. */
export async function simulateBiometric(
  session: DeviceSession,
  match: "pass" | "fail",
): Promise<string> {
  await onDevice(session, "Biometric", (b) =>
    executor(b, "biometric", { biometricMatch: match }),
  );
  const done = `Biometric prompt answered: ${match}`;
  await annotate(session, done);
  return done;
}

// Allow-list: the read-only families BrowserStack's own adbShell
// executor serves (it further restricts exact arguments, and rejects
// settings/input/am/wm outright — verified live).
const ADB_ALLOWED: Record<string, RegExp | null> = {
  getprop: null,
  dumpsys: null,
  pm: /^(list)$/,
};

export function checkAdbCommand(command: string): string {
  const trimmed = command.trim();
  if (!trimmed) throw new DeviceToolError("command is empty.");
  if (/[;&|`$<>\\\n\r]/.test(trimmed)) {
    throw new DeviceToolError(
      "Shell operators (; & | ` $ < > \\ newlines) are not allowed: run one command at a time.",
    );
  }
  const [cmd, sub] = trimmed.split(/\s+/);
  if (!(cmd in ADB_ALLOWED)) {
    throw new DeviceToolError(
      `"${cmd}" is not on the allowed list. Allowed: ${Object.entries(
        ADB_ALLOWED,
      )
        .map(([c, r]) => (r ? `${c} ${r.source.replace(/[\^$()]/g, "")}` : c))
        .join("; ")}.`,
    );
  }
  const rule = ADB_ALLOWED[cmd];
  if (rule && !rule.test(sub || "")) {
    throw new DeviceToolError(
      `"${cmd} ${sub ?? ""}" is not allowed. Allowed subcommands: ${rule.source.replace(/[\^$()]/g, "")}.`,
    );
  }
  return trimmed;
}

/** Android only, allow-listed commands, via BrowserStack's adbShell executor. */
export async function runAdbShell(
  session: DeviceSession,
  command: string,
): Promise<string> {
  if (session.platform !== "android") {
    throw new DeviceToolError("adb shell is only available on Android.");
  }
  const safe = checkAdbCommand(command);
  const out = await onDevice(session, "adb shell", (b) =>
    executor(b, "adbShell", { command: safe }),
  );
  await annotate(
    session,
    `adb shell: ${safe.split(/\s+/).slice(0, 2).join(" ")}`,
  );
  const text = typeof out === "string" ? out : JSON.stringify(out ?? "");
  return text.length > 20_000
    ? `${text.slice(0, 20_000)}\n… truncated (${text.length - 20_000} more characters)`
    : text || "(no output)";
}

const MAX_PUSH_BYTES = 10 * 1024 * 1024;

// Fixed list: test data a device might need. Never derived from the input path.
export const PUSH_EXTENSIONS = [
  ...MEDIA_EXTENSIONS,
  ".json",
  ".xml",
  ".html",
  ".log",
  ".md",
] as const;
const MAX_PULL_BYTES = 5 * 1024 * 1024;

/** Push a local file (inside MCP_UPLOAD_BASE_DIR) or inline text onto the device. */
export async function pushFile(
  session: DeviceSession,
  args: { devicePath: string; filePath?: string; text?: string },
): Promise<string> {
  if (!!args.filePath === (args.text !== undefined)) {
    throw new DeviceToolError("Provide exactly one of filePath or text.");
  }
  let data: Buffer;
  if (args.filePath) {
    if (appConfig.REMOTE_MCP) {
      throw new DeviceToolError(
        "Pushing a local file is not available on the remote server; pass the content as text instead.",
      );
    }
    const safe = validateUploadPath(args.filePath, {
      allowedExtensions: PUSH_EXTENSIONS,
      maxSizeBytes: MAX_PUSH_BYTES,
      allowedBaseDir: appConfig.UPLOAD_BASE_DIR,
    });
    data = fs.readFileSync(safe);
  } else {
    data = Buffer.from(args.text!, "utf8");
  }
  await onDevice(session, "Push file", (b) =>
    b.pushFile(args.devicePath, data.toString("base64")),
  );
  const done = `Pushed ${data.length} byte(s) to ${args.devicePath}`;
  await annotate(session, done);
  return done;
}

export interface PulledFile {
  bytes: number;
  text?: string;
  imageBase64?: string;
  mimeType?: string;
  base64?: string;
}

/** Read a file from the device. */
export async function pullFile(
  session: DeviceSession,
  devicePath: string,
): Promise<PulledFile> {
  const b64: string = await onDevice(session, "Pull file", (b) =>
    b.pullFile(devicePath),
  );
  const buf = Buffer.from(b64 || "", "base64");
  if (buf.length > MAX_PULL_BYTES) {
    throw new DeviceToolError(
      `${devicePath} is ${buf.length} bytes; the limit is ${MAX_PULL_BYTES}.`,
    );
  }
  const ext = path.extname(devicePath).toLowerCase();
  const image = {
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".gif": "image/gif",
  }[ext];
  if (image) return { bytes: buf.length, imageBase64: b64, mimeType: image };
  const asText = buf.toString("utf8");
  // Treat as text when it decodes cleanly and has no control bytes.
  if (
    !asText.includes("�") &&
    ![...asText].some((c) => {
      const n = c.charCodeAt(0);
      return n < 9 || (n > 13 && n < 32);
    })
  ) {
    return { bytes: buf.length, text: asText };
  }
  return { bytes: buf.length, base64: b64 };
}

/** The session must have been started with enableCameraImageInjection. */
export async function injectCameraImage(
  session: DeviceSession,
  imageUrl: string,
): Promise<string> {
  if (!/^media:\/\//.test(imageUrl)) {
    throw new DeviceToolError(
      "imageUrl must be a media:// URL from uploadMediaFile.",
    );
  }
  await onDevice(session, "Camera image injection", (b) =>
    executor(b, "cameraImageInjection", { imageUrl }),
  );
  const done = `Camera will now see ${imageUrl}`;
  await annotate(session, done);
  return done;
}

/** Change the simulated GPS location mid-session. */
export async function setLocation(
  session: DeviceSession,
  loc: { latitude: number; longitude: number; altitude?: number },
): Promise<string> {
  await onDevice(session, "Set location", (b) =>
    b.setGeoLocation({
      latitude: loc.latitude,
      longitude: loc.longitude,
      altitude: loc.altitude ?? 0,
    }),
  );
  const done = `GPS set to ${loc.latitude},${loc.longitude}`;
  await annotate(session, done);
  return done;
}

/**
 * Change network conditions mid-session through the App Automate REST API. Mid-session
 * updates accept named profiles only (custom values are rejected with 422).
 */
export async function setNetwork(
  session: DeviceSession,
  profile: string,
  config: BrowserStackConfig,
): Promise<string> {
  await updateSessionNetwork(
    session.sessionId,
    { networkProfile: profile },
    config,
  );
  session.lastActionAt = Date.now();
  const done = `Network profile set to ${profile}`;
  await annotate(session, done);
  return done;
}
