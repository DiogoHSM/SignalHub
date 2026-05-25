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

    await transport.sendMail({
      from: input.smtp.from,
      to: input.channel.emailRecipients,
      subject: `[Sigmon] ${input.payload.severity}: ${input.payload.ruleName}`,
      text: formatEmailBody(input.payload)
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

function formatEmailBody(payload: AlertWebhookPayload): string {
  return [
    `Rule: ${payload.ruleName}`,
    `Project/Environment: ${payload.projectId}/${payload.environmentId}`,
    `Observed/Threshold: ${payload.observedValue} / ${payload.threshold}`,
    `Window: ${payload.window.from} to ${payload.window.to} (${payload.window.minutes} minutes)`,
    `Message: ${payload.message}`
  ].join("\n");
}

function formatEmailDeliveryError(error: unknown, password: string): string {
  const message = error instanceof Error ? error.message : "Email delivery failed";
  if (!password) return message;

  return message.replaceAll(password, "[REDACTED]");
}

function sanitizeMessage(message: string): string {
  return sanitizePreviewText(message) ?? "Email delivery failed";
}
