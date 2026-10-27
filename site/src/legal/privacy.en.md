# Tredane Privacy Policy

*Versão em português: [Política de Privacidade](/privacidade)*

**Last updated:** 27 Oct 2026 · **Effective date:** [A CONFIRMAR]

This policy explains, in plain language, how Tredane processes personal data under Brazil's General Data Protection Law (LGPD, Law No. 13,709/2018), and how we use data received from Meta's platform (WhatsApp Business Platform / Cloud API). If this English version and the Portuguese version differ, the Portuguese version prevails.

## 1. Who we are

Tredane is a Lucimark service: a software-as-a-service platform that helps clinics and studios serve their clients over WhatsApp, book appointments and collect Pix deposits.

- **Company:** LUCIMARK INOVA SIMPLES (I.S.), Brazil
- **CNPJ (Brazilian company ID):** 66.552.736/0001-80
- **Address:** Condomínio Ouro Vermelho II nº 0, Setor Habitacional Jardim Botânico, Brasília-DF, CEP 71680-385, Brazil
- **Privacy and data protection contact:** [paulo@lucimark.com](mailto:paulo@lucimark.com)

## 2. Who decides about your data (roles)

- **If you are a patient or client of a clinic** that uses Tredane (for example, you messaged the clinic on WhatsApp or booked an appointment): the **clinic is the controller** of your data and decides what it is used for. **Lucimark acts as a processor** ("operador" under the LGPD), processing the data on the clinic's behalf and following its instructions.
- **If you are an owner or staff member of a clinic that uses Tredane:** **Lucimark is the controller** of your account and access data.
- **If you visit tredane.com** or write to us: Lucimark is the controller of the data you send us.

[A CONFIRMAR with legal counsel: the role split above.]

## 3. What data we process and where it is stored

