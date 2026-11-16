/**
 * Outgoing WhatsApp messages. Only the worker sends notifications (through the notify module);
 * the one exception is the login OTP from Better Auth, see CLAUDE.md.
 */
export interface TemplateMessage {
  /** E.164, e.g. +6281234567890. */
  to: string;
  /** Provider template name and language. */
  template: { name: string; language: string };
  /** Body parameters in the template's order. */
  params: string[];
  /** The rendered text, for the fake sender and local logs only (never logged in production). */
  text: string;
}

export interface OtpMessage {
  to: string;
  code: string;
  purpose: 'login';
}

export interface MessageSender {
  readonly provider: string;
  /** Real providers only accept templates they approved. */
  readonly requiresApprovedTemplates: boolean;
  sendTemplate(message: TemplateMessage): Promise<{ providerMessageId: string }>;
  sendOtp(message: OtpMessage): Promise<void>;
}

/** A failed send. retryable: network, rate limit, provider 5xx; otherwise retrying cannot help. */
export class SendError extends Error {
  constructor(
    /** Short, safe for logs and the admin dashboard (no phone numbers or message text). */
    readonly code: string,
    readonly retryable: boolean,
  ) {
    super(`send failed: ${code}`);
  }
}

/** Dev/test sender: keeps messages in memory so tests can read them. */
export class FakeMessageSender implements MessageSender {
  readonly provider = 'fake';
  readonly requiresApprovedTemplates = false;
  readonly sent: { to: string; code: string; purpose: 'login' }[] = [];
  readonly messages: (TemplateMessage & { providerMessageId: string })[] = [];
  /** Errors to throw on the next sends, in order (tests of retries). */
  readonly failures: SendError[] = [];

  sendOtp(input: OtpMessage): Promise<void> {
    this.sent.push(input);
    return Promise.resolve();
  }

  sendTemplate(message: TemplateMessage): Promise<{ providerMessageId: string }> {
    const failure = this.failures.shift();
    if (failure) return Promise.reject(failure);
    const providerMessageId = `fake.${crypto.randomUUID()}`;
    this.messages.push({ ...message, providerMessageId });
    return Promise.resolve({ providerMessageId });
  }

  lastCodeFor(to: string): string | undefined {
    return this.sent.filter((m) => m.to === to).at(-1)?.code;
  }
}
