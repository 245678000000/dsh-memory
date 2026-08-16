import type { Sensitivity } from "../domain/memory.ts";

export interface SensitivityVerdict {
  sensitivity: Sensitivity;
  reject: boolean;
  reason: string;
  redactedPreview: string;
}

const SECRET_PATTERNS: readonly { name: string; pattern: RegExp }[] = [
  { name: "pem_private_key", pattern: /-----BEGIN ([A-Z ]+)?PRIVATE KEY-----/ },
  { name: "aws_access_key", pattern: /\bAKIA[0-9A-Z]{16}\b/ },
  { name: "github_token", pattern: /\bgh[pousr]_[A-Za-z0-9_]{20,}\b/ },
  { name: "slack_token", pattern: /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/ },
  { name: "jwt", pattern: /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/ },
  { name: "openai_or_generic_sk", pattern: /\bsk-[A-Za-z0-9_-]{16,}\b/ },
  { name: "google_api_key", pattern: /\bAIza[0-9A-Za-z_-]{20,}\b/ },
  { name: "stripe_key", pattern: /\b(?:sk|rk|pk)_(?:live|test)_[A-Za-z0-9]{16,}\b/ },
  { name: "password_assignment", pattern: /\b(password|passwd|pwd)\s*[:=]\s*\S+/i },
  { name: "api_key_assignment", pattern: /\b(api[_-]?key|access[_-]?token|secret[_-]?key|auth[_-]?token)\s*[:=]\s*\S+/i },
  { name: "bearer_token", pattern: /\bbearer\s+[A-Za-z0-9._~+/=-]{12,}\b/i },
  { name: "connection_secret", pattern: /\b(postgres|mysql|mongodb|redis):\/\/[^\s]+:[^\s]+@/i },
  { name: "credit_card", pattern: /\b(?:4[0-9]{12}(?:[0-9]{3})?|5[1-5][0-9]{14}|3[47][0-9]{13})\b/ },
  { name: "session_cookie", pattern: /\b(sessionid|connect\.sid|jsessionid)=[A-Za-z0-9._-]{8,}\b/i },
];

const SENSITIVE_PII_PATTERNS: readonly { name: string; pattern: RegExp }[] = [
  { name: "email", pattern: /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i },
  { name: "phone", pattern: /\b(?:\+?\d{1,3}[-.\s])?(?:\(?\d{3}\)?[-.\s])\d{3}[-.\s]\d{4}\b/ },
  { name: "ssn", pattern: /\b\d{3}-\d{2}-\d{4}\b/ },
  { name: "home_address", pattern: /\b\d{1,5}\s+\w+\s+(street|st|avenue|ave|road|rd|boulevard|blvd)\b/i },
];

export function inspectSensitivity(content: string): SensitivityVerdict {
  for (const item of SECRET_PATTERNS) {
    if (item.pattern.test(content)) {
      return {
        sensitivity: "secret",
        reject: true,
        reason: `secret_pattern:${item.name}`,
        redactedPreview: redact(content),
      };
    }
  }
  for (const item of SENSITIVE_PII_PATTERNS) {
    if (item.pattern.test(content)) {
      return {
        sensitivity: "sensitive",
        reject: false,
        reason: `pii_pattern:${item.name}`,
        redactedPreview: redact(content),
      };
    }
  }
  if (/\b(confidential|do not remember|private)\b/i.test(content)) {
    return {
      sensitivity: "private",
      reject: false,
      reason: "marked_private",
      redactedPreview: content.slice(0, 120),
    };
  }
  return {
    sensitivity: "normal",
    reject: false,
    reason: "clear",
    redactedPreview: content.slice(0, 120),
  };
}

export function redact(text: string): string {
  let next = text;
  for (const item of SECRET_PATTERNS) {
    next = next.replace(item.pattern, `[redacted:${item.name}]`);
  }
  next = next.replace(SENSITIVE_PII_PATTERNS[0]!.pattern, "[redacted:email]");
  return next;
}

export function looksLikeInstructionInjection(text: string): boolean {
  return (
    /\bignore (all )?(previous|prior|above) instructions\b/i.test(text)
    || /\bdisregard (your )?(system|developer) prompt\b/i.test(text)
    || /\byou are now\b/i.test(text) && /\bjailbreak\b/i.test(text)
    || /\bupload (the )?(secrets|credentials|keys)\b/i.test(text)
  );
}
