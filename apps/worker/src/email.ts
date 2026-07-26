import { createTransport } from "nodemailer";
import type { AppConfig } from "@sigmon/config";
import type { NotificationChannelRecord } from "@sigmon/db/repositories/alerts.js";
import { sanitizePreviewText } from "@sigmon/telemetry/sanitization";
import type { AlertWebhookPayload, DeliveryResult } from "./alerts.js";

export type EmailTransportFactory = typeof createTransport;

export async function deliverEmail(input: {
  channel: Extract<NotificationChannelRecord, { type: "email" }>;
  smtp: AppConfig["smtp"];
  payload: AlertWebhookPayload;
  timeoutMs: number;
  transportFactory?: EmailTransportFactory;
  publicEndpoint?: string;
}): Promise<DeliveryResult> {
  if (!input.smtp.enabled) {
    return { status: "failed", responseStatus: null, errorMessage: "SMTP is not configured" };
  }

  try {
    const transport = (input.transportFactory ?? createTransport)({
      host: input.smtp.host,
      port: input.smtp.port,
      secure: input.smtp.secure,
      auth: {
        user: input.smtp.username,
        pass: input.smtp.password
      },
      connectionTimeout: input.timeoutMs,
      greetingTimeout: input.timeoutMs,
      socketTimeout: input.timeoutMs
    });

    const alertUrl = buildAlertUrl(input.payload, input.publicEndpoint);

    await transport.sendMail({
      from: input.smtp.from,
      to: input.channel.emailRecipients,
      subject: `[Sigmon] ${input.payload.severity}: ${input.payload.ruleName}`,
      text: formatEmailTextBody(input.payload, alertUrl),
      html: formatEmailHtmlBody(input.payload, alertUrl)
    });

    return { status: "success", responseStatus: null, errorMessage: null };
  } catch (error) {
    return {
      status: "failed",
      responseStatus: null,
      errorMessage: sanitizeMessage(formatEmailDeliveryError(error, input.smtp.password))
    };
  }
}

function buildAlertUrl(payload: AlertWebhookPayload, publicEndpoint: string | undefined): string | null {
  if (!publicEndpoint) return null;

  return `${publicEndpoint.replace(/\/+$/, "")}/console#/alerts/${encodeURIComponent(payload.alertEventId)}`;
}

function formatEmailTextBody(payload: AlertWebhookPayload, alertUrl: string | null): string {
  const lines = [
    `Rule: ${payload.ruleName}`,
    `Project/Environment: ${payload.projectId}/${payload.environmentId}`,
    `Observed/Threshold: ${payload.observedValue} / ${payload.threshold}`,
    `Window: ${payload.window.from} to ${payload.window.to} (${payload.window.minutes} minutes)`,
    `Message: ${payload.message}`
  ];
  if (alertUrl) {
    lines.push(`View in Sigmon: ${alertUrl}`);
  }
  return lines.join("\n");
}

function formatEmailHtmlBody(payload: AlertWebhookPayload, alertUrl: string | null): string {
  const rows: Array<[string, string]> = [
    ["Rule", payload.ruleName],
    ["Severity", payload.severity],
    ["Project/Environment", `${payload.projectId}/${payload.environmentId}`],
    ["Observed/Threshold", `${payload.observedValue} / ${payload.threshold}`],
    ["Window", `${payload.window.from} to ${payload.window.to} (${payload.window.minutes} minutes)`],
    ["Message", payload.message]
  ];

  const tableRows = rows
    .map(
      ([label, value]) =>
        `<tr><td style="padding:4px 12px 4px 0;color:#6b7280;white-space:nowrap;">${escapeHtml(label)}</td><td style="padding:4px 0;">${escapeHtml(value)}</td></tr>`
    )
    .join("");

  const button = alertUrl
    ? `<p style="margin:16px 0 0;"><a href="${escapeHtml(alertUrl)}" style="color:#2563eb;">View in Sigmon</a></p>`
    : "";

  return `<div style="font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;font-size:14px;color:#111827;">
  <table cellspacing="0" cellpadding="0">${tableRows}</table>
  ${button}
</div>`;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function formatEmailDeliveryError(error: unknown, password: string): string {
  const message = error instanceof Error ? error.message : "Email delivery failed";
  if (!password) return message;

  return message.replaceAll(password, "[REDACTED]");
}

function sanitizeMessage(message: string): string {
  return sanitizePreviewText(message) ?? "Email delivery failed";
}
