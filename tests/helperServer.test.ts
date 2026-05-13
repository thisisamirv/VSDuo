import test from "node:test";
import assert from "node:assert/strict";
import { DuoDevice, DuoTransaction, StoredDeviceData } from "../src/types";
import { HelperClient, startHelperServer } from "../src/helperServer";

class FakeHelperClient implements HelperClient {
    public readonly approvals: Array<{ pkey: string; txId: string; verificationCode?: string }> = [];

    public constructor(private readonly transactionsByDevice: Map<string, DuoTransaction[]>) { }

    public async listTransactions(device: DuoDevice): Promise<DuoTransaction[]> {
        return this.transactionsByDevice.get(device.pkey) ?? [];
    }

    public async approveTransaction(device: DuoDevice, _transactions: DuoTransaction[], txId: string, verificationCode?: string): Promise<void> {
        this.approvals.push({ pkey: device.pkey, txId, verificationCode });
        this.transactionsByDevice.set(device.pkey, []);
    }

    public generateCurrentTotp(device: DuoDevice): string | undefined {
        return `${device.name}-123456`;
    }

    public resetTransactions(pkey: string, transactions: DuoTransaction[]): void {
        this.transactionsByDevice.set(pkey, transactions);
    }
}

function createDevice(overrides: Partial<DuoDevice> = {}): DuoDevice {
    return {
        pkey: "device-1",
        host: "api-123456789012345678901234.duosecurity.com",
        publicRaw: "public",
        privateRaw: "private",
        name: "Work Phone",
        ...overrides,
    };
}

function createTransactions(): DuoTransaction[] {
    return [{
        urgid: "urgid-1",
        attributes: [["Application", "VS Code"], ["Location", "SSH"]],
        step_up_code_info: { num_digits: 3 },
    }];
}

async function startFixture() {
    const device = createDevice();
    const data: StoredDeviceData = { activeDevice: device.pkey, devices: [device] };
    const client = new FakeHelperClient(new Map([[device.pkey, createTransactions()]]));
    const started = await startHelperServer({ token: "secret-token", data, port: 0, client });
    const baseUrl = `http://127.0.0.1:${started.port}`;

    return {
        device,
        client,
        baseUrl,
        async close(): Promise<void> {
            if (started.server.listening) {
                await new Promise<void>((resolve, reject) => started.server.close((error) => error ? reject(error) : resolve()));
            }
        },
    };
}

async function waitForServerClosed(baseUrl: string): Promise<void> {
    const startedAt = Date.now();
    while (Date.now() - startedAt < 2000) {
        try {
            await fetch(`${baseUrl}/api/ping`);
            await new Promise((resolve) => setTimeout(resolve, 50));
        } catch {
            return;
        }
    }

    throw new Error("Helper server did not stop in time.");
}

test("helper server exposes ping and state endpoints", async (t) => {
    const fixture = await startFixture();
    t.after(async () => { await fixture.close(); });

    const ping = await fetch(`${fixture.baseUrl}/api/ping`);
    assert.equal(ping.status, 200);
    assert.deepEqual(await ping.json(), { ok: true, deviceCount: 1 });

    const state = await fetch(`${fixture.baseUrl}/api/state`, {
        headers: { "x-vsduo-token": "secret-token" },
    });
    assert.equal(state.status, 200);
    const snapshot = await state.json() as { devices: Array<{ name: string; totp?: string; transactions: Array<{ urgid: string }> }> };
    assert.equal(snapshot.devices[0]?.name, "Work Phone");
    assert.equal(snapshot.devices[0]?.totp, "Work Phone-123456");
    assert.equal(snapshot.devices[0]?.transactions[0]?.urgid, "urgid-1");
});

test("helper server rejects protected endpoints without a token", async (t) => {
    const fixture = await startFixture();
    t.after(async () => { await fixture.close(); });

    const response = await fetch(`${fixture.baseUrl}/api/state`);
    assert.equal(response.status, 403);
    assert.deepEqual(await response.json(), { error: "Forbidden" });
});

test("helper server approve and deny endpoints call the helper client", async (t) => {
    const fixture = await startFixture();
    t.after(async () => { await fixture.close(); });

    const approve = await fetch(`${fixture.baseUrl}/api/approve`, {
        method: "POST",
        headers: {
            "content-type": "application/json",
            "x-vsduo-token": "secret-token",
        },
        body: JSON.stringify({
            pkey: fixture.device.pkey,
            urgid: "urgid-1",
            verificationCode: "123",
        }),
    });
    assert.equal(approve.status, 200);
    assert.deepEqual(fixture.client.approvals[0], {
        pkey: fixture.device.pkey,
        txId: "urgid-1",
        verificationCode: "123",
    });

    fixture.client.approvals.length = 0;
    fixture.client.resetTransactions(fixture.device.pkey, createTransactions());

    const deny = await fetch(`${fixture.baseUrl}/api/deny`, {
        method: "POST",
        headers: {
            "content-type": "application/json",
            "x-vsduo-token": "secret-token",
        },
        body: JSON.stringify({ pkey: fixture.device.pkey }),
    });
    assert.equal(deny.status, 200);
    assert.deepEqual(fixture.client.approvals[0], {
        pkey: fixture.device.pkey,
        txId: "__deny_all__",
        verificationCode: undefined,
    });
});

test("helper server stop endpoint shuts the server down", async (t) => {
    const fixture = await startFixture();
    t.after(async () => { await fixture.close(); });

    const stop = await fetch(`${fixture.baseUrl}/api/stop`, {
        method: "POST",
        headers: {
            "content-type": "application/json",
            "x-vsduo-token": "secret-token",
        },
        body: "{}",
    });
    assert.equal(stop.status, 200);
    assert.deepEqual(await stop.json(), { ok: true });

    await waitForServerClosed(fixture.baseUrl);
});