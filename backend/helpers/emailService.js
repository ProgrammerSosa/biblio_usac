const nodemailer = require('nodemailer');

let transporter = null;

function getTransporter() {
  if (transporter) return transporter;

  if (!process.env.SMTP_USER || !process.env.SMTP_PASS) {
    console.warn('SMTP no configurado (SMTP_USER/SMTP_PASS faltantes). No se enviaran correos.');
    return null;
  }

  transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST || 'smtp.gmail.com',
    port: Number(process.env.SMTP_PORT) || 587,
    secure: process.env.SMTP_SECURE === 'true',
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    },
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 10_000,
  });

  return transporter;
}

async function sendInvitationEmail({ email, rol, invitationLink }) {
  const activeTransporter = getTransporter();
  if (!activeTransporter) {
    return { enviado: false, motivo: 'SMTP no configurado' };
  }

  const fromName = process.env.SMTP_FROM_NAME || 'Biblioteca Facultad de Derecho USAC';
  const fromEmail = process.env.SMTP_FROM_EMAIL || process.env.SMTP_USER;

  try {
    await activeTransporter.sendMail({
      from: `${fromName} <${fromEmail}>`,
      to: email,
      subject: 'Invitacion al sistema de la Biblioteca - Facultad de Ciencias Juridicas y Sociales',
      html: `
        <p>Hola,</p>
        <p>Se te invito a unirte al sistema de gestion de la Biblioteca de la Facultad de Ciencias Juridicas y Sociales (USAC) con el rol <strong>${rol}</strong>.</p>
        <p>Completa tu registro en el siguiente enlace:</p>
        <p><a href="${invitationLink}">${invitationLink}</a></p>
        <p>Si no esperabas esta invitacion, puedes ignorar este correo.</p>
      `,
    });
    return { enviado: true };
  } catch (err) {
    console.error('Error enviando correo de invitacion:', err.message);
    return { enviado: false, motivo: err.message };
  }
}

module.exports = { sendInvitationEmail };
