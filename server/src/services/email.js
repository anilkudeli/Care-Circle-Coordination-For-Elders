import nodemailer from 'nodemailer';

export function isEmailProviderConfigured(env = process.env) {
  const port = Number(env.SMTP_PORT);
  return Boolean(
    env.SMTP_HOST
    && Number.isInteger(port)
    && port > 0
    && port <= 65535
    && env.SMTP_USER
    && env.SMTP_PASS
    && env.SMTP_FROM
  );
}

export async function sendPasswordResetEmail({ email, name, token }) {
  if (!isEmailProviderConfigured()) {
    const error = new Error('Email provider is not configured.');
    error.code = 'EMAIL_PROVIDER_NOT_CONFIGURED';
    throw error;
  }

  const port = Number(process.env.SMTP_PORT);
  const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port,
    secure: process.env.SMTP_SECURE === 'true' || port === 465,
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
  });
  const resetUrl = new URL('/reset-password', process.env.CLIENT_ORIGIN || 'http://localhost:5173');
  resetUrl.searchParams.set('token', token);

  await transporter.sendMail({
    from: process.env.SMTP_FROM,
    to: email,
    subject: 'Reset your CareCircle password',
    text: `Hello${name ? ` ${name}` : ''},\n\nUse this link to reset your CareCircle password. It expires in one hour and can only be used once:\n\n${resetUrl}\n\nIf you did not request a reset, you can ignore this email.`,
  });
}
