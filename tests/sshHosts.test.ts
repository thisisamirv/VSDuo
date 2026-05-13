import test from "node:test";
import assert from "node:assert/strict";
import { collectRemoteSshHosts, mergeSshHosts, normalizeRemoteHostEntry } from "../src/remoteSshHosts";
import { formatRemoteSshDiagnostics } from "../src/remoteSshDiagnostics";
import { resolveSshConfigPath } from "../src/sshConfigPath";
import { parseSshConfigHosts } from "../src/sshConfigParser";

test("parseSshConfigHosts extracts named hosts and ignores wildcards", () => {
    const hosts = parseSshConfigHosts(`
Host server-a
  HostName server-a.example.com
  User alice

Host *
  ForwardAgent yes

Host server-b *.internal
  HostName server-b.example.com
  Port 2222
`);

    assert.deepEqual(hosts, [
        {
            name: "server-a",
            hostname: "server-a.example.com",
            user: "alice",
            port: undefined,
            identityFile: undefined,
            source: "ssh-config",
        },
        {
            name: "server-b",
            hostname: "server-b.example.com",
            user: undefined,
            port: "2222",
            identityFile: undefined,
            source: "ssh-config",
        },
    ]);
});

test("parseSshConfigHosts deduplicates repeated aliases", () => {
    const hosts = parseSshConfigHosts(`
Host shared
  HostName first.example.com

Host shared
  HostName second.example.com
`);

    assert.equal(hosts.length, 1);
    assert.equal(hosts[0]?.hostname, "first.example.com");
});

test("normalizeRemoteHostEntry supports string and object result shapes", () => {
    assert.equal(normalizeRemoteHostEntry(" server-a "), "server-a");
    assert.equal(normalizeRemoteHostEntry({ host: "server-b" }), "server-b");
    assert.equal(normalizeRemoteHostEntry({ hostname: "server-c" }), "server-c");
    assert.equal(normalizeRemoteHostEntry({ label: "server-d" }), "server-d");
    assert.equal(normalizeRemoteHostEntry({ name: "server-e" }), "server-e");
    assert.equal(normalizeRemoteHostEntry({}), undefined);
});

test("collectRemoteSshHosts deduplicates configured hostnames", () => {
    const hosts = collectRemoteSshHosts([
        "server-a",
        { host: "server-b" },
        { hostname: "server-a" },
        { name: "server-c" },
    ]);

    assert.deepEqual(hosts, [
        { name: "server-a", source: "remote-ssh" },
        { name: "server-b", source: "remote-ssh" },
        { name: "server-c", source: "remote-ssh" },
    ]);
});

test("mergeSshHosts keeps ssh-config metadata while preferring Remote SSH availability", () => {
    const merged = mergeSshHosts(
        [
            { name: "server-a", source: "remote-ssh" },
            { name: "server-b", source: "remote-ssh" },
        ],
        [
            { name: "server-a", hostname: "server-a.example.com", user: "alice", port: "22", identityFile: "~/.ssh/id_ed25519", source: "ssh-config" },
            { name: "server-c", hostname: "server-c.example.com", source: "ssh-config" },
        ]
    );

    assert.deepEqual(merged, [
        {
            name: "server-a",
            hostname: "server-a.example.com",
            user: "alice",
            port: "22",
            identityFile: "~/.ssh/id_ed25519",
            source: "remote-ssh",
        },
        {
            name: "server-b",
            source: "remote-ssh",
            hostname: undefined,
            user: undefined,
            port: undefined,
            identityFile: undefined,
        },
        {
            name: "server-c",
            hostname: "server-c.example.com",
            source: "ssh-config",
        },
    ]);
});

test("resolveSshConfigPath expands home-relative SSH config paths", () => {
    assert.equal(resolveSshConfigPath("", "/home/alice"), "/home/alice/.ssh/config");
    assert.equal(resolveSshConfigPath("~/custom/config", "/home/alice"), "/home/alice/custom/config");
    assert.equal(resolveSshConfigPath("C:/Users/alice/.ssh/config", "/home/alice"), "C:/Users/alice/.ssh/config");
});

test("formatRemoteSshDiagnostics renders the requested runtime facts", () => {
    const content = formatRemoteSshDiagnostics({
        resolvedConfigPath: "/home/alice/.ssh/config",
        configHosts: [{ name: "server-a", source: "ssh-config", hostname: "server-a.example.com" }],
        remoteHosts: [{ name: "server-a", source: "remote-ssh" }],
        mergedHosts: [{ name: "server-a", source: "remote-ssh", hostname: "server-a.example.com" }],
        helper: {
            mode: "backgroundAndOpen",
            attempted: true,
            started: true,
            responded: true,
            openedBrowser: true,
            port: 47631,
        },
        handoff: {
            hostName: "server-a",
            succeededCommand: "remote-internal.openRemoteSshTarget",
            succeededArgs: ["server-a", true],
        },
    });

    assert.match(content, /Resolved config path: \/home\/alice\/.ssh\/config/);
    assert.match(content, /server-a\.example\.com/);
    assert.match(content, /Successful command: remote-internal\.openRemoteSshTarget/);
    assert.match(content, /Responded to ping: yes/);
});