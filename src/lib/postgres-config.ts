import "server-only";

import { X509Certificate } from "node:crypto";
import { rootCertificates } from "node:tls";
import type { PoolConfig } from "pg";
import { supabaseRootCertificate } from "./supabase-ca";

/** Keep provider CA certificates server-side and retain certificate/hostname checks. */
export function postgresConfig(connectionString: string, certificate?: string): PoolConfig {
  let url: URL;
  try { url = new URL(connectionString); }
  catch { throw new Error("database_url_invalid"); }
  if (!["postgres:", "postgresql:"].includes(url.protocol) || !url.hostname || !url.password) {
    throw new Error("database_url_invalid");
  }
  // URI SSL options override pg's explicit SSL object, dropping our CA or
  // verification settings. Local certificate paths aren't portable to Vercel.
  if (["sslcert", "sslkey", "sslrootcert"].some(key => url.searchParams.has(key))) {
    throw new Error("database_url_invalid");
  }
  for (const key of ["sslmode", "ssl", "uselibpqcompat", "sslnegotiation"]) url.searchParams.delete(key);

  // Only Supabase endpoints receive the bundled provider CA. Explicit CA
  // configuration takes precedence, including during provider CA rotation.
  const isSupabase = /^db\.[a-z0-9]+\.supabase\.co$/.test(url.hostname)
    || /^[a-z0-9-]+\.pooler\.supabase\.com$/.test(url.hostname);
  if (!certificate?.trim() && isSupabase) certificate = supabaseRootCertificate;

  let ca: string[] | undefined;
  if (certificate?.trim()) {
    const pem = certificate.replace(/\\r\\n/g, "\n").replace(/\\n/g, "\n").trim();
    const certificates = pem.match(/-----BEGIN CERTIFICATE-----[\s\S]*?-----END CERTIFICATE-----/g);
    try {
      if (!certificates?.length || pem.replace(/-----BEGIN CERTIFICATE-----[\s\S]*?-----END CERTIFICATE-----/g, "").trim()) {
        throw new Error();
      }
      for (const cert of certificates) {
        if (!new X509Certificate(cert).ca) throw new Error();
      }
      ca = [...rootCertificates, ...certificates];
    } catch {
      // Never include the supplied value or a parser error in logs.
      throw new Error("database_ssl_ca_invalid");
    }
  }
  return {
    connectionString: url.toString(),
    max: 1,
    connectionTimeoutMillis: 10_000,
    idleTimeoutMillis: 30_000,
    ssl: { rejectUnauthorized: true, ...(ca ? { ca } : {}) },
  };
}
