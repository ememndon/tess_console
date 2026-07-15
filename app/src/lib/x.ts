import "server-only";
import crypto from "crypto";
import { promises as fs } from "fs";

// X (Twitter) client via OAuth 1.0a user context — per-brand free
// developer app, autonomous posting. Signing is HMAC-SHA1 over the oauth_* params
// (JSON/multipart bodies aren't part of the signature base).

export type XCreds = { apiKey: string; apiSecret: string; accessToken: string; accessSecret: string };

const enc = (s: string) =>
  encodeURIComponent(s).replace(/[!*'()]/g, (c) => "%" + c.charCodeAt(0).toString(16).toUpperCase());

function authHeader(creds: XCreds, method: string, url: string): string {
  const o: Record<string, string> = {
    oauth_consumer_key: creds.apiKey,
    oauth_nonce: crypto.randomBytes(16).toString("hex"),
    oauth_signature_method: "HMAC-SHA1",
    oauth_timestamp: Math.floor(Date.now() / 1000).toString(),
    oauth_token: creds.accessToken,
    oauth_version: "1.0",
  };
  const params = Object.keys(o)
    .sort()
    .map((k) => `${enc(k)}=${enc(o[k])}`)
    .join("&");
  const base = [method.toUpperCase(), enc(url), enc(params)].join("&");
  const key = `${enc(creds.apiSecret)}&${enc(creds.accessSecret)}`;
  o.oauth_signature = crypto.createHmac("sha1", key).update(base).digest("base64");
  return (
    "OAuth " +
    Object.keys(o)
      .sort()
      .map((k) => `${enc(k)}="${enc(o[k])}"`)
      .join(", ")
  );
}

export async function xVerify(creds: XCreds): Promise<{ handle: string }> {
  const url = "https://api.twitter.com/2/users/me";
  const r = await fetch(url, { headers: { authorization: authHeader(creds, "GET", url) } });
  if (!r.ok) throw new Error(`verify ${r.status}: ${(await r.text()).slice(0, 140)}`);
  const j = (await r.json()) as { data?: { username?: string } };
  return { handle: j.data?.username ?? "?" };
}

export async function xUploadMedia(creds: XCreds, filePath: string, mime = "image/png"): Promise<string> {
  const url = "https://upload.twitter.com/1.1/media/upload.json";
  const data = await fs.readFile(filePath);
  const form = new FormData();
  form.append("media", new Blob([new Uint8Array(data)], { type: mime }));
  const r = await fetch(url, { method: "POST", headers: { authorization: authHeader(creds, "POST", url) }, body: form });
  if (!r.ok) throw new Error(`media ${r.status}: ${(await r.text()).slice(0, 140)}`);
  const j = (await r.json()) as { media_id_string?: string };
  if (!j.media_id_string) throw new Error("media upload returned no id");
  return j.media_id_string;
}

export async function xPostTweet(
  creds: XCreds,
  text: string,
  mediaIds?: string[],
): Promise<{ id: string; url: string }> {
  const url = "https://api.twitter.com/2/tweets";
  const body: Record<string, unknown> = { text };
  if (mediaIds?.length) body.media = { media_ids: mediaIds };
  const r = await fetch(url, {
    method: "POST",
    headers: { authorization: authHeader(creds, "POST", url), "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(`post ${r.status}: ${(await r.text()).slice(0, 180)}`);
  const j = (await r.json()) as { data?: { id?: string } };
  const id = j.data?.id ?? "";
  return { id, url: `https://x.com/i/web/status/${id}` };
}

export async function xDeleteTweet(creds: XCreds, id: string): Promise<boolean> {
  const url = `https://api.twitter.com/2/tweets/${id}`;
  const r = await fetch(url, { method: "DELETE", headers: { authorization: authHeader(creds, "DELETE", url) } });
  return r.ok;
}
