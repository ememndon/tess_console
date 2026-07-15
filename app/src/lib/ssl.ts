import "server-only";
import tls from "tls";

// TLS certificate expiry check ("watch SSL renewal"). A direct
// handshake per domain; no third-party service. Cheap enough for the health page.
export type CertInfo = { host: string; daysLeft: number | null; validTo: string | null; issuer: string | null; error?: string };

function check(host: string): Promise<CertInfo> {
  return new Promise((resolve) => {
    let done = false;
    const finish = (info: CertInfo) => {
      if (done) return;
      done = true;
      resolve(info);
    };
    try {
      const socket = tls.connect({ host, port: 443, servername: host, timeout: 8000 }, () => {
        const cert = socket.getPeerCertificate();
        socket.end();
        if (!cert || !cert.valid_to) return finish({ host, daysLeft: null, validTo: null, issuer: null, error: "no certificate" });
        const validTo = new Date(cert.valid_to);
        const daysLeft = Math.floor((validTo.getTime() - Date.now()) / 86_400_000);
        const rawIssuer = cert.issuer && (cert.issuer.O || cert.issuer.CN);
        const issuer = Array.isArray(rawIssuer) ? rawIssuer[0] : rawIssuer || null;
        finish({ host, daysLeft, validTo: validTo.toISOString(), issuer });
      });
      socket.on("error", (e) => finish({ host, daysLeft: null, validTo: null, issuer: null, error: e.message.slice(0, 80) }));
      socket.on("timeout", () => { socket.destroy(); finish({ host, daysLeft: null, validTo: null, issuer: null, error: "timeout" }); });
    } catch (e) {
      finish({ host, daysLeft: null, validTo: null, issuer: null, error: e instanceof Error ? e.message.slice(0, 80) : "error" });
    }
  });
}

export async function getCertExpiries(hosts: string[]): Promise<CertInfo[]> {
  return Promise.all(hosts.map(check));
}
