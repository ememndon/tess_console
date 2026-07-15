import "server-only";
import crypto from "crypto";
import nodemailer from "nodemailer";
import type { MailboxRow } from "./mailboxes";
import type Mail from "nodemailer/lib/mailer";

function buildTransport(box: MailboxRow, password: string) {
  return nodemailer.createTransport({
    host: box.smtpHost,
    port: box.smtpPort,
    secure: box.smtpSecure, // true → implicit TLS (465); false → STARTTLS (587)
    auth: { user: box.username, pass: password },
    connectionTimeout: 15_000,
    greetingTimeout: 10_000,
    socketTimeout: 30_000,
  });
}

export type VerifyResult = { ok: boolean; message: string };

/** SMTP login probe for the Settings "test connection" button. */
export async function smtpVerify(box: MailboxRow, password: string): Promise<VerifyResult> {
  const transport = buildTransport(box, password);
  try {
    await transport.verify();
    return { ok: true, message: "SMTP login OK." };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, message: msg.slice(0, 180) };
  } finally {
    transport.close();
  }
}

export type SendAttachment = {
  filename: string;
  content: Buffer; // raw bytes
  contentType?: string;
};

export type SendInput = {
  to: string[];
  cc?: string[];
  subject: string;
  text: string;
  html?: string | null; // rich-text body (multipart/alternative with `text`)
  attachments?: SendAttachment[];
  inReplyTo?: string | null; // Message-ID being replied to
  references?: string[]; // thread references
};

export type SendResult = { messageId: string; raw: string };

/**
 * Send a message from this mailbox's address. The display name + address come
 * from the mailbox row, so a reply always goes out as the correct support
 * identity (acceptance criterion: "sends from the correct address"). Returns the
 * generated raw MIME so the caller can append it to the Sent folder.
 */
export async function sendMail(box: MailboxRow, password: string, input: SendInput): Promise<SendResult> {
  // Pin a Message-ID so the SMTP send and the Sent-folder copy share identity.
  const domain = box.address.split("@")[1] || "localhost";
  const messageId = `<${crypto.randomUUID()}@${domain}>`;
  const mail: Mail.Options = {
    messageId,
    from: { name: box.displayName, address: box.address },
    to: input.to,
    cc: input.cc?.length ? input.cc : undefined,
    subject: input.subject,
    text: input.text,
    html: input.html || undefined,
    attachments: input.attachments?.length
      ? input.attachments.map((a) => ({ filename: a.filename, content: a.content, contentType: a.contentType }))
      : undefined,
    inReplyTo: input.inReplyTo || undefined,
    references: input.references?.length ? input.references.join(" ") : undefined,
  };

  // Compile the raw MIME once (stream transport, buffered) for the Sent copy.
  const builder = nodemailer.createTransport({ streamTransport: true, buffer: true, newline: "unix" });
  const built = await builder.sendMail(mail);
  const raw = Buffer.isBuffer(built.message) ? built.message.toString() : String(built.message ?? "");

  const transport = buildTransport(box, password);
  try {
    await transport.sendMail(mail);
    return { messageId, raw };
  } finally {
    transport.close();
  }
}
