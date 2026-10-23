import { test } from "node:test";
import assert from "node:assert/strict";
import { rootCertificates, createSecureContext, type ConnectionOptions } from "node:tls";
import { Client } from "pg";
import { postgresConfig } from "../src/lib/postgres-config";

const url = "postgresql://test:test@localhost:5432/test";
const certificate = rootCertificates[0];

test("provider CA reaches the actual pg client without disabling TLS verification", () => {
  for (const pem of [certificate, certificate.replace(/\n/g, "\\n"), certificate.replace(/\n/g, "\\r\\n")]) {
    const client = new Client(postgresConfig(url, pem));
    const ssl = client.ssl as unknown as ConnectionOptions;
    assert.equal(ssl.rejectUnauthorized, true);
    assert.ok(Array.isArray(ssl.ca) && ssl.ca.includes(certificate.trim()));
    assert.equal(ssl.checkServerIdentity, undefined); // Node's hostname check remains enabled.
    assert.doesNotThrow(() => createSecureContext(ssl));
  }
});

test("URL SSL flags cannot discard the configured CA or weaken verification", () => {
  for (const query of ["sslmode=require", "sslmode=no-verify", "sslmode=disable", "ssl=0", "ssl=no-verify", "ssl=true", "sslnegotiation=direct", "uselibpqcompat=true&sslmode=require"]) {
    const client = new Client(postgresConfig(`${url}?${query}`, certificate));
    const ssl = client.ssl as unknown as ConnectionOptions;
    assert.equal(ssl.rejectUnauthorized, true, query);
    assert.ok(Array.isArray(ssl.ca) && ssl.ca.includes(certificate.trim()), query);
    assert.equal(ssl.checkServerIdentity, undefined, query);
  }
});

test("default system trust remains enabled when no custom CA is supplied", () => {
  for (const value of [undefined, "", "  "]) {
    assert.deepEqual(new Client(postgresConfig(url, value)).ssl, { rejectUnauthorized: true });
  }
});

test("invalid certificates and accidental private keys fail with sanitized errors", () => {
  for (const value of ["private-test-value", "-----BEGIN CERTIFICATE-----\nbad\n-----END CERTIFICATE-----", certificate + "\n-----BEGIN PRIVATE KEY-----\nprivate-test-value"]) {
    assert.throws(() => postgresConfig(url, value), { message: "database_ssl_ca_invalid" });
  }
});

test("filesystem certificate options and invalid URLs fail without leaking input", () => {
  for (const key of ["sslrootcert", "sslcert", "sslkey"]) {
    assert.throws(() => postgresConfig(`${url}?${key}=private-test-path`, certificate), { message: "database_url_invalid" });
  }
  assert.throws(() => postgresConfig("private-test-value"), { message: "database_url_invalid" });
});
