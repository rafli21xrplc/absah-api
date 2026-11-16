import { SendError, type MessageSender, type OtpMessage, type TemplateMessage } from './message-sender';

export interface MetaCloudConfig {
  apiUrl: string;
  phoneNumberId: string;
  accessToken: string;
  /** Provider template name of the login OTP (an authentication template). */
  otpTemplate: { name: string; language: string };
}

type Fetch = typeof fetch;
const RETRYABLE = new Set([408, 429, 500, 502, 503, 504]);

/**
 * WhatsApp Business Platform (Cloud API) adapter. Credentials come only from env; nothing here
 * logs phone numbers or message text. Non-retryable provider errors carry Meta's error code.
 */
export class MetaCloudSender implements MessageSender {
  readonly provider = 'meta_cloud';
  readonly requiresApprovedTemplates = true;

  constructor(
    private readonly config: MetaCloudConfig,
    private readonly fetchImpl: Fetch = fetch,
  ) {}

  async sendTemplate(message: TemplateMessage): Promise<{ providerMessageId: string }> {
    const components = [{ type: 'body', parameters: message.params.map((text) => ({ type: 'text', text })) }];
    return this.post(message.to, { name: message.template.name, language: { code: message.template.language }, components });
  }

  async sendOtp(message: OtpMessage): Promise<void> {
    // Authentication templates take the code in the body and in the copy-code button.
    const code = [{ type: 'text', text: message.code }];
    await this.post(message.to, {
      name: this.config.otpTemplate.name,
      language: { code: this.config.otpTemplate.language },
      components: [
        { type: 'body', parameters: code },
        { type: 'button', sub_type: 'url', index: '0', parameters: code },
      ],
    });
  }

  private async post(to: string, template: object): Promise<{ providerMessageId: string }> {
    let res: Response;
    try {
      res = await this.fetchImpl(`${this.config.apiUrl}/${this.config.phoneNumberId}/messages`, {
        method: 'POST',
        headers: { authorization: `Bearer ${this.config.accessToken}`, 'content-type': 'application/json' },
        body: JSON.stringify({ messaging_product: 'whatsapp', to: to.replace(/^\+/, ''), type: 'template', template }),
        signal: AbortSignal.timeout(10_000),
      });
    } catch {
      throw new SendError('network', true);
    }
    const body = (await res.json().catch(() => null)) as { messages?: { id?: string }[]; error?: { code?: number } } | null;
    if (!res.ok) throw new SendError(`http_${res.status}${body?.error?.code ? `:${body.error.code}` : ''}`, RETRYABLE.has(res.status));
    const id = body?.messages?.[0]?.id;
    if (!id) throw new SendError('no_message_id', false);
    return { providerMessageId: id };
  }
}
