const nodemailer = require('nodemailer');

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method not allowed' };
  }
  try {
    const { to, subject, html } = JSON.parse(event.body);
    if (!to || !subject || !html) {
      return { statusCode: 400, body: 'Missing fields' };
    }
    const transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: parseInt(process.env.SMTP_PORT),
      secure: process.env.SMTP_SECURE === 'true',
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS,
      },
    });
    await transporter.sendMail({
      from: process.env.SMTP_FROM,
      to,
      subject,
      html,
    });
    return { statusCode: 200, body: 'Email sent' };
  } catch (error) {
    console.error(error);
    return { statusCode: 500, body: error.message };
  }
};