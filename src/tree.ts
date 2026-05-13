import * as vscode from "vscode";
import { DuoDevice, DuoTransaction, SshHost } from "./types";

class EmptyStateItem extends vscode.TreeItem {
    public constructor(label: string, description?: string) {
        super(label, vscode.TreeItemCollapsibleState.None);
        this.description = description;
        this.contextValue = "vsduo.emptyState";
        this.iconPath = new vscode.ThemeIcon("info");
    }
}

export class DeviceItem extends vscode.TreeItem {
    public constructor(public readonly device: DuoDevice, isActive: boolean) {
        super(device.name, vscode.TreeItemCollapsibleState.None);
        this.description = describeDevice(device, isActive);
        this.tooltip = [
            device.name,
            device.host,
            device.lastUsedAt ? `Last used: ${formatTimestamp(device.lastUsedAt)}` : undefined,
        ].filter((value): value is string => Boolean(value)).join("\n");
        this.contextValue = device.hotp_secret ? "vsduo.deviceHasTotp" : "vsduo.device";
        this.iconPath = new vscode.ThemeIcon(isActive ? "check-all" : "device-mobile");
        this.command = {
            command: "vsduo.setActiveDevice",
            title: "Set Active Device",
            arguments: [this],
        };
    }
}

export class TransactionItem extends vscode.TreeItem {
    public constructor(public readonly transaction: DuoTransaction, label: string, details: string) {
        super(label, vscode.TreeItemCollapsibleState.None);
        this.description = details;
        this.tooltip = `${label}\n${details}`;
        this.contextValue = "vsduo.transaction";
        this.iconPath = new vscode.ThemeIcon(transaction.step_up_code_info ? "icon" : "pass-filled");
    }
}

export class DeviceTreeProvider implements vscode.TreeDataProvider<vscode.TreeItem> {
    private readonly onDidChangeTreeDataEmitter = new vscode.EventEmitter<vscode.TreeItem | undefined | void>();
    public readonly onDidChangeTreeData = this.onDidChangeTreeDataEmitter.event;
    private items: vscode.TreeItem[] = [];

    public setDevices(devices: DuoDevice[], activeDevice: string | -1): void {
        if (!devices.length) {
            this.items = [new EmptyStateItem("No Duo devices configured", "Run VSDuo: Add Device to get started.")];
        } else {
            this.items = devices
                .slice()
                .sort((left, right) => left.name.localeCompare(right.name))
                .map((device) => new DeviceItem(device, device.pkey === activeDevice));
        }
        this.refresh();
    }

    public refresh(): void {
        this.onDidChangeTreeDataEmitter.fire();
    }

    public getTreeItem(element: vscode.TreeItem): vscode.TreeItem {
        return element;
    }

    public getChildren(): vscode.TreeItem[] {
        return this.items;
    }
}

export class TransactionTreeProvider implements vscode.TreeDataProvider<vscode.TreeItem> {
    private readonly onDidChangeTreeDataEmitter = new vscode.EventEmitter<vscode.TreeItem | undefined | void>();
    public readonly onDidChangeTreeData = this.onDidChangeTreeDataEmitter.event;
    private items: vscode.TreeItem[] = [];

    public setTransactions(transactions: DuoTransaction[], emptyMessage = "No pending Duo transactions."): void {
        if (!transactions.length) {
            this.items = [new EmptyStateItem(emptyMessage)];
        } else {
            this.items = transactions.map((transaction) => {
                const flattened = flattenAttributes(transaction.attributes);
                const title = flattened.find((line) => line.startsWith("Location:") || line.startsWith("Application:")) ?? `Transaction ${transaction.urgid}`;
                return new TransactionItem(transaction, title, flattened.join(" | "));
            });
        }
        this.refresh();
    }

    public refresh(): void {
        this.onDidChangeTreeDataEmitter.fire();
    }

    public getTreeItem(element: vscode.TreeItem): vscode.TreeItem {
        return element;
    }

    public getChildren(): vscode.TreeItem[] {
        return this.items;
    }
}

function flattenAttributes(value: unknown): string[] {
    if (!Array.isArray(value)) {
        return [];
    }

    if (value.length === 2 && typeof value[0] === "string") {
        if (value[0] === "Username" || value[0] === "Organization") {
            return [];
        }

        const displayValue = value[0] === "Time" ? formatEpoch(value[1]) : String(value[1]);
        return [`${value[0]}: ${displayValue}`];
    }

    return value.flatMap((entry) => flattenAttributes(entry));
}

