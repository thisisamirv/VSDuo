import { SshHost } from "./types";

export interface HelperDiagnostics {
    mode: "off" | "background" | "backgroundAndOpen";
    attempted: boolean;
    wasRunningBefore?: boolean;
    started?: boolean;
    responded?: boolean;
    openedBrowser?: boolean;
    port?: number;
    error?: string;
}

export interface HandoffDiagnostics {
    hostName?: string;
    succeededCommand?: string;
    succeededArgs?: unknown[];
    error?: string;
}

export interface RemoteSshDiagnostics {
    resolvedConfigPath: string;
    configHosts: SshHost[];
    remoteHosts: SshHost[];
    mergedHosts: SshHost[];
    helper: HelperDiagnostics;
    handoff?: HandoffDiagnostics;
}

export function formatRemoteSshDiagnostics(report: RemoteSshDiagnostics): string {
    const helperLines = [
        `- Auto-start mode: ${report.helper.mode}`,
        `- Attempted start: ${yesNo(report.helper.attempted)}`,
        `- Was already running: ${maybeYesNo(report.helper.wasRunningBefore)}`,
        `- Started in connect flow: ${maybeYesNo(report.helper.started)}`,
        `- Responded to ping: ${maybeYesNo(report.helper.responded)}`,
        `- Opened browser/helper UI: ${maybeYesNo(report.helper.openedBrowser)}`,
        `- Helper port: ${report.helper.port ?? "unknown"}`,
        `- Helper error: ${report.helper.error ?? "none"}`,
    ];

    const handoffLines = [
        `- Target host: ${report.handoff?.hostName ?? "none yet"}`,
        `- Successful command: ${report.handoff?.succeededCommand ?? "none yet"}`,
        `- Successful args: ${report.handoff?.succeededArgs ? JSON.stringify(report.handoff.succeededArgs) : "none yet"}`,
        `- Last handoff error: ${report.handoff?.error ?? "none"}`,
    ];

    return [
        "# VSDuo Remote SSH Diagnostics",
        "",
        "## SSH Config",
        `- Resolved config path: ${report.resolvedConfigPath}`,
        "",
        "## Parsed Hosts From Config",
        ...formatHostLines(report.configHosts),
        "",
        "## Hosts From Remote SSH",
        ...formatHostLines(report.remoteHosts),
        "",
        "## Effective Hosts Shown By VSDuo",
        ...formatHostLines(report.mergedHosts),
        "",
        "## Helper",
        ...helperLines,
        "",
        "## Handoff",
        ...handoffLines,
        "",
    ].join("\n");
}

function formatHostLines(hosts: SshHost[]): string[] {
    if (!hosts.length) {
        return ["- none"];
    }

    return hosts.map((host) => {
        const details = [host.hostname, host.user, host.port].filter(Boolean).join(" | ");
        return `- ${host.name}${details ? ` (${details})` : ""}`;
    });
}

function yesNo(value: boolean): string {
    return value ? "yes" : "no";
}

function maybeYesNo(value: boolean | undefined): string {
    if (value === undefined) {
        return "unknown";
    }

    return yesNo(value);
}