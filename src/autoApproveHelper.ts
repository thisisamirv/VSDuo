import { DuoClient } from "./duoClient";
import { DuoDevice } from "./types";

const DEFAULT_DURATION_MS = 60_000;
const DEFAULT_INTERVAL_MS = 2_500;

async function main(): Promise<void> {
    const encodedDevice = process.env.VSDUO_AUTO_APPROVE_DEVICE;
    if (!encodedDevice) {
        throw new Error("Missing VSDUO_AUTO_APPROVE_DEVICE.");
    }

    const device = JSON.parse(Buffer.from(encodedDevice, "base64").toString("utf8")) as DuoDevice;
    const durationMs = parsePositiveInt(process.env.VSDUO_AUTO_APPROVE_DURATION_MS, DEFAULT_DURATION_MS);
    const intervalMs = parsePositiveInt(process.env.VSDUO_AUTO_APPROVE_INTERVAL_MS, DEFAULT_INTERVAL_MS);

    const client = new DuoClient();
    const seenTransactions = new Set<string>();
    let running = false;

    const pollAndApprove = async (): Promise<void> => {
        if (running) {
            return;
        }

        running = true;
        try {
            const transactions = await client.listTransactions(device);
            for (const transaction of transactions) {
                if (seenTransactions.has(transaction.urgid)) {
                    continue;
                }

                if (transaction.step_up_code_info?.num_digits) {
                    seenTransactions.add(transaction.urgid);
                    continue;
                }

                await client.approveTransaction(device, [transaction], transaction.urgid);
                seenTransactions.add(transaction.urgid);
            }
        } finally {
            running = false;
        }
    };

    await pollAndApprove();
    const interval = setInterval(() => {
        void pollAndApprove();
    }, intervalMs);

    setTimeout(() => {
        clearInterval(interval);
        process.exit(0);
    }, durationMs);
}

function parsePositiveInt(value: string | undefined, fallback: number): number {
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed <= 0) {
        return fallback;
    }

    return Math.floor(parsed);
}

void main().catch(() => {
    process.exit(1);
});
