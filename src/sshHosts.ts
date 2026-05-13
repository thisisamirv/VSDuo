import { readFile } from "node:fs/promises";
import os from "node:os";
import * as vscode from "vscode";
import { collectRemoteSshHosts, mergeSshHosts } from "./remoteSshHosts";
import { parseSshConfigHosts } from "./sshConfigParser";
import { resolveSshConfigPath } from "./sshConfigPath";
import { SshHost } from "./types";

export async function loadSshHosts(): Promise<SshHost[]> {
    const diagnostics = await getSshHostDiagnostics();
    return diagnostics.mergedHosts;
}

export async function loadRemoteSshHosts(): Promise<SshHost[]> {
    try {
        const result = await vscode.commands.executeCommand<unknown>("remote-internal.getConfiguredHostnames");
        return collectRemoteSshHosts(result);
    } catch {
        return [];
    }
}

export async function loadHostsFromConfig(): Promise<SshHost[]> {
    const configPath = getResolvedSshConfigPath();
    try {
        const raw = await readFile(configPath, "utf8");
        return parseSshConfigHosts(raw);
    } catch {
        return [];
    }
}

export async function getSshHostDiagnostics(): Promise<{ resolvedConfigPath: string; remoteHosts: SshHost[]; configHosts: SshHost[]; mergedHosts: SshHost[]; }> {
    const [remoteHosts, configHosts] = await Promise.all([loadRemoteSshHosts(), loadHostsFromConfig()]);
    return {
        resolvedConfigPath: getResolvedSshConfigPath(),
        remoteHosts,
        configHosts,
        mergedHosts: mergeSshHosts(remoteHosts, configHosts),
    };
}

export function getResolvedSshConfigPath(): string {
    const configured = vscode.workspace.getConfiguration("remote.SSH").get<string>("configFile", "").trim();
    return resolveSshConfigPath(configured, os.homedir());
}