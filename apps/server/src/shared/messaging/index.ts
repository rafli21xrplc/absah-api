import type { Logger } from 'pino';
import type { Config } from '../config';
import { FakeMessageSender, type MessageSender, type OtpMessage, type TemplateMessage } from './message-sender';
import { MetaCloudSender } from './meta-cloud-sender';

export { FakeMessageSender, SendError, type MessageSender, type OtpMessage, type TemplateMessage } from './message-sender';
export { MetaCloudSender } from './meta-cloud-sender';

/** The configured WhatsApp sender (WHATSAPP_PROVIDER). Production refuses the fake one (config). */
export function createMessageSender(config: Config, logger: Logger): MessageSender {
  if (config.WHATSAPP_PROVIDER === 'meta_cloud') {
    return new MetaCloudSender({
      apiUrl: config.WHATSAPP_API_URL,
      phoneNumberId: config.WHATSAPP_PHONE_NUMBER_ID ?? '',
      accessToken: config.WHATSAPP_ACCESS_TOKEN ?? '',
      otpTemplate: { name: config.WHATSAPP_OTP_TEMPLATE, language: 'id' },
    });
  }
  // Dev: messages stay in memory; OTP codes and texts are logged at debug level for local testing.
  return new (class extends FakeMessageSender {
    override async sendOtp(input: OtpMessage): Promise<void> {
      await super.sendOtp(input);
      logger.debug({ devOtp: input.code }, 'dev OTP generated (FakeMessageSender)');
    }
    override async sendTemplate(message: TemplateMessage) {
      const sent = await super.sendTemplate(message);
      logger.debug({ devMessage: message.text, template: message.template.name }, 'dev WhatsApp message (FakeMessageSender)');
      return sent;
    }
  })();
}
