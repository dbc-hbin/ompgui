import { isValidWebPassword, isWebPasswordEnabled } from "../web-auth";
import type { RelayHelloFrame } from "./protocol";
import { authenticateDeviceToken, consumePairingSecret } from "./registry";

export type RelayAuthSuccess = {
  ok: true;
  serverId: string;
  deviceId: string;
  token?: string;
};

export type RelayAuthFailure = {
  ok: false;
  code: string;
  message: string;
};

export function authenticateRelayHello(hello: RelayHelloFrame, now = Date.now()): RelayAuthSuccess | RelayAuthFailure {
  if (hello.pairingSecret) {
    if (isWebPasswordEnabled() && !isValidWebPassword(hello.password ?? "")) {
      return { ok: false, code: "password_required", message: "Workspace password is required to pair" };
    }
    const result = consumePairingSecret(hello.pairingSecret, hello.label, now);
    if ("error" in result) {
      if (result.error === "expired") {
        return { ok: false, code: "pairing_expired", message: "Pairing link expired" };
      }
      if (result.error === "device_limit") {
        return { ok: false, code: "device_limit", message: "Too many paired devices" };
      }
      return { ok: false, code: "unauthorized", message: "Invalid pairing secret" };
    }
    return { ok: true, serverId: result.serverId, deviceId: result.deviceId, token: result.token };
  }

  if (!hello.deviceId || !hello.token) {
    return { ok: false, code: "unauthorized", message: "Device token is required" };
  }
  const device = authenticateDeviceToken(hello.deviceId, hello.token, now);
  if (!device) return { ok: false, code: "unauthorized", message: "Unknown device" };
  return { ok: true, serverId: device.serverId, deviceId: device.deviceId };
}
