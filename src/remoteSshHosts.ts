import { SshHost } from "./types";

export function collectRemoteSshHosts(result: unknown): SshHost[] {
    if (!Array.isArray(result)) {
        return [];
    }

    const names = result
        .map((entry) => normalizeRemoteHostEntry(entry))
        .filter((value): value is string => Boolean(value));

    return dedupeHosts(names.map((name) => ({ name, source: "remote-ssh" as const })));
}

export function normalizeRemoteHostEntry(entry: unknown): string | undefined {
    if (typeof entry === "string") {
        return entry.trim() || undefined;
    }

    if (!entry || typeof entry !== "object") {
        return undefined;
    }

    const record = entry as Record<string, unknown>;
    const candidates = [record.host, record.hostname, record.label, record.name];
    for (const candidate of candidates) {
        if (typeof candidate === "string" && candidate.trim()) {
            return candidate.trim();
        }
    }

    return undefined;
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