**Patients and contacts of clinics (received through the clinic's WhatsApp):**
- WhatsApp number (wa_id) and WhatsApp profile name (or the name given in the conversation);
- Content of messages sent and received, date and time, and delivery status (sent, delivered, read, failed);
- Attachments received (images, PDFs and audio), kept in private storage;
- Appointments: service, date, time, professional and room;
- Follow-up stage set by the clinic;
- Pix deposit charges: amount, charge identifier, status (pending, paid, expired, refunded) and refund reason, if any.

At aesthetics, hair-removal and similar clinics, conversations may mention procedures or skin or health conditions. Such data may be **sensitive personal data** (LGPD art. 5, II, and art. 11). [A CONFIRMAR with legal counsel]

**Clinic users (owners and staff):**
- Name, email and session/login data, managed by our authentication provider (Clerk), including two-step verification where required;
- Clinic membership, role and invitations;
- Audit records (administrative actions, support requests and sessions, approvals and timestamps);
- Browser push notification subscription (technical browser endpoint). New-conversation notifications do not include message text.

**Clinic data:** clinic name, services, opening hours, professionals, rooms, details of the connected WhatsApp Business account and integration credentials (WhatsApp and Pix), stored encrypted.

**Website visitors:** tredane.com has no forms and no tracking tools; if you email us, we process your address and the content of your message.

**Where it is stored:** each clinic's service data is kept in a database isolated per clinic (Cloudflare Durable Objects); attachments are kept in private storage separated per clinic (Cloudflare R2); account, membership, WhatsApp connection and audit data are kept in a central database (Cloudflare D1); events received from WhatsApp pass through queues (Cloudflare Queues) only for processing. Technical webhook receipt records do not store message bodies or the contact's phone number.

## 4. Data received from Meta's platform (WhatsApp)

Tredane connects to the clinic's WhatsApp Business account through Meta's official platform (WhatsApp Business Platform / Cloud API), with the clinic's own authorization. Through this connection we receive:

- **From the connection (Embedded Signup):** WhatsApp Business Account (WABA) and phone number identifiers, display phone number, verified name and an access token, stored encrypted and never shown in the dashboard;
- **From webhooks:** incoming messages (text and attachments), the sender's number (wa_id) and profile name, and delivery and read updates for messages sent by the clinic;
- **Message templates** approved by Meta for the clinic's account.

**How we use this data:** only to provide the service to the clinic — showing conversations to the clinic's staff, sending the clinic's replies, booking appointments and collecting deposits. We **do not sell** data, **do not use it for advertising**, do not build profiles for third parties and do not share one clinic's data with another. Use follows Meta's WhatsApp Business Terms and Business Messaging Policies: the clinic must have permission to contact its clients, clinic-initiated messages outside the customer service window use Meta-approved templates, and you can ask to stop receiving messages at any time. Meta also processes data under its own privacy policy.

## 5. Purposes and legal bases

| Purpose | Likely legal basis (LGPD) |
| --- | --- |
| Receiving and sending WhatsApp messages on behalf of the clinic | Defined by the clinic as controller; usually performance of a contract or pre-contractual steps (art. 7, V) |
| Booking, changing and reminding appointments | Performance of a contract (art. 7, V) |
| Creating Pix deposit charges and reconciling payment | Performance of a contract (art. 7, V) |
| AI reply suggestions for clinic staff (always reviewed by a person before sending) | Legitimate interest (art. 7, IX) [A CONFIRMAR] |
| Creating and maintaining clinic user accounts, invitations and login | Performance of a contract (art. 7, V) |
| Security, audit, support and fraud prevention | Legitimate interest (art. 7, IX) and legal obligation (art. 7, II) |
| Answering website or email enquiries | Legitimate interest (art. 7, IX) |

Where sensitive health data is involved, the legal basis must follow LGPD art. 11. [A CONFIRMAR with legal counsel: legal basis for each purpose]

## 6. Who we share data with (sub-processors)

We do not sell personal data. We share data only with the providers needed to run the service:

| Provider | Purpose | Data involved |
| --- | --- | --- |
| **Meta Platforms (WhatsApp Business Platform / Cloud API)** | Sending and receiving messages | Number, profile name, messages, attachments and delivery status |
| **Cloudflare** | Hosting (Workers), databases (D1 and Durable Objects), attachment storage (R2), queues (Queues) and technical logs | All service data |
| **Clerk** | Login and authentication of clinic users | Name, email and session of clinic users (no patient data) |
| **Anthropic (via Cloudflare AI Gateway)** | AI reply suggestions, when enabled | Recent messages of the conversation, client's first name, service catalogue and follow-up stage; never phone numbers or attachments. [A CONFIRMAR: enablement with real data, no content logging and no retention] |
| **Woovi / OpenPix** | Pix charges into the clinic's own account (Tredane does not receive or transfer money) | Charge amount, identifier and status |
| Transactional email provider [A CONFIRMAR] | Invitations and notices by email | Name and email of clinic users |
| Browser push services [A CONFIRMAR] | Delivering browser notifications | Technical subscription endpoint; no message text |

We may also share data when required by law or by order of a competent authority.

## 7. International transfers

Some providers (Cloudflare, Meta, Clerk and, when enabled, Anthropic) may process data outside Brazil, for example in the United States and the European Union. In those cases we rely on the safeguards in LGPD art. 33, such as standard contractual clauses or another valid mechanism. [A CONFIRMAR: transfer instruments and hosting regions]

## 8. How long we keep data

- **Service data** (contacts, conversations, attachments, appointments): while the clinic is a Tredane customer, or until the clinic deletes the contact.
- **Contact deletion by the clinic:** we immediately delete that contact's messages, attachments, conversations, AI suggestions and follow-up records. Appointments are kept only in anonymised form (labelled "Contacto removido") and Pix charges are unlinked from the contact. We keep only a technical marker of the number to prevent the contact from being automatically recreated by old messages redelivered by WhatsApp.
- **Clinic account closure:** full deletion of the clinic's data within **30 days**, including attachments, the clinic's database, notifications and access.
- **Audit records** (without message content), **technical logs** and **Pix charge records held by the payment provider**: retention period [A CONFIRMAR].

See how to request deletion in the [Data Deletion Instructions](/data-deletion).

## 9. Security

We apply technical and organisational measures such as: separation of each clinic's data; attachments in private storage, with temporary download links; encrypted integration credentials (WhatsApp and Pix); webhook signature verification; role-based access control and two-step verification for sensitive roles; logs without message content or tokens; and Lucimark support access **only with approval from the clinic owner**, in sessions limited to 30 minutes and with an audit trail. No system is completely immune to failure; in case of a relevant incident we will notify the ANPD (Brazil's data protection authority) and data subjects as required by the LGPD.

## 10. Your rights

Under LGPD art. 18 you may request: confirmation that we process your data; access; correction of incomplete, inaccurate or outdated data; anonymisation, blocking or deletion of unnecessary, excessive or unlawfully processed data; portability; deletion of data processed based on consent; information about who we share data with; information about the option not to consent and its consequences; and withdrawal of consent. You may also file a complaint with the ANPD.

**How to exercise them:**
- **Patient or client of a clinic:** you may contact the clinic directly, as the controller, or write to [paulo@lucimark.com](mailto:paulo@lucimark.com). We will forward your request to the clinic and support it in responding.
- **Clinic user or website visitor:** write to [paulo@lucimark.com](mailto:paulo@lucimark.com).

We will respond within **15 days** [A CONFIRMAR]. We may ask for information to confirm your identity.

## 11. Cookies

tredane.com **does not use analytics or advertising cookies or tracking tools**, and fonts are served by the site itself. The clinic dashboard uses only cookies and storage strictly necessary for login, security and support sessions.

## 12. Children and adolescents

Tredane is intended for clinics and studios and their adult users. We do not knowingly collect children's data. If a clinic serves minors, the clinic, as controller, is responsible for complying with LGPD art. 14 (including consent from a parent or guardian where applicable).

## 13. Changes to this policy

We may update this policy. The current version will always be available at tredane.com/privacy, with its update date. Relevant changes will be communicated to customer clinics.

## 14. Contact and data protection officer

**Privacy contact:** [paulo@lucimark.com](mailto:paulo@lucimark.com)
**Data protection officer (Encarregado/DPO):** [A CONFIRMAR]
