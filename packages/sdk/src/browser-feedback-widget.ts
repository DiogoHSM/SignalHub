import type { FeedbackInput, SignalContext, SignalMetadata, SignalMonitorClient } from "./types.js";

export type FeedbackWidgetPosition = "bottom-right" | "bottom-left";

export type FeedbackWidgetOptions = {
  enabled?: boolean;
  title?: string;
  prompt?: string;
  placeholder?: string;
  buttonLabel?: string;
  submitLabel?: string;
  cancelLabel?: string;
  successMessage?: string;
  accentColor?: string;
  position?: FeedbackWidgetPosition;
  category?: string;
  metadata?: SignalMetadata | (() => SignalMetadata);
  context?: SignalContext | (() => SignalContext);
  flush?: boolean;
};

export type StopFeedbackWidget = () => void;

export function installFeedbackWidget(
  client: Pick<SignalMonitorClient, "feedback" | "flush">,
  options: FeedbackWidgetOptions = {}
): StopFeedbackWidget {
  if (options.enabled === false || typeof document === "undefined") {
    return () => undefined;
  }

  const button = document.createElement("button");
  const panel = document.createElement("section");
  const form = document.createElement("form");
  const textarea = document.createElement("textarea");
  const status = document.createElement("p");
  const buttonLabel = options.buttonLabel ?? "Feedback";
  const accentColor = normalizeAccent(options.accentColor);
  let open = false;

  button.type = "button";
  button.textContent = buttonLabel;
  button.setAttribute("aria-expanded", "false");
  button.setAttribute("data-sigmon-feedback-widget", "trigger");
  Object.assign(button.style, baseButtonStyle(accentColor, options.position));

  panel.setAttribute("role", "dialog");
  panel.setAttribute("aria-label", options.title ?? "Send feedback");
  panel.setAttribute("data-sigmon-feedback-widget", "panel");
  Object.assign(panel.style, basePanelStyle(options.position));

  const title = document.createElement("strong");
  title.textContent = options.title ?? "Send feedback";
  title.style.display = "block";
  title.style.marginBottom = "6px";

  const prompt = document.createElement("p");
  prompt.textContent = options.prompt ?? "Tell us what happened or what could be better.";
  Object.assign(prompt.style, { margin: "0 0 10px", color: "#9aa7b5", fontSize: "13px", lineHeight: "1.4" });

  textarea.name = "feedback";
  textarea.required = true;
  textarea.maxLength = 2000;
  textarea.placeholder = options.placeholder ?? "Write your feedback...";
  Object.assign(textarea.style, textareaStyle());

  const actions = document.createElement("div");
  Object.assign(actions.style, { display: "flex", gap: "8px", marginTop: "10px" });

  const submit = document.createElement("button");
  submit.type = "submit";
  submit.textContent = options.submitLabel ?? "Send";
  Object.assign(submit.style, actionButtonStyle(accentColor, true));

  const cancel = document.createElement("button");
  cancel.type = "button";
  cancel.textContent = options.cancelLabel ?? "Cancel";
  Object.assign(cancel.style, actionButtonStyle(accentColor, false));

  status.setAttribute("aria-live", "polite");
  Object.assign(status.style, { margin: "8px 0 0", color: "#9aa7b5", fontSize: "12px" });

  actions.append(submit, cancel);
  form.append(title, prompt, textarea, actions, status);
  panel.append(form);
  document.body.append(button, panel);

  const setOpen = (next: boolean): void => {
    open = next;
    panel.style.display = open ? "block" : "none";
    button.setAttribute("aria-expanded", String(open));
    if (open) textarea.focus();
  };

  const onSubmit = (event: Event): void => {
    event.preventDefault();
    const message = textarea.value.trim();
    if (!message) return;

    const input: FeedbackInput = {
      message,
      category: options.category,
      pageUrl: globalThis.location?.href,
      path: `${globalThis.location?.pathname ?? ""}${globalThis.location?.search ?? ""}`,
      userAgent: globalThis.navigator?.userAgent,
      metadata: resolveValue(options.metadata)
    };
    client.feedback(input, resolveValue(options.context));
    textarea.value = "";
    status.textContent = options.successMessage ?? "Feedback sent.";
    setOpen(false);

    if (options.flush === true) {
      void client.flush().catch(() => undefined);
    }
  };

  const onKeydown = (event: KeyboardEvent): void => {
    if (event.key === "Escape" && open) setOpen(false);
  };

  button.addEventListener("click", () => setOpen(!open));
  cancel.addEventListener("click", () => setOpen(false));
  form.addEventListener("submit", onSubmit);
  globalThis.addEventListener?.("keydown", onKeydown);
  setOpen(false);

  return () => {
    globalThis.removeEventListener?.("keydown", onKeydown);
    button.remove();
    panel.remove();
  };
}

function resolveValue<T>(value: T | (() => T) | undefined): T | undefined {
  return typeof value === "function" ? (value as () => T)() : value;
}

function normalizeAccent(color: string | undefined): string {
  return /^#[0-9a-f]{6}$/i.test(color ?? "") ? color! : "#66e38a";
}

function baseButtonStyle(accentColor: string, position: FeedbackWidgetPosition | undefined): Partial<CSSStyleDeclaration> {
  return {
    position: "fixed",
    zIndex: "2147483000",
    bottom: "18px",
    [position === "bottom-left" ? "left" : "right"]: "18px",
    border: `1px solid ${accentColor}`,
    borderRadius: "999px",
    background: "#17212b",
    color: "#f4f7fb",
    boxShadow: "0 12px 30px rgba(0, 0, 0, 0.28)",
    cursor: "pointer",
    font: "600 14px system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
    padding: "10px 14px"
  };
}

function basePanelStyle(position: FeedbackWidgetPosition | undefined): Partial<CSSStyleDeclaration> {
  return {
    position: "fixed",
    zIndex: "2147483000",
    bottom: "68px",
    [position === "bottom-left" ? "left" : "right"]: "18px",
    width: "min(360px, calc(100vw - 36px))",
    padding: "16px",
    border: "1px solid #334155",
    borderRadius: "12px",
    background: "#17212b",
    color: "#f4f7fb",
    boxShadow: "0 20px 45px rgba(0, 0, 0, 0.35)",
    font: "14px system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif"
  };
}

function textareaStyle(): Partial<CSSStyleDeclaration> {
  return {
    width: "100%",
    minHeight: "112px",
    boxSizing: "border-box",
    resize: "vertical",
    border: "1px solid #334155",
    borderRadius: "8px",
    background: "#111820",
    color: "#f4f7fb",
    outline: "none",
    padding: "10px",
    font: "14px system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif"
  };
}

function actionButtonStyle(accentColor: string, primary: boolean): Partial<CSSStyleDeclaration> {
  return {
    flex: "1",
    border: `1px solid ${primary ? accentColor : "#334155"}`,
    borderRadius: "8px",
    background: primary ? accentColor : "#1f2b37",
    color: primary ? "#07130b" : "#f4f7fb",
    cursor: "pointer",
    font: "600 13px system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
    padding: "9px 10px"
  };
}
