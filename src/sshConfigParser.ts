import { parse } from "ssh-config";
import { SshHost } from "./types";

interface ParsedHostRecord extends Record<string, string | undefined> {
    host?: string;
    HostName?: string;
    User?: string;
    Port?: string;
    IdentityFile?: string;
}

interface ParsedConfigLine {
    param?: string;
    value?: string | Array<{ val?: string }>;
    config?: ParsedConfigLine[];
}

export function parseSshConfigHosts(rawConfig: string): SshHost[] {
    const parsed = parse(rawConfig);
    const hosts = parsed
        .map((entry) => normalizeParsedHostRecord(entry))
        .filter((entry): entry is ParsedHostRecord => Boolean(entry))
        .flatMap((entry) => toHosts(entry));
    return dedupeHosts(hosts);
}

function normalizeParsedHostRecord(entry: unknown): ParsedHostRecord | undefined {
    if (!entry || typeof entry !== "object") {
        return undefined;
    }

    const line = entry as ParsedConfigLine;
    if (line.param !== "Host") {
        return undefined;
    }

    const hostValue = normalizeHostValue(line.value);
    if (!hostValue) {
        return undefined;
    }

    const record: ParsedHostRecord = { host: hostValue };
    for (const child of line.config ?? []) {
        if (!child.param || typeof child.value !== "string") {
            continue;
        }

        record[child.param] = child.value;
    }

    return record;
}

function normalizeHostValue(value: ParsedConfigLine["value"]): string | undefined {
    if (typeof value === "string") {
        return value;
    }

    if (!Array.isArray(value)) {
        return undefined;
    }

    const names = value
        .map((entry) => entry?.val?.trim())
        .filter((entry): entry is string => Boolean(entry));

    return names.length ? names.join(" ") : undefined;
}

function toHosts(entry: ParsedHostRecord): SshHost[] {
    const patterns = String(entry.host ?? "")
        .split(/\s+/)
        .map((value) => value.trim())
        .filter(Boolean)
        .filter((value) => !/[!*?]/.test(value));

    return patterns.map((name) => ({
        name,
        hostname: entry.HostName,
        user: entry.User,
        port: entry.Port,
        identityFile: entry.IdentityFile,
        source: "ssh-config" as const,
    }));
}

function dedupeHosts(hosts: SshHost[]): SshHost[] {
    const byName = new Map<string, SshHost>();
    for (const host of hosts) {
        if (!byName.has(host.name)) {
            byName.set(host.name, host);
        }
    }

    return Array.from(byName.values());
}