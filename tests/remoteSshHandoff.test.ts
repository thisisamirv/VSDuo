import test from "node:test";
import assert from "node:assert/strict";
import { buildRemoteSshHandoffAttempts, runRemoteSshHandoff } from "../src/remoteSshHandoff";
import type { SshHost } from "../src/types";

const host: SshHost = { name: "server-a", source: "remote-ssh" };

test("buildRemoteSshHandoffAttempts returns the expected command order", () => {
    assert.deepEqual(buildRemoteSshHandoffAttempts(host), [
        {
            command: "remote-internal.openRemoteSshTarget",
            args: ["server-a", true],
        },
        {
            command: "remote-internal.openRemoteSshTarget",
            args: [{ host: "server-a", forceNewWindow: false }],
        },
        {
            command: "remote-internal.openRemoteSshTarget",
            args: [{ hostName: "server-a", forceNewWindow: false }],
        },
        {
            command: "opensshremotes.openEmptyWindowInCurrentWindow",
            args: ["server-a"],
        },
    ]);
});

test("runRemoteSshHandoff stops after the first successful attempt", async () => {
    const calls: Array<{ command: string; args: unknown[] }> = [];

    const result = await runRemoteSshHandoff(host, async (command, ...args) => {
        calls.push({ command, args });
        if (calls.length < 3) {
            throw new Error(`failed ${calls.length}`);
        }
    });

    assert.deepEqual(calls, [
        { command: "remote-internal.openRemoteSshTarget", args: ["server-a", true] },
        { command: "remote-internal.openRemoteSshTarget", args: [{ host: "server-a", forceNewWindow: false }] },
        { command: "remote-internal.openRemoteSshTarget", args: [{ hostName: "server-a", forceNewWindow: false }] },
    ]);
    assert.deepEqual(result, {
        attempt: {
            command: "remote-internal.openRemoteSshTarget",
            args: [{ hostName: "server-a", forceNewWindow: false }],
        },
        attemptsTried: 3,
    });
});

test("runRemoteSshHandoff surfaces the final handoff failure", async () => {
    await assert.rejects(
        () => runRemoteSshHandoff(host, async () => {
            throw new Error("boom");
        }),
        /Unable to hand off SSH host server-a to Remote SSH: boom/
    );
});