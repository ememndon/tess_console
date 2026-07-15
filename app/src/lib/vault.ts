import crypto from "crypto";

// AES-256-GCM. Master key lives only in the server's .env (never in DB or repo),
// so a stolen database dump alone cannot reveal stored credentials.
function masterKey(): Buffer {
  const hex = process.env.VAULT_MASTER_KEY;
  if (!hex || hex.length !== 64) throw new Error("VAULT_MASTER_KEY missing or malformed");
  return Buffer.from(hex, "hex");
}

export function encryptSecret(plain: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", masterKey(), iv);
  const enc = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return [iv, enc, cipher.getAuthTag()].map((b) => b.toString("base64")).join(".");
}

export function decryptSecret(stored: string): string {
  const [iv, enc, tag] = stored.split(".").map((s) => Buffer.from(s, "base64"));
  const decipher = crypto.createDecipheriv("aes-256-gcm", masterKey(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(enc), decipher.final()]).toString("utf8");
}

/** Mask for display: first 4 chars + length hint. Real value never leaves the server. */
export function maskSecret(plain: string): string {
  if (plain.length <= 8) return "••••••••";
  return `${plain.slice(0, 4)}…${"•".repeat(8)} (${plain.length} chars)`;
}
