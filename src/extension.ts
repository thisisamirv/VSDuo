import * as vscode from "vscode";
import { DeviceStore } from "./deviceStore";
import { DuoClient } from "./duoClient";
import { DeviceItem, DeviceTreeProvider, TransactionItem, TransactionTreeProvider } from "./tree";
import { DuoDevice, DuoTransaction } from "./types";

export async function activate(context: vscode.ExtensionContext): Promise<void> {
    const store = new DeviceStore(context);
    const client = new DuoClient();
    const devicesProvider = new DeviceTreeProvider();
    const transactionsProvider = new TransactionTreeProvider();
    const statusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
    statusBar.name = "VSDuo";
    statusBar.command = "vsduo.refreshTransactions";
    context.subscriptions.push(statusBar);

    let currentTransactions: DuoTransaction[] = [];
    let refreshHandle: NodeJS.Timeout | undefined;

    const syncViews = async (showErrors = false): Promise<void> => {
        try {
            const data = await store.getData();
            devicesProvider.setDevices(data.devices, data.activeDevice);
            const activeDevice = data.devices.find((device) => device.pkey === data.activeDevice);
            if (!activeDevice) {
                currentTransactions = [];
                transactionsProvider.setTransactions([]);
                statusBar.text = "$(icon) VSDuo: no device";
                statusBar.tooltip = "Run VSDuo: Add Device to configure Duo.";
                statusBar.show();
                return;
            }

            currentTransactions = await client.listTransactions(activeDevice);
            transactionsProvider.setTransactions(currentTransactions);
            statusBar.text = `$(icon) ${activeDevice.name}: ${currentTransactions.length} pending`;
            statusBar.tooltip = `${activeDevice.host}\nClick to refresh Duo transactions.`;
            statusBar.show();
        } catch (error) {
            currentTransactions = [];
            transactionsProvider.setTransactions([]);
            statusBar.text = "$(error) VSDuo error";
            statusBar.tooltip = errorToString(error);
            statusBar.show();
            if (showErrors) {
                void vscode.window.showErrorMessage(errorToString(error));
            }
        }
    };

    const resetTimer = (): void => {
        if (refreshHandle) {
            clearInterval(refreshHandle);
        }

        const intervalSeconds = vscode.workspace.getConfiguration("vsduo").get<number>("refreshIntervalSeconds", 15);
        refreshHandle = setInterval(() => {
            void syncViews(false);
        }, intervalSeconds * 1000);
    };

    context.subscriptions.push(
        vscode.window.registerTreeDataProvider("vsduo.devices", devicesProvider),
        vscode.window.registerTreeDataProvider("vsduo.transactions", transactionsProvider),
        vscode.commands.registerCommand("vsduo.addDevice", async () => {
            const activationCode = await vscode.window.showInputBox({
                prompt: "Paste the Duo activation code in the format XXXXXXXXXXXXXXXXXXXX-encodedHost",
                ignoreFocusOut: true,
            });
            if (!activationCode) {
                return;
            }

            const deviceName = await vscode.window.showInputBox({
                prompt: "Enter a name for this Duo device",
                placeHolder: "Work iPhone",
                ignoreFocusOut: true,
                validateInput: (value) => value.trim().length ? undefined : "Device name is required.",
            });
            if (!deviceName) {
                return;
            }

            await vscode.window.withProgress(
                {
                    location: vscode.ProgressLocation.Notification,
                    title: "VSDuo",
                    cancellable: false,
                },
                async (progress) => {
                    progress.report({ message: "Activating Duo device..." });
                    const data = await store.getData();
                    const device = await client.activateDevice(activationCode, deviceName);
                    await store.addDevice(device);
                }
            );

            await syncViews(true);
            void vscode.window.showInformationMessage("Duo device added and set active.");
        }),
        vscode.commands.registerCommand("vsduo.refreshTransactions", async () => {
            await syncViews(true);
        }),
        vscode.commands.registerCommand("vsduo.setActiveDevice", async (item?: DeviceItem) => {
            if (item) {
                await store.setActiveDevice(item.device.pkey);
            } else {
                const data = await store.getData();
                const pick = await vscode.window.showQuickPick(
                    data.devices.map((device) => ({
                        label: device.name,
                        description: device.host,
                        device,
                    })),
                    { placeHolder: "Select the active Duo device" }
                );
                if (!pick) {
                    return;
                }
                await store.setActiveDevice(pick.device.pkey);
            }

            await syncViews(true);
        }),
        vscode.commands.registerCommand("vsduo.renameDevice", async (item?: DeviceItem) => {
            const device = item?.device ?? await pickDevice(store, "Select the Duo device to rename");
            if (!device) {
                return;
            }

            const nextName = await vscode.window.showInputBox({
                prompt: "Enter a new name for this Duo device",
                value: device.name,
                ignoreFocusOut: true,
                validateInput: (value) => value.trim().length ? undefined : "Device name is required.",
            });
            if (!nextName) {
                return;
            }

            await store.renameDevice(device.pkey, nextName.trim());
            await syncViews(true);
            void vscode.window.showInformationMessage(`Renamed device to ${nextName.trim()}.`);
        }),
        vscode.commands.registerCommand("vsduo.removeDevice", async (item?: DeviceItem) => {
            const device = item?.device ?? await pickDevice(store, "Select the Duo device to remove");
            if (!device) {
                return;
            }

            const answer = await vscode.window.showWarningMessage(
                `Remove Duo device ${device.name}?`,
                { modal: true },
                "Remove"
            );
            if (answer !== "Remove") {
                return;
            }

            await store.removeDevice(device.pkey);
            await syncViews(true);
            void vscode.window.showInformationMessage(`Removed device ${device.name}.`);
        }),
        vscode.commands.registerCommand("vsduo.approveTransaction", async (item?: TransactionItem) => {
            const activeDevice = await getActiveDevice(store);
            if (!activeDevice) {
                void vscode.window.showWarningMessage("No active Duo device configured.");
                return;
            }

            const transaction = item?.transaction ?? (await pickTransaction(currentTransactions));
            if (!transaction) {
                return;
            }

            let verificationCode: string | undefined;
            if (transaction.step_up_code_info?.num_digits) {
                verificationCode = await vscode.window.showInputBox({
                    prompt: `Enter the ${transaction.step_up_code_info.num_digits}-digit verification code shown by Duo`,
                    ignoreFocusOut: true,
                    validateInput: (value) => (/^\d+$/.test(value) && value.length === transaction.step_up_code_info?.num_digits ? undefined : "Enter digits only with the exact requested length."),
                });
                if (!verificationCode) {
                    return;
                }
            }

            await client.approveTransaction(activeDevice, currentTransactions, transaction.urgid, verificationCode);
            await syncViews(true);
            void vscode.window.showInformationMessage("Duo transaction approved.");
        }),
        vscode.commands.registerCommand("vsduo.denyTransaction", async (item?: TransactionItem) => {
            const activeDevice = await getActiveDevice(store);
            if (!activeDevice) {
                void vscode.window.showWarningMessage("No active Duo device configured.");
                return;
            }

            const transaction = item?.transaction ?? (await pickTransaction(currentTransactions));
            if (!transaction) {
                return;
            }

            await client.approveTransaction(activeDevice, currentTransactions, "__deny_all__");
            await syncViews(true);
            void vscode.window.showInformationMessage(`Denied ${transaction.urgid} and any other pending transactions on the active device.`);
        }),
        vscode.commands.registerCommand("vsduo.copyTotp", async (item?: DeviceItem) => {
            const device = item?.device ?? (await getActiveDevice(store));
            if (!device) {
                void vscode.window.showWarningMessage("No device available.");
                return;
            }

            const code = client.generateCurrentTotp(device);
            if (!code) {
                void vscode.window.showWarningMessage("The selected device does not expose TOTP data.");
                return;
            }

            await vscode.env.clipboard.writeText(code);
            void vscode.window.showInformationMessage(`Copied TOTP for ${device.name}.`);
        }),
        vscode.commands.registerCommand("vsduo.importData", async () => {
            const files = await vscode.window.showOpenDialog({
                canSelectFiles: true,
                canSelectMany: false,
                filters: { Text: ["txt", "json"] },
            });
            if (!files?.length) {
                return;
            }

            const content = Buffer.from(await vscode.workspace.fs.readFile(files[0])).toString("utf8");
            await store.importSerialized(content);
            await syncViews(true);
            void vscode.window.showInformationMessage("Imported VSDuo data.");
        }),
        vscode.commands.registerCommand("vsduo.exportData", async () => {
            const target = await vscode.window.showSaveDialog({ defaultUri: vscode.Uri.file("vsduo.txt") });
            if (!target) {
                return;
            }

            const serialized = await store.exportSerialized(true);
            await vscode.workspace.fs.writeFile(target, Buffer.from(serialized, "utf8"));
            void vscode.window.showInformationMessage("Exported VSDuo data.");
        }),
        vscode.commands.registerCommand("vsduo.exportTotpUris", async () => {
            const data = await store.getData();
            const lines = data.devices
                .map((device) => client.generateTotpUri(device))
                .filter((value): value is string => Boolean(value));
            if (!lines.length) {
                void vscode.window.showWarningMessage("No devices with TOTP data found.");
                return;
            }

            const target = await vscode.window.showSaveDialog({ defaultUri: vscode.Uri.file("duo-mobile-totps.txt") });
            if (!target) {
                return;
            }

            await vscode.workspace.fs.writeFile(target, Buffer.from(lines.join("\n"), "utf8"));
            void vscode.window.showInformationMessage(`Exported ${lines.length} TOTP URI${lines.length === 1 ? "" : "s"}.`);
        }),
        vscode.commands.registerCommand("vsduo.clearData", async () => {
            const answer = await vscode.window.showWarningMessage("Delete all stored VSDuo data?", { modal: true }, "Delete");
            if (answer !== "Delete") {
                return;
            }

            await store.clear();
            await syncViews(true);
            void vscode.window.showInformationMessage("Cleared VSDuo data.");
        }),
        vscode.workspace.onDidChangeConfiguration((event) => {
            if (event.affectsConfiguration("vsduo.refreshIntervalSeconds")) {
                resetTimer();
            }
        }),
        { dispose: () => refreshHandle && clearInterval(refreshHandle) }
    );

    resetTimer();
    await syncViews(false);
}

export function deactivate(): void { }

async function getActiveDevice(store: DeviceStore): Promise<DuoDevice | undefined> {
    const data = await store.getData();
    return data.devices.find((device) => device.pkey === data.activeDevice);
}

async function pickTransaction(transactions: DuoTransaction[]): Promise<DuoTransaction | undefined> {
    if (!transactions.length) {
        void vscode.window.showInformationMessage("No pending Duo transactions.");
        return undefined;
    }

    const pick = await vscode.window.showQuickPick(
        transactions.map((transaction) => ({
            label: transaction.urgid,
            description: transaction.step_up_code_info ? "Verification code required" : "Approve or deny",
            transaction,
        })),
        { placeHolder: "Select a Duo transaction" }
    );
    return pick?.transaction;
}

async function pickDevice(store: DeviceStore, placeHolder: string): Promise<DuoDevice | undefined> {
    const data = await store.getData();
    if (!data.devices.length) {
        void vscode.window.showInformationMessage("No Duo devices configured.");
        return undefined;
    }

    const pick = await vscode.window.showQuickPick(
        data.devices.map((device) => ({
            label: device.name,
            description: device.host,
            device,
        })),
        { placeHolder }
    );
    return pick?.device;
}

function errorToString(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}