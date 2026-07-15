import type { NextConfig } from "next";

// Security headers (hardening). Applied to every response; Caddy proxies
// them through. CSP keeps 'unsafe-inline' for scripts/styles (Next's hydration
// bootstrap + injected styles need it without a nonce pipeline) but locks down
// framing, base-uri, form-action, objects and cross-origin connections.
//
// On 'unsafe-inline' for script-src (security review 2026-06-23, finding #2):
// deliberately retained. Removing it requires a per-request nonce + strict-dynamic
// pipeline, a high-blast-radius change on this customized Next. The residual risk
// is low because the app has NO untrusted-HTML sinks — there are zero
// dangerouslySetInnerHTML uses, React escapes by default, and email bodies render
// in a script-less sandboxed iframe (see components/inbox/email-body.tsx) — so
// there is no vector to deliver an inline script in the first place. Revisit if a
// nonce pipeline is added.
const CSP = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https:",
  "font-src 'self' data:",
  "connect-src 'self'",
  "manifest-src 'self'",
  "worker-src 'self'",
  // The inbox renders each email inside a sandboxed same-origin srcdoc iframe;
  // restrict framing to 'self' so only that (and other first-party frames) load.
  "frame-src 'self'",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "object-src 'none'",
].join("; ");

const SECURITY_HEADERS = [
  { key: "Content-Security-Policy", value: CSP },
  { key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), browsing-topics=()" },
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
];

const nextConfig: NextConfig = {
  // Self-contained server bundle for the Docker runtime image.
  output: "standalone",
  // Load from node_modules at runtime, don't bundle. sharp is a native module
  // (banners); imapflow/nodemailer/mailparser use dynamic requires +
  // __dirname-relative reads that break when bundled (inbox).
  serverExternalPackages: ["sharp", "imapflow", "nodemailer", "mailparser", "@anthropic-ai/sdk"],
  async headers() {
    return [
      // The cross-origin analytics ingestion + public tracker scripts set their
      // own CORS in-route and must stay embeddable, so they skip the frame/CSP rules.
      { source: "/api/collect", headers: SECURITY_HEADERS.filter((h) => h.key !== "Content-Security-Policy" && h.key !== "X-Frame-Options") },
      { source: "/t.js", headers: [{ key: "X-Content-Type-Options", value: "nosniff" }] },
      { source: "/w.js", headers: [{ key: "X-Content-Type-Options", value: "nosniff" }] },
      // Everything else (the console) gets the full set.
      { source: "/((?!api/collect|t\\.js|w\\.js).*)", headers: SECURITY_HEADERS },
    ];
  },
};

export default nextConfig;
