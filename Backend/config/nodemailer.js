const nodemailer = require('nodemailer');

let transporter = null;
let isEthereal = false;

const initTransporter = async () => {
  if (transporter) return transporter;

  // If real SMTP credentials are provided in .env
  if (process.env.SMTP_USER && process.env.SMTP_PASS) {
    const transportConfig = process.env.SMTP_SERVICE
      ? {
          service: process.env.SMTP_SERVICE,
          auth: {
            user: process.env.SMTP_USER,
            pass: process.env.SMTP_PASS
          },
          tls: {
            rejectUnauthorized: false
          }
        }
      : {
          host: process.env.SMTP_HOST || 'smtp.gmail.com',
          port: Number(process.env.SMTP_PORT) || 587,
          secure: process.env.SMTP_SECURE === 'true',
          auth: {
            user: process.env.SMTP_USER,
            pass: process.env.SMTP_PASS
          },
          tls: {
            rejectUnauthorized: false
          }
        };

    transporter = nodemailer.createTransport(transportConfig);

    try {
      await transporter.verify();
      console.log(`[SMTP] Connected to live SMTP server for: ${process.env.SMTP_USER}`);
    } catch (err) {
      console.warn(`[SMTP Warning] Could not verify configured SMTP (${err.message}). Falling back to test account.`);
      transporter = null;
    }
  }

  // Fallback: Automatic Ethereal test account for instant testing without setup
  if (!transporter) {
    try {
      const testAccount = await nodemailer.createTestAccount();
      transporter = nodemailer.createTransport({
        host: 'smtp.ethereal.email',
        port: 587,
        secure: false,
        auth: {
          user: testAccount.user,
          pass: testAccount.pass
        }
      });
      isEthereal = true;
      console.log(`[SMTP] Ethereal test account initialized: ${testAccount.user}`);
    } catch (err) {
      console.log(`[SMTP] Offline/Local sandbox detected. Initializing built-in JSON transport for email inspection.`);
      transporter = nodemailer.createTransport({
        jsonTransport: true
      });
      isEthereal = false;
    }
  }

  return transporter;
};

const sendEmail = async ({ to, subject, html, text }) => {
  const mailer = await initTransporter();
  const from = process.env.EMAIL_FROM || '"NexVault Administration" <noreply@nexvault.internal>';

  const mailOptions = {
    from,
    to,
    subject,
    text: text || html.replace(/<[^>]*>/g, ''),
    html
  };

  const info = await mailer.sendMail(mailOptions);
  let previewUrl = null;

  if (isEthereal && nodemailer.getTestMessageUrl) {
    previewUrl = nodemailer.getTestMessageUrl(info);
    if (previewUrl) {
      console.log(`==================================================`);
      console.log(`[SMTP Email Sent] To: ${to}`);
      console.log(`[SMTP Email Subject]: ${subject}`);
      console.log(`[SMTP Preview Link]: ${previewUrl}`);
      console.log(`==================================================`);
    }
  } else {
    console.log(`==================================================`);
    console.log(`[SMTP Email Sent via Transport]`);
    console.log(`  To:      ${to}`);
    console.log(`  Subject: ${subject}`);
    console.log(`  From:    ${from}`);
    if (info.message) {
      const parsed = JSON.parse(info.message);
      console.log(`  Preview Content (first 100 chars): ${parsed.text ? parsed.text.slice(0, 100).replace(/\s+/g, ' ') : ''}...`);
    }
    console.log(`==================================================`);
  }

  return { info, previewUrl };
};

module.exports = {
  initTransporter,
  sendEmail
};
