import * as vscode from "vscode";
import { DuoDevice, DuoTransaction, SshHost } from "./types";

export class DeviceItem extends vscode.TreeItem {
    public constructor(public readonly device: DuoDevice, isActive: boolean) {
        super(device.name, vscode.TreeItemCollapsibleState.None);
        this.description = isActive ? "active" : undefined;
        this.tooltip = `${device.name}\n${device.host}`;
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

export class DeviceTreeProvider implements vscode.TreeDataProvider<DeviceItem> {
    private readonly onDidChangeTreeDataEmitter = new vscode.EventEmitter<DeviceItem | undefined | void>();
    public readonly onDidChangeTreeData = this.onDidChangeTreeDataEmitter.event;
    private items: DeviceItem[] = [];

    public setDevices(devices: DuoDevice[], activeDevice: string | -1): void {
        this.items = devices
            .slice()
            .sort((left, right) => left.name.localeCompare(right.name))
            .map((device) => new DeviceItem(device, device.pkey === activeDevice));
        this.refresh();
    }

    public refresh(): void {
        this.onDidChangeTreeDataEmitter.fire();
    }

    public getTreeItem(element: DeviceItem): vscode.TreeItem {
        return element;
    }

    public getChildren(): DeviceItem[] {
        return this.items;
    }
}

export class TransactionTreeProvider implements vscode.TreeDataProvider<TransactionItem> {
    private readonly onDidChangeTreeDataEmitter = new vscode.EventEmitter<TransactionItem | undefined | void>();
    public readonly onDidChangeTreeData = this.onDidChangeTreeDataEmitter.event;
    private items: TransactionItem[] = [];

    public setTransactions(transactions: DuoTransaction[]): void {
        this.items = transactions.map((transaction) => {
            const flattened = flattenAttributes(transaction.attributes);
            const title = flattened.find((line) => line.startsWith("Location:") || line.startsWith("Application:")) ?? `Transaction ${transaction.urgid}`;
            return new TransactionItem(transaction, title, flattened.join(" | "));
        });
        this.refresh();
    }

    public refresh(): void {
        this.onDidChangeTreeDataEmitter.fire();
    }

    public getTreeItem(element: TransactionItem): vscode.TreeItem {
        return element;
    }

    public getChildren(): TransactionItem[] {
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
        this.description = host.hostname && host.hostname !== host.name ? host.hostname : host.user ? host.user : undefined;
        this.tooltip = [
            host.name,
            host.hostname ? `HostName: ${host.hostname}` : undefined,
            host.user ? `User: ${host.user}` : undefined,
            host.port ? `Port: ${host.port}` : undefined,
            host.identityFile ? `IdentityFile: ${host.identityFile}` : undefined,
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

export class HostTreeProvider implements vscode.TreeDataProvider<HostItem> {
    private readonly onDidChangeTreeDataEmitter = new vscode.EventEmitter<HostItem | undefined | void>();
    public readonly onDidChangeTreeData = this.onDidChangeTreeDataEmitter.event;
    private items: HostItem[] = [];

    public setHosts(hosts: SshHost[]): void {
        this.items = hosts
            .slice()
            .sort((left, right) => left.name.localeCompare(right.name))
            .map((host) => new HostItem(host));
        this.refresh();
    }

    public refresh(): void {
        this.onDidChangeTreeDataEmitter.fire();
    }

    public getTreeItem(element: HostItem): vscode.TreeItem {
        return element;
    }

    public getChildren(): HostItem[] {
        return this.items;
    }
}