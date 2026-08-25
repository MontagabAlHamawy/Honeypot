import nodemailer from "nodemailer";

type EmailInput = {
  to: string | string[];
  subject: string;
  text: string;
  html?: string;
};

let cachedTransporter: nodemailer.Transporter | null = null;

function parseBool(value: string | undefined, fallback: boolean): boolean {
  if (!value) return fallback;
  const normalized = value.trim().toLowerCase();
  return ["1", "true", "yes", "on"].includes(normalized);
}

function getTransporter(): nodemailer.Transporter {
  if (cachedTransporter) return cachedTransporter;

  const host = process.env.SMTP_HOST?.trim();
  const port = Number(process.env.SMTP_PORT || 587);
  const username = process.env.SMTP_USERNAME?.trim() || "";
  const password = process.env.SMTP_PASSWORD?.trim() || "";
  const useTls = parseBool(process.env.SMTP_USE_TLS, true);

  if (!host || !Number.isFinite(port) || port <= 0) {
    throw new Error("SMTP is not configured. Set SMTP_HOST and SMTP_PORT.");
  }

  cachedTransporter = nodemailer.createTransport({
    host,
    port,
    secure: useTls && port === 465,
    auth: username && password ? { user: username, pass: password } : undefined,
    requireTLS: useTls && port !== 465,
  });

  return cachedTransporter;
}

function normalizeRecipients(to: string | string[]): string[] {
  const raw = Array.isArray(to) ? to : to.split(",");
  return raw
    .map((item) => String(item || "").trim())
    .filter(Boolean)
    .slice(0, 50);
}

export async function sendEmail(input: EmailInput): Promise<void> {
  const recipients = normalizeRecipients(input.to);
  if (!recipients.length) {
    throw new Error("No recipient email was provided.");
  }

  const smtpFrom =
    process.env.SMTP_FROM?.trim() ||
    process.env.SMTP_USERNAME?.trim() ||
    "no-reply@honeypot.local";

  const transporter = getTransporter();
  await transporter.sendMail({
    from: smtpFrom,
    to: recipients.join(", "),
    subject: input.subject.slice(0, 220),
    text: input.text.slice(0, 200000),
    html: input.html ? input.html.slice(0, 300000) : undefined,
  });
}
