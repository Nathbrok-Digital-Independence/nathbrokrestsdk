export class MailClient {
  constructor(auth) {
    if (typeof auth?.authorizedRequest !== "function") {
      throw new TypeError("auth must provide an authorizedRequest method");
    }
    this.auth = auth;
  }

  async sendEmail(emailData, mailbox, to, { cc = [], bcc = [] } = {}) {
    if (!emailData || typeof emailData !== "object" || Array.isArray(emailData)) {
      throw new TypeError("emailData must be an object");
    }
    if (typeof mailbox !== "string" || !mailbox.trim()) {
      throw new TypeError("mailbox must be a non-empty email address");
    }
    if (typeof to !== "string" || !to.trim()) {
      throw new TypeError("to must be a non-empty email address");
    }
    this.#validateRecipients(cc, "cc");
    this.#validateRecipients(bcc, "bcc");
    const subject = emailData.subject ?? "";
    const bodyText = emailData.body_text ?? emailData.data ?? "";
    const bodyHtml = emailData.body_html ?? "";
    if (typeof subject !== "string") throw new TypeError("emailData.subject must be a string");
    if (/[\r\n]/.test(subject)) {
      throw new TypeError("emailData.subject must not contain line breaks");
    }
    if (typeof bodyText !== "string" || typeof bodyHtml !== "string") {
      throw new TypeError("emailData body fields must be strings");
    }
    if (!bodyText && !bodyHtml) {
      throw new TypeError("emailData must contain body_text or body_html");
    }
    return this.auth.authorizedRequest(
      "POST",
      `${this.auth.baseUrl.replace(/\/+$/, "")}/mail/send/`,
      {
        json: {
          mailbox: mailbox.trim(),
          to: to.trim(),
          cc,
          bcc,
          subject,
          body_text: bodyText,
          body_html: bodyHtml,
        },
      },
    );
  }

  #validateRecipients(recipients, field) {
    if (!Array.isArray(recipients)) {
      throw new TypeError(`${field} must be an array of email addresses`);
    }
    if (!recipients.every((address) => typeof address === "string" && address.trim())) {
      throw new TypeError(`${field} entries must be non-empty email addresses`);
    }
  }
}
