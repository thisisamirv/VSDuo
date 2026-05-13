import test from "node:test";
import assert from "node:assert/strict";
import { collectRemoteSshHosts, normalizeRemoteHostEntry } from "../src/remoteSshHosts";
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