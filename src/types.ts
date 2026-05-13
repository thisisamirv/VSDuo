export interface DuoDevice {
    pkey: string;
    host: string;
    publicRaw: string;
    privateRaw: string;
    name: string;
    lastUsedAt?: string;
    clickLevel?: string;
    hotp_secret?: string;
    use_totp?: boolean;
    [key: string]: unknown;
}

export interface StoredDeviceData {
    activeDevice: string | -1;
    devices: DuoDevice[];
}

export interface DuoTransaction {
    urgid: string;
    attributes: unknown[];
    step_up_code_info?: {
        num_digits: number;
    };
    [key: string]: unknown;
}

export interface BrowserExportShape {
    activeDevice?: string | -1;
    devices?: Array<DuoDevice | string>;
    pkey?: string;
    [key: string]: unknown;
}

export interface SshHost {
    name: string;
    hostname?: string;
    user?: string;
    port?: string;
    identityFile?: string;
    lastUsedAt?: string;
    source: "remote-ssh" | "ssh-config";
}