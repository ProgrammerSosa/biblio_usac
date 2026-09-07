const crypto = require('crypto');
const jwt = require('jsonwebtoken');

function generateJWT(user) {
  return jwt.sign(
    { userId: user._id.toString(), rol: user.rol },
    process.env.JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRES_IN || '12h' }
  );
}

function verifyJWT(token) {
  return jwt.verify(token, process.env.JWT_SECRET);
}

function generateInvitationToken() {
  return crypto.randomBytes(32).toString('hex');
}

function buildInvitationLink(token) {
  const base = process.env.FRONTEND_URL || 'http://localhost:5173';
  return `${base}/registro?token=${token}`;
}

module.exports = { generateJWT, verifyJWT, generateInvitationToken, buildInvitationLink };