function formatEpoch(value: unknown): string {
    const epoch = Number(value);
    if (Number.isNaN(epoch)) {
        return String(value);
    }

    return new Date(epoch * 1000).toLocaleString();
}

export class HostItem extends vscode.TreeItem {
    public constructor(public readonly host: SshHost) {
        super(host.name, vscode.TreeItemCollapsibleState.None);
        this.description = describeHost(host);
        this.tooltip = [
            host.name,
            host.hostname ? `HostName: ${host.hostname}` : undefined,
            host.user ? `User: ${host.user}` : undefined,
            host.port ? `Port: ${host.port}` : undefined,
            host.identityFile ? `IdentityFile: ${host.identityFile}` : undefined,
            host.lastUsedAt ? `Last used: ${formatTimestamp(host.lastUsedAt)}` : undefined,
        ].filter((value): value is string => Boolean(value)).join("\n");
        this.contextValue = "vsduo.host";
        this.iconPath = new vscode.ThemeIcon("remote");
        this.command = {
            command: "vsduo.connectCurrentWindowToSshHost",
            title: "Connect Current Window to SSH Host",
            arguments: [this],
        };
    }
}

export class HostTreeProvider implements vscode.TreeDataProvider<vscode.TreeItem> {
    private readonly onDidChangeTreeDataEmitter = new vscode.EventEmitter<vscode.TreeItem | undefined | void>();
    public readonly onDidChangeTreeData = this.onDidChangeTreeDataEmitter.event;
    private items: vscode.TreeItem[] = [];
    private hosts: SshHost[] = [];

    public setHosts(hosts: SshHost[]): void {
        this.hosts = hosts
            .slice()
            .sort((left, right) => left.name.localeCompare(right.name));

        if (!this.hosts.length) {
            this.items = [new EmptyStateItem("No SSH hosts found", "Check remote.SSH.configFile or refresh Hosts.")];
        } else {
            this.items = this.hosts.map((host) => new HostItem(host));
        }
        this.refresh();
    }

    public refresh(): void {
        this.onDidChangeTreeDataEmitter.fire();
    }

    public getTreeItem(element: vscode.TreeItem): vscode.TreeItem {
        return element;
    }

    public getChildren(): vscode.TreeItem[] {
        return this.items;
    }

    public getHosts(): SshHost[] {
        return this.hosts;
    }
}

function describeDevice(device: DuoDevice, isActive: boolean): string | undefined {
    const parts = [isActive ? "active" : undefined, formatLastUsed(device.lastUsedAt)];
    const filtered = parts.filter((value): value is string => Boolean(value));
    return filtered.length ? filtered.join(" | ") : undefined;
}

function describeHost(host: SshHost): string | undefined {
    const details = [
        host.hostname && host.hostname !== host.name ? host.hostname : undefined,
        host.user,
        host.port ? `port ${host.port}` : undefined,
        formatLastUsed(host.lastUsedAt),
    ].filter((value): value is string => Boolean(value));
    return details.length ? details.join(" | ") : undefined;
}

function formatLastUsed(value: string | undefined): string | undefined {
    if (!value) {
        return undefined;
    }

    const timestamp = Date.parse(value);
    if (Number.isNaN(timestamp)) {
        return undefined;
    }

    const elapsedSeconds = Math.max(0, Math.floor((Date.now() - timestamp) / 1000));
    if (elapsedSeconds < 60) {
        return "last used just now";
    }

    const elapsedMinutes = Math.floor(elapsedSeconds / 60);
    if (elapsedMinutes < 60) {
        return `last used ${elapsedMinutes}m ago`;
    }

    const elapsedHours = Math.floor(elapsedMinutes / 60);
    if (elapsedHours < 24) {
        return `last used ${elapsedHours}h ago`;
    }

    const elapsedDays = Math.floor(elapsedHours / 24);
    return `last used ${elapsedDays}d ago`;
}

function formatTimestamp(value: string): string {
    const timestamp = Date.parse(value);
    if (Number.isNaN(timestamp)) {
        return value;
    }

    return new Date(timestamp).toLocaleString();
}