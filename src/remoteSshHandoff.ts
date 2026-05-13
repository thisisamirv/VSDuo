import { SshHost } from "./types";

export interface RemoteSshCommandAttempt {
    command: string;
    args: unknown[];
}

export interface RemoteSshHandoffResult {
    attempt: RemoteSshCommandAttempt;
    attemptsTried: number;
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

export async function runRemoteSshHandoff(host: SshHost, executeCommand: ExecuteCommand): Promise<RemoteSshHandoffResult> {
    const attempts = buildRemoteSshHandoffAttempts(host);
    let lastError: unknown;

    for (const [index, attempt] of attempts.entries()) {
        try {
            await executeCommand(attempt.command, ...attempt.args);
            return {
                attempt,
                attemptsTried: index + 1,
            };
        } catch (error) {
            lastError = error;
        }
    }

    throw new Error(`Unable to hand off SSH host ${host.name} to Remote SSH${lastError ? `: ${errorToString(lastError)}` : "."}`);
}

function errorToString(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}