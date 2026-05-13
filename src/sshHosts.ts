import { readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import * as vscode from "vscode";
import { collectRemoteSshHosts } from "./remoteSshHosts";
import { parseSshConfigHosts } from "./sshConfigParser";
import { SshHost } from "./types";

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
        return collectRemoteSshHosts(result);
    } catch {
        return [];
    }
}

async function loadHostsFromConfig(): Promise<SshHost[]> {
    const configPath = resolveSshConfigPath();
    try {
        const raw = await readFile(configPath, "utf8");
        return parseSshConfigHosts(raw);
    } catch {
        return [];
    }
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