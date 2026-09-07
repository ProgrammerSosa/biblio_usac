require('./setupEnv');

describe('emailService', () => {
  beforeEach(() => {
    jest.resetModules();
    delete process.env.SMTP_USER;
    delete process.env.SMTP_PASS;
  });

  afterAll(() => {
    delete process.env.SMTP_USER;
    delete process.env.SMTP_PASS;
  });

  test('sin SMTP configurado, no intenta enviar y responde enviado:false', async () => {
    const { sendInvitationEmail } = require('../helpers/emailService');

    const resultado = await sendInvitationEmail({
      email: 'auxiliar@usac.gt',
      rol: 'USER',
      invitationLink: 'http://localhost:5173/registro?token=abc',
    });

    expect(resultado.enviado).toBe(false);
  });

  test('con SMTP configurado, envia el correo con el enlace de invitacion', async () => {
    process.env.SMTP_USER = 'biblioteca@gmail.com';
    process.env.SMTP_PASS = 'clave-de-aplicacion';

    const sendMailMock = jest.fn().mockResolvedValue(true);
    jest.doMock('nodemailer', () => ({
      createTransport: jest.fn(() => ({ sendMail: sendMailMock })),
    }));

    const { sendInvitationEmail } = require('../helpers/emailService');

    const resultado = await sendInvitationEmail({
      email: 'auxiliar@usac.gt',
      rol: 'USER',
      invitationLink: 'http://localhost:5173/registro?token=abc',
    });

    expect(resultado.enviado).toBe(true);
    expect(sendMailMock).toHaveBeenCalledTimes(1);

    const opcionesEnviadas = sendMailMock.mock.calls[0][0];
    expect(opcionesEnviadas.to).toBe('auxiliar@usac.gt');
    expect(opcionesEnviadas.html).toContain('http://localhost:5173/registro?token=abc');
  });

  test('si el envio falla, no lanza excepcion y responde enviado:false', async () => {
    process.env.SMTP_USER = 'biblioteca@gmail.com';
    process.env.SMTP_PASS = 'clave-de-aplicacion';

    const sendMailMock = jest.fn().mockRejectedValue(new Error('conexion SMTP rechazada'));
    jest.doMock('nodemailer', () => ({
      createTransport: jest.fn(() => ({ sendMail: sendMailMock })),
    }));

    const { sendInvitationEmail } = require('../helpers/emailService');

    const resultado = await sendInvitationEmail({
      email: 'auxiliar@usac.gt',
      rol: 'USER',
      invitationLink: 'http://localhost:5173/registro?token=abc',
    });

    expect(resultado.enviado).toBe(false);
  });
});
