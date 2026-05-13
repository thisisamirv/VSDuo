import { createServer, IncomingMessage, Server, ServerResponse } from "node:http";
import { DuoDevice, DuoTransaction, StoredDeviceData } from "./types";

export interface HelperTransactionSummary {
    urgid: string;
    title: string;
    details: string;
    verificationDigits?: number;
}

export interface HelperDeviceSummary {
    pkey: string;
    name: string;
    host: string;
    error?: string;
    totp?: string;
    transactions: HelperTransactionSummary[];
}

export interface HelperSnapshot {
    refreshedAt: string;
    devices: HelperDeviceSummary[];
}

export interface HelperClient {
    listTransactions(device: DuoDevice): Promise<DuoTransaction[]>;
    approveTransaction(device: DuoDevice, transactions: DuoTransaction[], txId: string, verificationCode?: string): Promise<void>;
    generateCurrentTotp(device: DuoDevice): string | undefined;
}

export interface HelperServerOptions {
    token: string;
    data: StoredDeviceData;
    port: number;
    client: HelperClient;
}

export interface StartedHelperServer {
    server: Server;
    port: number;
}

export async function startHelperServer(options: HelperServerOptions): Promise<StartedHelperServer> {
    const server = createHelperServer(options);
    await new Promise<void>((resolve, reject) => {
        const onError = (error: Error): void => {
            server.off("listening", onListening);
            reject(error);
        };
        const onListening = (): void => {
            server.off("error", onError);
            resolve();
        };

        server.once("error", onError);
        server.once("listening", onListening);
        server.listen(options.port, "127.0.0.1");
    });

    const address = server.address();
    if (!address || typeof address === "string") {
        throw new Error("Unable to resolve helper server address.");
    }

    return {
        server,
        port: address.port,
    };
}

export function createHelperServer(options: HelperServerOptions): Server {
    const devices = options.data.devices.slice().sort((left, right) => left.name.localeCompare(right.name));
    const devicesByKey = new Map(devices.map((device) => [device.pkey, device]));
    const server = createServer((request, response) => {
        void handleRequest(request, response, options, devices, devicesByKey, server);
    });

    return server;
}

async function handleRequest(
    request: IncomingMessage,
    response: ServerResponse,
    options: HelperServerOptions,
    devices: DuoDevice[],
    devicesByKey: Map<string, DuoDevice>,
    server: Server,
): Promise<void> {
    try {
        const url = new URL(request.url ?? "/", `http://127.0.0.1:${options.port}`);

        if (request.method === "GET" && url.pathname === "/") {
            response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
            response.end(renderPage(options.token));
            return;
        }

        if (request.method === "GET" && url.pathname === "/api/ping") {
            writeJson(response, 200, { ok: true, deviceCount: devices.length });
            return;
        }

        if (url.pathname.startsWith("/api/") && request.headers["x-vsduo-token"] !== options.token) {
            writeJson(response, 403, { error: "Forbidden" });
            return;
        }

        if (request.method === "GET" && url.pathname === "/api/state") {
            writeJson(response, 200, await buildSnapshot(devices, options.client));
            return;
        }

        if (request.method === "POST" && url.pathname === "/api/approve") {
            const body = await readJsonBody(request);
            const device = getDevice(devicesByKey, String(body.pkey ?? ""));
            const urgid = String(body.urgid ?? "").trim();
            if (!urgid) {
                throw new Error("A transaction id is required.");
            }

            const verificationCode = typeof body.verificationCode === "string" && body.verificationCode.trim().length
                ? body.verificationCode.trim()
                : undefined;
            const transactions = await options.client.listTransactions(device);
            await options.client.approveTransaction(device, transactions, urgid, verificationCode);
            writeJson(response, 200, await buildSnapshot(devices, options.client));
            return;
        }

        if (request.method === "POST" && url.pathname === "/api/deny") {
            const body = await readJsonBody(request);
            const device = getDevice(devicesByKey, String(body.pkey ?? ""));
            const transactions = await options.client.listTransactions(device);
            if (!transactions.length) {
                throw new Error("No pending transactions found for that device.");
            }

            await options.client.approveTransaction(device, transactions, "__deny_all__");
            writeJson(response, 200, await buildSnapshot(devices, options.client));
            return;
        }

        if (request.method === "POST" && url.pathname === "/api/stop") {
            writeJson(response, 200, { ok: true });
            setTimeout(() => {
                server.close();
            }, 0).unref();
            return;
        }

        writeJson(response, 404, { error: "Not found" });
    } catch (error) {
        writeJson(response, 500, { error: errorToString(error) });
    }
}

function getDevice(devicesByKey: Map<string, DuoDevice>, pkey: string): DuoDevice {
    const device = devicesByKey.get(pkey);
    if (!device) {
        throw new Error(`Unknown device: ${pkey}`);
    }

    return device;
}

