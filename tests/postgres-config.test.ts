import { test } from "node:test";
import assert from "node:assert/strict";
import { rootCertificates, createSecureContext, type ConnectionOptions } from "node:tls";
import { Client } from "pg";
import { postgresConfig } from "../src/lib/postgres-config";
import { X509Certificate } from "node:crypto";
import { supabaseRootCertificate } from "../src/lib/supabase-ca";

const url = "postgresql://test:test@localhost:5432/test";
const certificate = rootCertificates[0];

test("bundled Supabase CA matches the supplied public certificate", () => {
  const cert = new X509Certificate(supabaseRootCertificate);
  assert.equal(cert.ca, true);
  assert.equal(cert.fingerprint256.replace(/:/g, ""), "807025AD50D4ED219D2C9C7D299C004F824EB00CF7F65AFEF607D07B72E6CAFA");
  assert.ok(cert.verify(cert.publicKey));
});

test("Supabase connections receive the bundled CA without an extra env variable", () => {
  for (const host of ["db.example.supabase.co", "aws-0-ap-south-1.pooler.supabase.com"]) {
    const ssl = new Client(postgresConfig(`postgresql://test:test@${host}:6543/test`)).ssl as unknown as ConnectionOptions;
    assert.ok(Array.isArray(ssl.ca) && ssl.ca.includes(supabaseRootCertificate));
    assert.equal(ssl.rejectUnauthorized, true);
    assert.equal(ssl.checkServerIdentity, undefined);
    assert.doesNotThrow(() => createSecureContext(ssl));
  }
});

test("unrelated and lookalike hosts do not receive the provider CA", () => {
  for (const host of ["example.com", "db.example.supabase.co.evil.test", "aws-0.pooler.supabase.com.evil.test", "fakepooler.supabase.com"]) {
    assert.deepEqual(new Client(postgresConfig(`postgresql://test:test@${host}/test`)).ssl, { rejectUnauthorized: true });
  }
});

test("explicit CA overrides the bundled certificate and malformed overrides fail", () => {
  const supabaseUrl = "postgresql://test:test@db.example.supabase.co/test";
  const ssl = new Client(postgresConfig(supabaseUrl, certificate)).ssl as unknown as ConnectionOptions;
  assert.ok(Array.isArray(ssl.ca) && !ssl.ca.includes(supabaseRootCertificate));
  assert.throws(() => postgresConfig(supabaseUrl, "invalid"), { message: "database_ssl_ca_invalid" });
});

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
