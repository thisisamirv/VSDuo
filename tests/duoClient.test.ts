import test from "node:test";
import assert from "node:assert/strict";
import { base32Encode, parseActivationCode } from "../src/duoClient";

test("parseActivationCode decodes the embedded host", () => {
    const host = "api-123456789012345678901234";
    const identifier = "ABCDEFGHIJKLMNOPQRST";
    const raw = `${identifier}-${Buffer.from(host, "utf8").toString("base64")}`;

    assert.deepEqual(parseActivationCode(raw), { identifier, host });
});

test("parseActivationCode rejects malformed shapes", () => {
    assert.throws(
        () => parseActivationCode("not-a-real-code"),
        /Activation code/
    );
});

test("base32Encode encodes ASCII secrets without padding", () => {
    assert.equal(base32Encode("Hello!"), "JBSWY3DPEE");
});