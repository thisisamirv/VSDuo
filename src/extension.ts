import { fork } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import * as vscode from "vscode";
import { DeviceStore } from "./deviceStore";
import { DuoClient } from "./duoClient";
import { formatRemoteSshDiagnostics, HandoffDiagnostics, HelperDiagnostics } from "./remoteSshDiagnostics";
import { runRemoteSshHandoff } from "./remoteSshHandoff";
import { DeviceItem, DeviceTreeProvider, HostAutoApproveToggleItem, HostItem, HostTreeProvider, TransactionItem, TransactionTreeProvider } from "./tree";
import { getResolvedSshConfigPath, getSshHostDiagnostics, loadSshHosts } from "./sshHosts";
import { DuoDevice, DuoTransaction, StoredDeviceData, SshHost } from "./types";

interface RemoteHelperState {
    port: number;
    token: string;
}

type RemoteHelperAutoStartMode = "off" | "background" | "backgroundAndOpen";

const REMOTE_HELPER_STATE_KEY = "vsduo.remoteHelper";
const LAST_USED_HOSTS_KEY = "vsduo.lastUsedHosts";
const AUTO_APPROVE_HOSTS_KEY = "vsduo.autoApproveHosts";

export async function activate(context: vscode.ExtensionContext): Promise<void> {
    const store = new DeviceStore(context);
    const client = new DuoClient();
    const devicesProvider = new DeviceTreeProvider();
    const transactionsProvider = new TransactionTreeProvider();
    const hostsProvider = new HostTreeProvider();
    const hostsView = vscode.window.createTreeView("vsduo.hosts", { treeDataProvider: hostsProvider });
    const statusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
    statusBar.name = "VSDuo";
    statusBar.command = "vsduo.refreshTransactions";
    context.subscriptions.push(statusBar);

    let currentTransactions: DuoTransaction[] = [];
    let refreshHandle: NodeJS.Timeout | undefined;
    let lastHelperDiagnostics: HelperDiagnostics = { mode: "backgroundAndOpen", attempted: false };
    let lastHandoffDiagnostics: HandoffDiagnostics | undefined;

    hostsProvider.setAutoApproveSelections(context.globalState.get<Record<string, boolean>>(AUTO_APPROVE_HOSTS_KEY, {}));

    const syncViews = async (showErrors = false): Promise<void> => {
        try {
            const data = await store.getData();
            devicesProvider.setDevices(data.devices, data.activeDevice);
            const activeDevice = data.devices.find((device) => device.pkey === data.activeDevice);
            if (!activeDevice) {
                currentTransactions = [];
                transactionsProvider.setTransactions([], "Add and activate a Duo device to see pending requests.");
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
            transactionsProvider.setTransactions([], "Unable to load Duo transactions.");
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

    const refreshRemoteHelperIfRunning = async (): Promise<void> => {
        const state = context.globalState.get<RemoteHelperState>(REMOTE_HELPER_STATE_KEY);
        if (!state || !(await pingRemoteHelper(state.port))) {
            return;
        }

        await stopRemoteHelper(context, state);
        await ensureRemoteHelperRunning(context, store);
    };

    const refreshHosts = async (showErrors = false): Promise<void> => {
        try {
            const hosts = applyLastUsedTimestamps(await loadSshHosts(), getLastUsedHosts(context));
            hostsProvider.setHosts(hosts);
        } catch (error) {
            hostsProvider.setHosts([]);
            if (showErrors) {
                void vscode.window.showErrorMessage(`Unable to load SSH hosts: ${errorToString(error)}`);
            }
        }
    };

    context.subscriptions.push(
        vscode.window.registerTreeDataProvider("vsduo.devices", devicesProvider),
        vscode.window.registerTreeDataProvider("vsduo.transactions", transactionsProvider),
        hostsView,
        hostsView.onDidChangeCheckboxState(async (event) => {
            let changed = false;
            for (const [item, state] of event.items) {
                if (!(item instanceof HostAutoApproveToggleItem)) {
                    continue;
                }

                hostsProvider.setAutoApprove(
                    item.hostName,
                    state === vscode.TreeItemCheckboxState.Checked,
                );
                changed = true;
            }

            if (!changed) {
                return;
            }

            hostsProvider.refresh();
            await context.globalState.update(AUTO_APPROVE_HOSTS_KEY, hostsProvider.getAutoApproveSelections());
        }),
        vscode.commands.registerCommand("vsduo.addDevice", async () => {
            const continueAddDevice = await vscode.window.showInformationMessage(
                "Get a Duo activation code before continuing.",
                {
                    modal: true,
                    detail:
                        "1. Go to your organization website and manage Duo devices.\n" +
                        "2. Add a new device.\n" +
                        "3. Choose Duo Mobile.\n" +
                        "4. Choose 'I have a tablet'.\n" +
                        "5. Select Next.\n" +
                        "6. Choose 'Get an activation link instead'.\n" +
                        "7. Enter your email address and send the email.\n" +
                        "8. Open the link in the email.\n" +
                        "9. Copy the activation code from that webpage and paste it here."
                },
                "Continue"
            );
            if (continueAddDevice !== "Continue") {
                return;
            }

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
                    const device = await client.activateDevice(activationCode, deviceName);
                    await store.addDevice(device);
                }
            );

            await refreshRemoteHelperIfRunning();
            await syncViews(true);
            void vscode.window.showInformationMessage("Duo device added and set active.");
        }),
        vscode.commands.registerCommand("vsduo.refreshTransactions", async () => {
            await syncViews(true);
        }),
        vscode.commands.registerCommand("vsduo.refreshHosts", async () => {
            await refreshHosts(true);
        }),
        vscode.commands.registerCommand("vsduo.addSshHost", async () => {
            await openSshConfigForEditing();
        }),
        vscode.commands.registerCommand("vsduo.showRemoteSshDiagnostics", async () => {
            const content = await buildRemoteSshDiagnosticsReport(context, lastHelperDiagnostics, lastHandoffDiagnostics);

            const document = await vscode.workspace.openTextDocument({
                language: "markdown",
                content,
            });
            await vscode.window.showTextDocument(document, { preview: false });
        }),
        vscode.commands.registerCommand("vsduo.copyRemoteSshDiagnostics", async () => {
            const content = await buildRemoteSshDiagnosticsReport(context, lastHelperDiagnostics, lastHandoffDiagnostics);
            await vscode.env.clipboard.writeText(content);
            void vscode.window.showInformationMessage("Copied VSDuo Remote SSH diagnostics to the clipboard.");
        }),
        vscode.commands.registerCommand("vsduo.startRemoteHelper", async () => {
            const state = await ensureRemoteHelperRunning(context, store);
            await vscode.env.openExternal(vscode.Uri.parse(getRemoteHelperUrl(state)));
            void vscode.window.showInformationMessage("Opened the VSDuo Remote SSH helper in your browser.");
        }),
        vscode.commands.registerCommand("vsduo.connectCurrentWindowToSshHost", async (item?: HostItem | SshHost, autoApproveOverride?: boolean) => {
            const host = (item instanceof HostItem ? item.host : isSshHost(item) ? item : undefined) ?? await pickHost(hostsProvider);
            if (!host) {
                return;
            }

            const autoApproveEnabled = autoApproveOverride ?? hostsProvider.isAutoApproveEnabled(host.name);
            if (autoApproveEnabled) {
                const mode = vscode.workspace.getConfiguration("vsduo").get<RemoteHelperAutoStartMode>("remoteHelperAutoStart", "backgroundAndOpen");
                lastHelperDiagnostics = { mode, attempted: false, openedBrowser: false };
                const started = await startDetachedAutoApprove(context, store, host);
                if (!started) {
                    lastHelperDiagnostics = await maybeStartRemoteHelperForConnect(context, store);
                }
            } else {
                lastHelperDiagnostics = await maybeStartRemoteHelperForConnect(context, store);
            }

            try {
                lastHandoffDiagnostics = await connectCurrentWindowToSshHost(host);
                await markHostUsed(context, host.name);
                await refreshHosts(false);
            } catch (error) {
                lastHandoffDiagnostics = {
                    hostName: host.name,
                    error: errorToString(error),
                };
                const message = lastHandoffDiagnostics.error;
                if (message) {
                    void vscode.window.showErrorMessage(message);
                }
            }
        }),
        vscode.commands.registerCommand("vsduo.openRemoteHelper", async () => {
            const state = context.globalState.get<RemoteHelperState>(REMOTE_HELPER_STATE_KEY);
            if (!state || !(await pingRemoteHelper(state.port))) {
                const started = await ensureRemoteHelperRunning(context, store);
                await vscode.env.openExternal(vscode.Uri.parse(getRemoteHelperUrl(started)));
                return;
            }

            await vscode.env.openExternal(vscode.Uri.parse(getRemoteHelperUrl(state)));
        }),
        vscode.commands.registerCommand("vsduo.stopRemoteHelper", async () => {
            const state = context.globalState.get<RemoteHelperState>(REMOTE_HELPER_STATE_KEY);
            if (!state || !(await pingRemoteHelper(state.port))) {
                await context.globalState.update(REMOTE_HELPER_STATE_KEY, undefined);
                void vscode.window.showInformationMessage("The VSDuo Remote SSH helper is not running.");
                return;
            }

            await stopRemoteHelper(context, state);
            void vscode.window.showInformationMessage("Stopped the VSDuo Remote SSH helper.");
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
            await refreshRemoteHelperIfRunning();
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
            await refreshRemoteHelperIfRunning();
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
            await store.markDeviceUsed(activeDevice.pkey);
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
            await store.markDeviceUsed(activeDevice.pkey);
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
            await store.markDeviceUsed(device.pkey);
            await syncViews(false);
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
            await refreshRemoteHelperIfRunning();
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
            await refreshRemoteHelperIfRunning();
            await syncViews(true);
            void vscode.window.showInformationMessage("Cleared VSDuo data.");
        }),
        vscode.workspace.onDidChangeConfiguration((event) => {
            if (event.affectsConfiguration("vsduo.refreshIntervalSeconds")) {
                resetTimer();
            }

            if (event.affectsConfiguration("vsduo.remoteHelperPort")) {
                void refreshRemoteHelperIfRunning();
            }

            if (event.affectsConfiguration("remote.SSH.configFile")) {
                void refreshHosts(true);
            }
        }),
        { dispose: () => refreshHandle && clearInterval(refreshHandle) }
    );

    resetTimer();
    await syncViews(false);
    await refreshHosts(false);
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

async function pickHost(hostsProvider: HostTreeProvider): Promise<SshHost | undefined> {
    const hosts = hostsProvider.getHosts();
    if (!hosts.length) {
        void vscode.window.showInformationMessage("No SSH hosts found in your SSH configuration.");
        return undefined;
    }

    const pick = await vscode.window.showQuickPick(
        hosts.map((host) => ({
            label: host.name,
            description: host.hostname && host.hostname !== host.name ? host.hostname : host.user,
            detail: host.port ? `Port ${host.port}` : undefined,
            host,
        })),
        { placeHolder: "Select the SSH host to connect this window to" }
    );
    return pick?.host;
}

function errorToString(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

async function buildRemoteSshDiagnosticsReport(
    context: vscode.ExtensionContext,
    lastHelperDiagnostics: HelperDiagnostics,
    lastHandoffDiagnostics: HandoffDiagnostics | undefined,
): Promise<string> {
    const sshDiagnostics = await getSshHostDiagnostics();
    const helperState = context.globalState.get<RemoteHelperState>(REMOTE_HELPER_STATE_KEY);
    const helperResponded = helperState ? await pingRemoteHelper(helperState.port) : false;

    return formatRemoteSshDiagnostics({
        ...sshDiagnostics,
        helper: {
            ...lastHelperDiagnostics,
            port: helperState?.port ?? lastHelperDiagnostics.port,
            responded: helperState ? helperResponded : lastHelperDiagnostics.responded,
        },
        handoff: lastHandoffDiagnostics,
    });
}

async function openSshConfigForEditing(): Promise<void> {
    const configPath = getResolvedSshConfigPath();
    const configUri = vscode.Uri.file(configPath);

    await mkdir(path.dirname(configPath), { recursive: true });

    try {
        await vscode.workspace.fs.stat(configUri);
    } catch {
        await vscode.workspace.fs.writeFile(configUri, Buffer.from("", "utf8"));
    }

    const document = await vscode.workspace.openTextDocument(configUri);
    await vscode.window.showTextDocument(document, { preview: false });
}

async function maybeStartRemoteHelperForConnect(context: vscode.ExtensionContext, store: DeviceStore): Promise<HelperDiagnostics> {
    const mode = vscode.workspace.getConfiguration("vsduo").get<RemoteHelperAutoStartMode>("remoteHelperAutoStart", "backgroundAndOpen");
    if (mode === "off") {
        return { mode, attempted: false };
    }

    try {
        const data = await store.getData();
        if (!data.devices.length) {
            return { mode, attempted: false };
        }

        const wasRunning = await isRemoteHelperRunning(context);
        const state = await ensureRemoteHelperRunning(context, store);
        const openedBrowser = !wasRunning || mode === "backgroundAndOpen";
        if (!wasRunning || mode === "backgroundAndOpen") {
            await vscode.env.openExternal(vscode.Uri.parse(getRemoteHelperUrl(state)));
        }

        return {
            mode,
            attempted: true,
            wasRunningBefore: wasRunning,
            started: !wasRunning,
            responded: true,
            openedBrowser,
            port: state.port,
        };
    } catch (error) {
        const message = `VSDuo could not start the Remote SSH helper before connecting: ${errorToString(error)}`;
        void vscode.window.showWarningMessage(message);
        return {
            mode,
            attempted: true,
            started: false,
            responded: false,
            openedBrowser: false,
            error: message,
        };
    }
}

async function ensureRemoteHelperRunning(context: vscode.ExtensionContext, store: DeviceStore): Promise<RemoteHelperState> {
    const existing = context.globalState.get<RemoteHelperState>(REMOTE_HELPER_STATE_KEY);
    if (existing && await pingRemoteHelper(existing.port)) {
        return existing;
    }

    const data = await store.getData();
    if (!data.devices.length) {
        throw new Error("Add a Duo device before starting the Remote SSH helper.");
    }

    const port = vscode.workspace.getConfiguration("vsduo").get<number>("remoteHelperPort", 47631);
    if (await pingRemoteHelper(port)) {
        throw new Error(`Port ${port} is already in use by another process. Change vsduo.remoteHelperPort or stop the existing process.`);
    }

    const token = randomBytes(24).toString("hex");
    const helperPath = vscode.Uri.joinPath(context.extensionUri, "dist", "helper.js").fsPath;
    const payload = encodeHelperPayload(data);

    const child = fork(helperPath, [], {
        detached: true,
        execArgv: [],
        stdio: "ignore",
        env: {
            ...process.env,
            VSDUO_HELPER_DATA: payload,
            VSDUO_HELPER_PORT: String(port),
            VSDUO_HELPER_TOKEN: token,
        },
    });
    child.unref();

    const state: RemoteHelperState = { port, token };
    await waitForRemoteHelper(port);
    await context.globalState.update(REMOTE_HELPER_STATE_KEY, state);
    return state;
}

async function isRemoteHelperRunning(context: vscode.ExtensionContext): Promise<boolean> {
    const state = context.globalState.get<RemoteHelperState>(REMOTE_HELPER_STATE_KEY);
    return Boolean(state && await pingRemoteHelper(state.port));
}

async function stopRemoteHelper(context: vscode.ExtensionContext, state: RemoteHelperState): Promise<void> {
    const response = await fetch(`http://127.0.0.1:${state.port}/api/stop`, {
        method: "POST",
        headers: {
            "content-type": "application/json",
            "x-vsduo-token": state.token,
        },
        body: "{}",
    });

    if (!response.ok) {
        throw new Error(`Unable to stop helper (${response.status}).`);
    }

    await context.globalState.update(REMOTE_HELPER_STATE_KEY, undefined);
}

function encodeHelperPayload(data: StoredDeviceData): string {
    return Buffer.from(JSON.stringify(data), "utf8").toString("base64");
}

function getRemoteHelperUrl(state: RemoteHelperState): string {
    return `http://127.0.0.1:${state.port}/`;
}

async function waitForRemoteHelper(port: number): Promise<void> {
    const startedAt = Date.now();
    while (Date.now() - startedAt < 5000) {
        if (await pingRemoteHelper(port)) {
            return;
        }

        await new Promise((resolve) => setTimeout(resolve, 200));
    }

    throw new Error("The VSDuo Remote SSH helper did not start within 5 seconds.");
}

async function pingRemoteHelper(port: number): Promise<boolean> {
    try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 1000);
        const response = await fetch(`http://127.0.0.1:${port}/api/ping`, { signal: controller.signal });
        clearTimeout(timeout);
        return response.ok;
    } catch {
        return false;
    }
}

async function connectCurrentWindowToSshHost(host: SshHost): Promise<HandoffDiagnostics> {
    const result = await runRemoteSshHandoff(host, (command, ...args) => vscode.commands.executeCommand(command, ...args));
    return {
        hostName: host.name,
        succeededCommand: result.attempt.command,
        succeededArgs: result.attempt.args,
    };
}

function getLastUsedHosts(context: vscode.ExtensionContext): Record<string, string> {
    return context.globalState.get<Record<string, string>>(LAST_USED_HOSTS_KEY, {});
}

function applyLastUsedTimestamps(hosts: SshHost[], lastUsedHosts: Record<string, string>): SshHost[] {
    return hosts.map((host) => ({
        ...host,
        lastUsedAt: lastUsedHosts[host.name] ?? host.lastUsedAt,
    }));
}

async function markHostUsed(context: vscode.ExtensionContext, hostName: string, when = new Date().toISOString()): Promise<void> {
    const lastUsedHosts = getLastUsedHosts(context);
    await context.globalState.update(LAST_USED_HOSTS_KEY, {
        ...lastUsedHosts,
        [hostName]: when,
    });
}

function isSshHost(value: unknown): value is SshHost {
    if (!value || typeof value !== "object") {
        return false;
    }

    return typeof (value as SshHost).name === "string";
}

async function startDetachedAutoApprove(context: vscode.ExtensionContext, store: DeviceStore, host: SshHost): Promise<boolean> {
    const activeDevice = await getActiveDevice(store);
    if (!activeDevice) {
        void vscode.window.showWarningMessage("Auto-Approve requires an active Duo device. Falling back to helper page.");
        return false;
    }

    try {
        const helperPath = vscode.Uri.joinPath(context.extensionUri, "dist", "autoApproveHelper.js").fsPath;
        const payload = Buffer.from(JSON.stringify(activeDevice), "utf8").toString("base64");

        const child = fork(helperPath, [], {
            detached: true,
            execArgv: [],
            stdio: "ignore",
            env: {
                ...process.env,
                VSDUO_AUTO_APPROVE_DEVICE: payload,
                VSDUO_AUTO_APPROVE_DURATION_MS: "60000",
                VSDUO_AUTO_APPROVE_INTERVAL_MS: "2500",
            },
        });
        child.unref();

        void vscode.window.showInformationMessage(`Auto-Approve started for ${host.name} (1 minute).`);
        return true;
    } catch (error) {
        void vscode.window.showWarningMessage(`Unable to start Auto-Approve. Falling back to helper page: ${errorToString(error)}`);
        return false;
    }
}