import { DuoClient } from "./duoClient";
import { startHelperServer } from "./helperServer";
import { StoredDeviceData } from "./types";

const token = process.env.VSDUO_HELPER_TOKEN;
const encodedData = process.env.VSDUO_HELPER_DATA;
const port = Number(process.env.VSDUO_HELPER_PORT ?? "47631");

if (!token) {
    throw new Error("Missing VSDUO_HELPER_TOKEN.");
}

if (!encodedData) {
    throw new Error("Missing VSDUO_HELPER_DATA.");
}

if (!Number.isInteger(port) || port < 0 || port > 65535) {
    throw new Error(`Invalid VSDUO_HELPER_PORT: ${String(process.env.VSDUO_HELPER_PORT ?? "")}`);
}

const data = JSON.parse(Buffer.from(encodedData, "base64").toString("utf8")) as StoredDeviceData;

void startHelperServer({
    token,
    data,
    port,
    client: new DuoClient(),
});