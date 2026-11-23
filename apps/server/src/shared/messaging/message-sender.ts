/**
 * Outgoing messages (WhatsApp first). Real providers arrive with the notify module (prompt 3.2);
 * request handlers must not call a provider directly once the outbox exists (prompt 1.3).
 */
export interface MessageSender {
  sendOtp(input: { to: string; code: string; purpose: 'login' }): Promise<void>;
}

/** Dev/test sender: keeps messages in memory so tests can read the OTP. */
export class FakeMessageSender implements MessageSender {
  readonly sent: { to: string; code: string; purpose: 'login' }[] = [];

  sendOtp(input: { to: string; code: string; purpose: 'login' }): Promise<void> {
    this.sent.push(input);
    return Promise.resolve();
  }

  lastCodeFor(to: string): string | undefined {
    return this.sent.filter((m) => m.to === to).at(-1)?.code;
  }
}
