// tools/totp-node/totp.js — Postman-compatible TOTP generator (Base32 nibble mode)
const CryptoJS = require('crypto-js');
require('dotenv').config();

function arg(name) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : undefined;
}
const RAW = process.argv.includes('--raw'); // print only code

function base32ToHex(base32) {
  const base32chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = "", hex = "";
  base32 = base32.replace(/=+$/g, '').replace(/\s+/g, '').toUpperCase();

  for (let i = 0; i < base32.length; i++) {
    const val = base32chars.indexOf(base32.charAt(i));
    if (val < 0) throw new Error("Invalid Base32 char: " + base32.charAt(i));
    bits += val.toString(2).padStart(5, '0');
  }
  for (let i = 0; i + 4 <= bits.length; i += 4) {
    const chunk = bits.substr(i, 4);
    hex += parseInt(chunk, 2).toString(16);
  }
  if (hex.length % 2 === 1) hex = '0' + hex; // align to full byte
  return hex;
}

function leftpad(str, len, pad) {
  return str.length >= len ? str : new Array(len - str.length + 1).join(pad) + str;
}

function generateTOTP(secret) {
  const key = CryptoJS.enc.Hex.parse(base32ToHex(secret));
  const epoch = Math.round(Date.now() / 1000.0);
  const time = leftpad((Math.floor(epoch / 30)).toString(16), 16, '0');
  const hmac = CryptoJS.HmacSHA1(CryptoJS.enc.Hex.parse(time), key);
  const hmacHex = hmac.toString();

  const offset = parseInt(hmacHex.substring(hmacHex.length - 1), 16);
  const binary = (parseInt(hmacHex.substr(offset * 2, 8), 16) & 0x7fffffff) + '';
  return binary.substr(binary.length - 6, 6);
}

// === MAIN ===
function main() {
  const rawSecret = arg('secret') || process.env.OTP_SECRET || "";
  if (!rawSecret || rawSecret.length < 16) {
    console.error("Missing or invalid OTP secret.");
    process.exit(2);
  }
  const cleanedSecret = rawSecret.replace(/\s+/g, '');
  const otp = generateTOTP(cleanedSecret);

  if (RAW) {
    process.stdout.write(otp); // only the code
  } else {
    console.log("Cleaned secret:", cleanedSecret);
    console.log("Generated OTP:", otp);
    console.log("Timestamp:", new Date().toISOString());
  }
  return otp;
}

if (require.main === module) {
  main();
}

module.exports = { generateTOTP, base32ToHex };
