import test from "node:test";
import assert from "node:assert/strict";
import { normalizeStoredData } from "../src/storedData";
import type { DuoDevice } from "../src/types";

function createDevice(overrides: Partial<DuoDevice> = {}): DuoDevice {
    return {
        pkey: "device-1",
        host: "api-123456789012345678901234.duosecurity.com",
        publicRaw: "public",
        privateRaw: "private",
        name: "Work Phone",
        ...overrides,
    };
}

test("normalizeStoredData returns fallback for invalid input", () => {
    assert.deepEqual(normalizeStoredData(null as never), { activeDevice: -1, devices: [] });
});

test("normalizeStoredData loads browser export keyed by device ids", () => {
    const first = createDevice();
    const second = createDevice({ pkey: "device-2", name: "Backup Phone" });

    const normalized = normalizeStoredData({
        activeDevice: "device-2",
        devices: ["device-1", "device-2"],
        "device-1": first,
        "device-2": second,
    });

    assert.equal(normalized.activeDevice, "device-2");
    assert.deepEqual(normalized.devices, [first, second]);
});

test("normalizeStoredData falls back to the first device when active device is missing", () => {
    const first = createDevice();
    const second = createDevice({ pkey: "device-2" });

    const normalized = normalizeStoredData({
        activeDevice: "missing-device",
        devices: [first, second],
    });

    assert.equal(normalized.activeDevice, "device-1");
    assert.equal(normalized.devices.length, 2);
});

test("normalizeStoredData wraps a single Duo device payload", () => {
    const device = createDevice();
    const normalized = normalizeStoredData(device);

    assert.equal(normalized.activeDevice, device.pkey);
    assert.deepEqual(normalized.devices, [device]);
});

test("normalizeStoredData preserves persisted device timestamps", () => {
    const device = createDevice({ lastUsedAt: "2026-05-13T12:00:00.000Z" });

    const normalized = normalizeStoredData({
        activeDevice: device.pkey,
        devices: [device],
    });

    assert.equal(normalized.devices[0]?.lastUsedAt, "2026-05-13T12:00:00.000Z");
});