async function buildSnapshot(devices: DuoDevice[], client: HelperClient): Promise<HelperSnapshot> {
    const result: HelperDeviceSummary[] = [];

    for (const device of devices) {
        try {
            const transactions = await client.listTransactions(device);
            result.push({
                pkey: device.pkey,
                name: device.name,
                host: device.host,
                totp: client.generateCurrentTotp(device),
                transactions: transactions.map((transaction) => summarizeTransaction(transaction)),
            });
        } catch (error) {
            result.push({
                pkey: device.pkey,
                name: device.name,
                host: device.host,
                error: errorToString(error),
                totp: client.generateCurrentTotp(device),
                transactions: [],
            });
        }
    }

    return {
        refreshedAt: new Date().toISOString(),
        devices: result,
    };
}

function summarizeTransaction(transaction: DuoTransaction): HelperTransactionSummary {
    const flattened = flattenAttributes(transaction.attributes);
    const title = flattened.find((line) => line.startsWith("Location:") || line.startsWith("Application:")) ?? `Transaction ${transaction.urgid}`;
    return {
        urgid: transaction.urgid,
        title,
        details: flattened.join(" | "),
        verificationDigits: transaction.step_up_code_info?.num_digits,
    };
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

async function readJsonBody(request: IncomingMessage): Promise<Record<string, unknown>> {
    const chunks: Buffer[] = [];
    for await (const chunk of request) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }

    const raw = Buffer.concat(chunks).toString("utf8").trim();
    return raw ? JSON.parse(raw) as Record<string, unknown> : {};
}

function writeJson(response: ServerResponse, statusCode: number, payload: unknown): void {
    response.writeHead(statusCode, { "content-type": "application/json; charset=utf-8" });
    response.end(JSON.stringify(payload));
}

