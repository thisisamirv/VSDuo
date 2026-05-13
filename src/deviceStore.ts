import * as vscode from "vscode";
import { BrowserExportShape, DuoDevice, StoredDeviceData } from "./types";
import { normalizeStoredData } from "./storedData";

const STORAGE_KEY = "vsduo.devices";

export class DeviceStore {
    public constructor(private readonly context: vscode.ExtensionContext) { }

    public async getData(): Promise<StoredDeviceData> {
        const raw = await this.context.secrets.get(STORAGE_KEY);
        if (!raw) {
            return { activeDevice: -1, devices: [] };
        }

        return normalizeStoredData(JSON.parse(raw) as BrowserExportShape | StoredDeviceData);
    }

    public async saveData(data: StoredDeviceData): Promise<void> {
        const normalized = normalizeStoredData(data);
        await this.context.secrets.store(STORAGE_KEY, JSON.stringify(normalized));
    }

    public async addDevice(device: DuoDevice): Promise<StoredDeviceData> {
        const data = await this.getData();
        const devices = data.devices.filter((entry) => entry.pkey !== device.pkey);
        devices.push({
            ...device,
            lastUsedAt: device.lastUsedAt ?? new Date().toISOString(),
        });
        const next: StoredDeviceData = {
            activeDevice: device.pkey,
            devices,
        };
        await this.saveData(next);
        return next;
    }

    public async setActiveDevice(pkey: string): Promise<StoredDeviceData> {
        const data = await this.getData();
        if (!data.devices.some((device) => device.pkey === pkey)) {
            throw new Error(`Unknown device: ${pkey}`);
        }

        const next: StoredDeviceData = {
            ...data,
            activeDevice: pkey,
            devices: data.devices.map((device) => device.pkey === pkey ? { ...device, lastUsedAt: new Date().toISOString() } : device),
        };
        await this.saveData(next);
        return next;
    }

    public async markDeviceUsed(pkey: string, when = new Date().toISOString()): Promise<StoredDeviceData> {
        const data = await this.getData();
        const devices = data.devices.map((device) => device.pkey === pkey ? { ...device, lastUsedAt: when } : device);
        if (!devices.some((device) => device.pkey === pkey)) {
            throw new Error(`Unknown device: ${pkey}`);
        }

        const next: StoredDeviceData = {
            ...data,
            devices,
        };
        await this.saveData(next);
        return next;
    }

    public async renameDevice(pkey: string, name: string): Promise<StoredDeviceData> {
        const data = await this.getData();
        const devices = data.devices.map((device) => device.pkey === pkey ? { ...device, name } : device);
        if (!devices.some((device) => device.pkey === pkey)) {
            throw new Error(`Unknown device: ${pkey}`);
        }

        const next: StoredDeviceData = {
            ...data,
            devices,
        };
        await this.saveData(next);
        return next;
    }

    public async removeDevice(pkey: string): Promise<StoredDeviceData> {
        const data = await this.getData();
        const devices = data.devices.filter((device) => device.pkey !== pkey);
        if (devices.length === data.devices.length) {
            throw new Error(`Unknown device: ${pkey}`);
        }

        const next: StoredDeviceData = {
            activeDevice: data.activeDevice === pkey ? devices[0]?.pkey ?? -1 : data.activeDevice,
            devices,
        };
        await this.saveData(next);
        return next;
    }

    public async clear(): Promise<void> {
        await this.context.secrets.delete(STORAGE_KEY);
    }

    public async importSerialized(input: string): Promise<StoredDeviceData> {
        let parsed: unknown;
        try {
            parsed = JSON.parse(input);
        } catch {
            const decoded = Buffer.from(input, "base64").toString("utf8");
            parsed = JSON.parse(decoded);
        }

        const normalized = normalizeStoredData(parsed as BrowserExportShape | StoredDeviceData);
        await this.saveData(normalized);
        return normalized;
    }

    public async exportSerialized(base64Encode = true): Promise<string> {
        const data = await this.getData();
        const json = JSON.stringify(data, null, 2);
        return base64Encode ? Buffer.from(json, "utf8").toString("base64") : json;
    }
}