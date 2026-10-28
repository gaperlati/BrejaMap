/**
 * Tests for the Google Identity Services helpers: run with `npm run test:scripts`.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash, webcrypto } from "node:crypto";
import {
  createLoginNonce,
  googleButtonWidth,
  resolveGoogleClientId,
  sha256Hex,
  type NonceCrypto,
} from "./google-identity";

const crypto = webcrypto as unknown as NonceCrypto;

test("resolveGoogleClientId accepts a trimmed web client id", () => {
  assert.equal(
    resolveGoogleClientId("  123-abc_DEF.apps.googleusercontent.com \n"),
    "123-abc_DEF.apps.googleusercontent.com"
  );
});

test("resolveGoogleClientId rejects missing or malformed values", () => {
  assert.equal(resolveGoogleClientId(undefined), null);
  assert.equal(resolveGoogleClientId(null), null);
  assert.equal(resolveGoogleClientId(""), null);
  assert.equal(resolveGoogleClientId("   "), null);
  assert.equal(resolveGoogleClientId("not-a-client-id"), null);
  assert.equal(resolveGoogleClientId("123.apps.googleusercontent.com.evil.com"), null);
  assert.equal(resolveGoogleClientId("a b.apps.googleusercontent.com"), null);
});

test("sha256Hex matches node's createHash", async () => {
  for (const value of ["", "abc", "nonce-çã"]) {
    assert.equal(await sha256Hex(value, crypto), createHash("sha256").update(value, "utf8").digest("hex"));
  }
});

test("createLoginNonce returns a 64-char hex raw nonce and its SHA-256", async () => {
  const nonce = await createLoginNonce(crypto);
  assert.match(nonce.raw, /^[0-9a-f]{64}$/);
  assert.match(nonce.hashed, /^[0-9a-f]{64}$/);
  assert.notEqual(nonce.raw, nonce.hashed);
  assert.equal(nonce.hashed, createHash("sha256").update(nonce.raw).digest("hex"));
});

test("createLoginNonce is fresh on every call", async () => {
  const [a, b] = await Promise.all([createLoginNonce(crypto), createLoginNonce(crypto)]);
  assert.notEqual(a.raw, b.raw);
  assert.notEqual(a.hashed, b.hashed);
});

test("createLoginNonce uses the injected random source", async () => {
  const fixed: NonceCrypto = {
    getRandomValues: <T extends ArrayBufferView | null>(array: T) => {
      if (array) new Uint8Array(array.buffer).fill(0xab);
      return array;
    },
    subtle: crypto.subtle,
  };
  const nonce = await createLoginNonce(fixed);
  assert.equal(nonce.raw, "ab".repeat(32));
});

test("googleButtonWidth clamps to Google's 200-400 px range", () => {
  assert.equal(googleButtonWidth(150), 200);
  assert.equal(googleButtonWidth(310.7), 310);
  assert.equal(googleButtonWidth(900), 400);
  assert.equal(googleButtonWidth(0), 320);
  assert.equal(googleButtonWidth(Number.NaN), 320);
});
