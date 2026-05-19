import { createHash } from "node:crypto";

export function hashDevicePin(pkey: string, pin: string): string {
    return createHash("sha256")
        .update(`${pkey}:${pin}`, "utf8")
        .digest("hex");
}
