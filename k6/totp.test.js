import { generateTOTP } from './lib/totp.js';
import { config } from './lib/config.js';

export default function () {
  const secret = config.get('OTP_SECRET');
  const otp = generateTOTP(secret);
  console.log(`k6/lib/totp.js OTP: ${otp}`);
}
