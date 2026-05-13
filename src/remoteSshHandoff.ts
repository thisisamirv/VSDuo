import { SshHost } from "./types";

export interface RemoteSshCommandAttempt {
    command: string;
    args: unknown[];
}

export type ExecuteCommand = (command: string, ...args: unknown[]) => Thenable<unknown> | Promise<unknown>;

export function buildRemoteSshHandoffAttempts(host: SshHost): RemoteSshCommandAttempt[] {
    return [
        {
            command: "remote-internal.openRemoteSshTarget",
            args: [host.name, true],
        },
        {
            command: "remote-internal.openRemoteSshTarget",
            args: [{ host: host.name, forceNewWindow: false }],
        },
        {
            command: "remote-internal.openRemoteSshTarget",
            args: [{ hostName: host.name, forceNewWindow: false }],
        },
        {
            command: "opensshremotes.openEmptyWindowInCurrentWindow",
            args: [host.name],
        },
    ];
}

export async function runRemoteSshHandoff(host: SshHost, executeCommand: ExecuteCommand): Promise<void> {
    const attempts = buildRemoteSshHandoffAttempts(host);
    let lastError: unknown;

    for (const attempt of attempts) {
        try {
            await executeCommand(attempt.command, ...attempt.args);
            return;
        } catch (error) {
            lastError = error;
        }
    }

    throw new Error(`Unable to hand off SSH host ${host.name} to Remote SSH${lastError ? `: ${errorToString(lastError)}` : "."}`);
}

function errorToString(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}