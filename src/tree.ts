import * as vscode from "vscode";
import { DuoDevice, DuoTransaction } from "./types";

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
        this.iconPath = new vscode.ThemeIcon(transaction.step_up_code_info ? "shield" : "pass-filled");
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