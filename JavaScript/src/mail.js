const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export class MailClient {
  constructor(auth) {
    if (typeof auth?.authorizedRequest !== "function") {
      throw new TypeError("auth must provide an authorizedRequest method");
    }
    this.auth = auth;
  }

  async createMailbox(user, email, { authorizedUsers = [], password } = {}) {
    this.#validateEmail(user, "user");
    this.#validateEmail(email, "email");
    if (!Array.isArray(authorizedUsers)) {
      throw new TypeError("authorizedUsers must be an array of email addresses");
    }
    for (const authorizedUser of authorizedUsers) {
      this.#validateEmail(authorizedUser, "authorizedUsers entry");
    }
    if (
      password !== undefined &&
      (typeof password !== "string" ||
        !password.trim() ||
        password.length < 12 ||
        password.length > 1024)
    ) {
      throw new TypeError("password must be between 12 and 1024 characters");
    }
    if (typeof this.auth.authorizedEncryptedRequest !== "function") {
      throw new TypeError("auth must provide an authorizedEncryptedRequest method");
    }

    return this.auth.authorizedEncryptedRequest(
      "POST",
      `${this.auth.baseUrl.replace(/\/+$/, "")}/mail/create/`,
      {
        json: {
          email: email.trim(),
          user: user.trim(),
          authorized_users: authorizedUsers.map((address) => address.trim()),
          password: password ?? null,
        },
      },
    );
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

  #validateEmail(value, field) {
    if (typeof value !== "string" || !EMAIL_PATTERN.test(value.trim())) {
      throw new TypeError(`${field} must be a valid email address`);
    }
  }
}
