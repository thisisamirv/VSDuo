import { BrowserExportShape, DuoDevice, StoredDeviceData } from "./types";

export function normalizeStoredData(raw: BrowserExportShape | StoredDeviceData): StoredDeviceData {
    const fallback: StoredDeviceData = { activeDevice: -1, devices: [] };
    if (!raw || typeof raw !== "object") {
        return fallback;
    }

    const rawRecord = raw as Record<string, unknown>;

    if ("devices" in raw && Array.isArray(raw.devices)) {
        const rawDevices: unknown[] = raw.devices;
        const stringDevices: string[] = rawDevices.filter((device): device is string => typeof device === "string");
        const objectDevices: DuoDevice[] = rawDevices.filter(
            (device): device is DuoDevice => typeof device === "object" && device !== null && "pkey" in device
        );
        const devices: DuoDevice[] = objectDevices.length
            ? objectDevices
            : stringDevices
                .map((key) => rawRecord[key])
                .filter((device): device is DuoDevice => typeof device === "object" && device !== null && "pkey" in device);

        const activeCandidate = raw.activeDevice ?? devices[0]?.pkey ?? -1;
        const activeDevice = activeCandidate !== -1 && devices.some((device) => device.pkey === activeCandidate) ? activeCandidate : devices[0]?.pkey ?? -1;
        return {
            activeDevice,
            devices,
        };
    }

    if ("pkey" in raw && typeof raw.pkey === "string") {
        const device = raw as DuoDevice;
        return {
            activeDevice: device.pkey,
            devices: [device],
        };
    }

    return fallback;
}