function errorToString(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

function renderPage(token: string): string {
    return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>VSDuo Remote Helper</title>
  <style>
    :root { color-scheme: light; --bg: #f3efe7; --panel: #fffaf2; --line: #d8c8ae; --text: #1f1a14; --muted: #6f6557; --accent: #b96333; --accent-strong: #94471b; --danger: #a02f23; --success: #206245; }
    * { box-sizing: border-box; }
    body { margin: 0; font-family: Georgia, "Times New Roman", serif; color: var(--text); background: radial-gradient(circle at top left, rgba(185, 99, 51, 0.18), transparent 28%), linear-gradient(180deg, #f8f3eb 0%, var(--bg) 100%); min-height: 100vh; }
    main { max-width: 980px; margin: 0 auto; padding: 32px 20px 64px; }
    header { display: flex; flex-wrap: wrap; justify-content: space-between; gap: 16px; align-items: end; margin-bottom: 24px; }
    h1 { margin: 0; font-size: clamp(2rem, 4vw, 3.1rem); line-height: 1; }
    p { margin: 0; color: var(--muted); max-width: 42rem; }
    .actions { display: flex; gap: 12px; flex-wrap: wrap; }
    button { border: 1px solid transparent; background: var(--accent); color: white; padding: 10px 16px; border-radius: 999px; cursor: pointer; font: inherit; }
    button.secondary { background: transparent; color: var(--text); border-color: var(--line); }
    button.danger { background: var(--danger); }
    .meta { margin-top: 12px; font-size: 0.95rem; color: var(--muted); }
    .banner { margin: 18px 0 26px; padding: 14px 16px; border: 1px solid var(--line); border-radius: 18px; background: rgba(255, 250, 242, 0.9); color: var(--muted); }
    .grid { display: grid; gap: 18px; }
    .card { background: rgba(255, 250, 242, 0.92); border: 1px solid var(--line); border-radius: 24px; padding: 18px; box-shadow: 0 18px 50px rgba(51, 34, 12, 0.07); }
    .card-header { display: flex; justify-content: space-between; gap: 16px; align-items: start; flex-wrap: wrap; }
    .card h2 { margin: 0; font-size: 1.5rem; }
    .host { color: var(--muted); font-size: 0.95rem; margin-top: 4px; }
    .totp { display: inline-flex; align-items: center; gap: 8px; padding: 8px 12px; border-radius: 999px; background: rgba(32, 98, 69, 0.12); color: var(--success); font-weight: 700; letter-spacing: 0.08em; }
    .error { margin-top: 12px; color: var(--danger); }
    .transaction-list { margin-top: 16px; display: grid; gap: 12px; }
    .transaction { border: 1px solid rgba(216, 200, 174, 0.8); border-radius: 18px; padding: 14px; background: rgba(255, 255, 255, 0.75); }
    .transaction-title { font-weight: 700; }
    .transaction-details { margin-top: 6px; color: var(--muted); font-size: 0.95rem; }
    .transaction-actions { margin-top: 12px; display: flex; gap: 10px; flex-wrap: wrap; }
    .empty { color: var(--muted); padding: 12px 0 2px; }
    .flash { min-height: 1.5rem; margin-top: 10px; color: var(--accent-strong); }
  </style>
</head>
<body>
  <main>
    <header>
      <div>
        <h1>VSDuo Remote Helper</h1>
        <p>Keep this page open while Remote SSH reloads the VS Code window. This helper keeps running locally until you stop it.</p>
        <div class="meta" id="refreshedAt"></div>
      </div>
      <div class="actions">
        <button type="button" class="secondary" id="refreshButton">Refresh now</button>
        <button type="button" class="danger" id="stopButton">Stop helper</button>
      </div>
    </header>
    <div class="banner">The helper listens only on 127.0.0.1 and keeps your Duo material in the helper process memory for this session.</div>
    <div class="flash" id="flash"></div>
    <section class="grid" id="devices"></section>
  </main>
  <script>
    const token = ${JSON.stringify(token)};
    const flash = document.getElementById("flash");
    const devicesRoot = document.getElementById("devices");
    const refreshedAt = document.getElementById("refreshedAt");
    const refreshButton = document.getElementById("refreshButton");
    const stopButton = document.getElementById("stopButton");
    async function request(path, options = {}) {
      const response = await fetch(path, { ...options, headers: { "content-type": "application/json", "x-vsduo-token": token, ...(options.headers ?? {}) } });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Request failed.");
      return payload;
    }
    function setFlash(message) { flash.textContent = message; }
    function el(tagName, className, text) {
      const node = document.createElement(tagName);
      if (className) node.className = className;
      if (text) node.textContent = text;
      return node;
    }
    function render(snapshot) {
      refreshedAt.textContent = "Last refreshed " + new Date(snapshot.refreshedAt).toLocaleString();
      devicesRoot.replaceChildren();
      if (!snapshot.devices.length) { devicesRoot.append(el("div", "card", "No Duo devices are available in this helper session.")); return; }
      for (const device of snapshot.devices) {
        const card = el("article", "card");
        const header = el("div", "card-header");
        const titleGroup = el("div");
        titleGroup.append(el("h2", "", device.name));
        titleGroup.append(el("div", "host", device.host));
        header.append(titleGroup);
        const right = el("div");
        if (device.totp) right.append(el("div", "totp", "TOTP " + device.totp));
        header.append(right);
        card.append(header);
        const denyButton = el("button", "secondary", "Deny all pending");
        denyButton.addEventListener("click", async () => {
          try {
            setFlash("Denying pending Duo prompts for " + device.name + "...");
            const snapshot = await request("/api/deny", { method: "POST", body: JSON.stringify({ pkey: device.pkey }) });
            render(snapshot);
            setFlash("Denied pending Duo prompts for " + device.name + ".");
          } catch (error) { setFlash(error instanceof Error ? error.message : String(error)); }
        });
        card.append(denyButton);
        if (device.error) card.append(el("div", "error", device.error));
        const list = el("div", "transaction-list");
        if (!device.transactions.length) list.append(el("div", "empty", "No pending transactions right now."));
        for (const transaction of device.transactions) {
          const item = el("div", "transaction");
          item.append(el("div", "transaction-title", transaction.title));
          item.append(el("div", "transaction-details", transaction.details || transaction.urgid));
          if (transaction.verificationDigits) item.append(el("div", "transaction-details", "Requires " + transaction.verificationDigits + " verification digits."));
          const actions = el("div", "transaction-actions");
          const approveButton = el("button", "", "Approve");
          approveButton.addEventListener("click", async () => {
            try {
              let verificationCode;
              if (transaction.verificationDigits) {
                verificationCode = window.prompt("Enter the " + transaction.verificationDigits + "-digit Duo verification code", "") || "";
                if (!verificationCode) return;
              }
              setFlash("Approving " + transaction.title + " on " + device.name + "...");
              const snapshot = await request("/api/approve", { method: "POST", body: JSON.stringify({ pkey: device.pkey, urgid: transaction.urgid, verificationCode }) });
              render(snapshot);
              setFlash("Approved " + transaction.title + " on " + device.name + ".");
            } catch (error) { setFlash(error instanceof Error ? error.message : String(error)); }
          });
          actions.append(approveButton);
          item.append(actions);
          list.append(item);
        }
        card.append(list);
        devicesRoot.append(card);
      }
    }
    async function refresh() {
      try {
        const snapshot = await request("/api/state");
        render(snapshot);
        if (!flash.textContent) setFlash("Ready.");
      } catch (error) { setFlash(error instanceof Error ? error.message : String(error)); }
    }
    refreshButton.addEventListener("click", async () => { setFlash("Refreshing Duo transactions..."); await refresh(); });
    stopButton.addEventListener("click", async () => {
      try {
        await request("/api/stop", { method: "POST", body: "{}" });
        setFlash("Helper stopped. This page can be closed.");
      } catch (error) { setFlash(error instanceof Error ? error.message : String(error)); }
    });
    void refresh();
    window.setInterval(() => { void refresh(); }, 5000);
  </script>
</body>
</html>`;
}