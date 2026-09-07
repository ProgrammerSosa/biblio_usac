process.env.JWT_SECRET = 'test-jwt-secret';
process.env.JWT_EXPIRES_IN = '12h';
process.env.FRONTEND_URL = 'http://localhost:5173';
process.env.NODE_ENV = 'test';

// Definidas (vacias) para que dotenv.config() en server.js NO las rellene con
// las credenciales reales del .env del desarrollador al requerir la app en pruebas.
process.env.SMTP_USER = '';
process.env.SMTP_PASS = '';
