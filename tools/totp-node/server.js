// tools/totp-node/server.js
// Простой HTTP-сервер, отдаёт TOTP как text/plain на /otp и health на /health

const http = require('http');
const { generateTOTP } = require('./totp');

const PORT = Number(process.env.OTP_SERVER_PORT || 8787);
const SECRET = (process.env.OTP_SECRET || '').replace(/\s+/g, '');

if (!SECRET || SECRET.length < 16) {
  console.error('OTP server: missing or invalid OTP_SECRET');
  process.exit(2);
}

function send(res, status, body, headers = {}) {
  res.writeHead(status, Object.assign({ 'Content-Type': 'text/plain' }, headers));
  res.end(body);
}

const server = http.createServer((req, res) => {
  if (req.url === '/health') {
    return send(res, 200, 'ok');
  }
  if (req.url === '/otp') {
    try {
      const code = generateTOTP(SECRET);
      return send(res, 200, String(code));
    } catch (e) {
      console.error('OTP server error:', e && e.stack || e);
      return send(res, 500, 'error');
    }
  }
  send(res, 404, 'not found');
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`OTP server listening on http://127.0.0.1:${PORT}`);
});
