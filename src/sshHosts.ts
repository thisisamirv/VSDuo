import { readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { parse } from "ssh-config";
import * as vscode from "vscode";
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
    value?: string;
    config?: ParsedConfigLine[];
}

export async function loadSshHosts(): Promise<SshHost[]> {
    const remoteHosts = await loadRemoteSshHosts();
    if (remoteHosts.length) {
        return remoteHosts;
    }

    return loadHostsFromConfig();
}

async function loadRemoteSshHosts(): Promise<SshHost[]> {
    try {
        const result = await vscode.commands.executeCommand<unknown>("remote-internal.getConfiguredHostnames");
        if (!Array.isArray(result)) {
            return [];
        }

        const names = result
            .map((entry) => normalizeRemoteHostEntry(entry))
            .filter((value): value is string => Boolean(value));

        return dedupeHosts(names.map((name) => ({ name, source: "remote-ssh" as const })));
    } catch {
        return [];
    }
}

function normalizeRemoteHostEntry(entry: unknown): string | undefined {
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

async function loadHostsFromConfig(): Promise<SshHost[]> {
    const configPath = resolveSshConfigPath();
    try {
        const raw = await readFile(configPath, "utf8");
        const parsed = parse(raw);
        const hosts = parsed
            .map((entry) => normalizeParsedHostRecord(entry))
            .filter((entry): entry is ParsedHostRecord => Boolean(entry))
            .flatMap((entry) => toHosts(entry));
        return dedupeHosts(hosts);
    } catch {
        return [];
    }
}

function normalizeParsedHostRecord(entry: unknown): ParsedHostRecord | undefined {
    if (!entry || typeof entry !== "object") {
        return undefined;
    }

    const line = entry as ParsedConfigLine;
    if (line.param !== "Host" || typeof line.value !== "string") {
        return undefined;
    }

    const record: ParsedHostRecord = { host: line.value };
    for (const child of line.config ?? []) {
        if (!child.param || typeof child.value !== "string") {
            continue;
        }

        record[child.param] = child.value;
    }

    return record;
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

function resolveSshConfigPath(): string {
    const configured = vscode.workspace.getConfiguration("remote.SSH").get<string>("configFile", "").trim();
    const rawPath = configured || path.join("~", ".ssh", "config");
    return expandHomePath(rawPath);
}

function expandHomePath(inputPath: string): string {
    if (inputPath === "~") {
        return os.homedir();
    }

    if (inputPath.startsWith("~/") || inputPath.startsWith("~\\")) {
        return path.join(os.homedir(), inputPath.slice(2));
    }

    return inputPath;
}