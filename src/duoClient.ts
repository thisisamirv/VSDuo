import { webcrypto } from "node:crypto";
import { generateSync, generateURI } from "otplib";
import { DuoDevice, DuoTransaction } from "./types";

const subtle = webcrypto.subtle;

export class DuoClient {
    public async activateDevice(rawCode: string, deviceName: string): Promise<DuoDevice> {
        const { identifier, host } = parseActivationCode(rawCode);

        const keyPair = await subtle.generateKey(
            {
                name: "RSASSA-PKCS1-v1_5",
                modulusLength: 2048,
                publicExponent: new Uint8Array([0x01, 0x00, 0x01]),
                hash: "SHA-512",
            },
            true,
            ["sign", "verify"]
        );

        const publicSpki = await subtle.exportKey("spki", keyPair.publicKey);
        const privatePkcs8 = await subtle.exportKey("pkcs8", keyPair.privateKey);
        const publicRaw = Buffer.from(publicSpki).toString("base64");
        const privateRaw = Buffer.from(privatePkcs8).toString("base64");
        const pemFormat = toPem(publicSpki);

        const activationInfo = buildActivationInfo(pemFormat);
        const response = await fetch(`https://${host}/push/v2/activation/${identifier}`, {
            method: "POST",
            headers: {
                "content-type": "application/x-www-form-urlencoded",
            },
            body: new URLSearchParams(activationInfo),
        });

        const payload = (await response.json()) as { stat?: string; response?: Record<string, unknown> };
        if (!response.ok || payload.stat !== "OK" || !payload.response) {
            throw new Error(payload.stat === "FAIL" ? "Activation code expired or rejected by Duo." : `Activation failed with status ${response.status}.`);
        }

        const platform = String(activationInfo.platform);
        const device = payload.response as DuoDevice;
        delete device.customer_logo;
        device.name = deviceName.trim();
        device.clickLevel = device.clickLevel ?? "2";
        device.host = host;
        device.publicRaw = publicRaw;
        device.privateRaw = privateRaw;
        device.platform = platform;
        return device;
    }

    public async listTransactions(device: DuoDevice): Promise<DuoTransaction[]> {
        const response = (await this.buildRequest(device, "GET", "/push/v2/device/transactions")) as {
            response?: { transactions?: DuoTransaction[] };
        };
        return response.response?.transactions ?? [];
    }

    public async approveTransaction(device: DuoDevice, transactions: DuoTransaction[], txId: string, verificationCode?: string): Promise<void> {
        if (!transactions.length) {
            throw new Error("No transactions found.");
        }

        for (const transaction of transactions) {
            const answer = transaction.urgid === txId ? "approve" : "deny";
            const extraParam: Record<string, string> = {
                answer,
                txId: transaction.urgid,
            };
            if (answer === "approve" && verificationCode) {
                extraParam.step_up_code = verificationCode;
            }

            await this.buildRequest(device, "POST", `/push/v2/device/transactions/${transaction.urgid}`, extraParam);
        }
    }

    public generateCurrentTotp(device: DuoDevice): string | undefined {
        if (!device.use_totp || !device.hotp_secret) {
            return undefined;
        }

        return generateSync({
            secret: Buffer.from(device.hotp_secret, "utf8"),
        });
    }

    public generateTotpUri(device: DuoDevice): string | undefined {
        if (!device.hotp_secret) {
            return undefined;
        }

        return generateURI({
            issuer: "Duo Mobile",
            label: device.name,
            secret: base32Encode(device.hotp_secret),
        });
    }

    private async buildRequest(device: DuoDevice, method: string, path: string, extraParam: Record<string, string> = {}): Promise<unknown> {
        const date = new Date().toUTCString();
        const host = device.host.trim();
        const sortedEntries = Object.entries(extraParam)
            .map(([key, value]) => [String(key), String(value)] as const)
            .sort((left, right) => left[0].localeCompare(right[0], "en", { numeric: false }));
        const queryString = sortedEntries
            .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`)
            .join("&");

        let canonicalRequest = "";
        canonicalRequest += `${date}\n`;
        canonicalRequest += `${method.toUpperCase()}\n`;
        canonicalRequest += `${host}\n`;
        canonicalRequest += `${path}\n`;
        canonicalRequest += queryString;

        const privateKey = await subtle.importKey(
            "pkcs8",
            Buffer.from(device.privateRaw, "base64"),
            { name: "RSASSA-PKCS1-v1_5", hash: { name: "SHA-512" } },
            true,
            ["sign"]
        );

        const signature = await subtle.sign(
            { name: "RSASSA-PKCS1-v1_5" },
            privateKey,
            new TextEncoder().encode(canonicalRequest)
        );

        const credential = `${device.pkey}:${Buffer.from(signature).toString("base64")}`;
        const url = `https://${host}${path}${queryString ? `?${queryString}` : ""}`;
        const response = await fetch(url, {
            method: method.toUpperCase(),
            headers: {
                Authorization: `Basic ${Buffer.from(credential, "utf8").toString("base64")}`,
                "x-duo-date": date,
            },
        });

        if (!response.ok) {
            const body = await response.text();
            throw new Error(`${response.status} ${response.statusText}: ${body}`);
        }

        return response.json();
    }
}

function parseActivationCode(rawCode: string): { identifier: string; host: string } {
    const parts = rawCode.trim().split("-");
    if (parts.length !== 2) {
        throw new Error("Activation code must look like XXXXXXXXXXXXXXXXXXXX-encodedHost.");
    }

    const identifier = parts[0];
    const host = Buffer.from(parts[1], "base64").toString("utf8");
    if (identifier.length !== 20 || host.length !== 28) {
        throw new Error("Activation code length is invalid.");
    }

    return { identifier, host };
}

function buildActivationInfo(pubkey: string): Record<string, string> {
    const appleDevices = ["iPad", "iPad Air", "iPad Pro", "iPad mini"];
    const androidDevices = ["Galaxy Tab A8", "Galaxy Tab A7 Lite", "Galaxy Tab S10 Ultra", "Lenovo Tab P11"];
    const useApple = Math.random() < 0.5;
    const modelPool = useApple ? appleDevices : androidDevices;

    return {
        customer_protocol: "1",
        pubkey,
        pkpush: "rsa-sha512",
        jailbroken: "false",
        architecture: "arm64",
        region: "US",
        app_id: "com.duosecurity.duomobile",
        full_disk_encryption: "true",
        passcode_status: "true",
        app_version: "4.110.0",
        app_build_number: "4110000",
        app_install_id: "999f5587-65fb-4663-bd9f-f3bb62648da2",
        version: "13",
        manufacturer: "unknown",
        language: "en",
        security_patch_level: "2022-11-05",
        platform: useApple ? "iOS" : "Android",
        model: modelPool[Math.floor(Math.random() * modelPool.length)],
    };
}

function toPem(key: ArrayBuffer): string {
    const base64 = Buffer.from(key).toString("base64");
    const lines = base64.match(/.{1,64}/g) ?? [];
    return `-----BEGIN PUBLIC KEY-----\n${lines.join("\n")}\n-----END PUBLIC KEY-----`;
}

function base32Encode(input: string): string {
    const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
    let binary = "";
    for (const character of input) {
        binary += character.charCodeAt(0).toString(2).padStart(8, "0");
    }

    let encoded = "";
    for (let index = 0; index < binary.length; index += 5) {
        const chunk = binary.slice(index, index + 5).padEnd(5, "0");
        encoded += alphabet[parseInt(chunk, 2)];
    }

    return encoded;
}