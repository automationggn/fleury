const crypto = require("crypto");

const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

// module-level config set by configureTotp()
let TOTP_CFG = { period: 30, digits: 6, algorithm: "SHA1" };

function configureTotp({ period = 30, digits = 6, algorithm = "SHA1" } = {}) {
  TOTP_CFG = { period, digits, algorithm: algorithm.toUpperCase() };
}

// RFC4648 Base32 (no padding required)
function base32Decode(str) {
  const clean = (str || "")
    .toUpperCase()
    .replace(/=+$/g, "")
    .replace(/[^A-Z2-7]/g, "");

  let bits = 0;
  let value = 0;
  const bytes = [];

  for (const ch of clean) {
    const idx = ALPHABET.indexOf(ch);
    if (idx === -1) continue;

    value = (value << 5) | idx;
    bits += 5;

    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(bytes);
}

function base32Encode(buf) {
  let bits = 0;
  let value = 0;
  let output = "";
  for (const b of buf) {
    value = (value << 8) | b;
    bits += 8;
    while (bits >= 5) {
      output += ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) output += ALPHABET[(value << (5 - bits)) & 31];
  return output;
}

function generateSecretBase32(byteLen = 20) {
  return base32Encode(crypto.randomBytes(byteLen));
}

// HOTP dynamic truncation (RFC4226)
function hotp(secretBytes, counter, digits, algorithm) {
  const counterBuf = Buffer.alloc(8);
  counterBuf.writeBigUInt64BE(BigInt(counter), 0);

  const algo = algorithm.toLowerCase(); // "sha1" | "sha256" | "sha512"
  const hmac = crypto.createHmac(algo, secretBytes).update(counterBuf).digest();

  const offset = hmac[hmac.length - 1] & 0x0f;
  const code =
    ((hmac[offset] & 0x7f) << 24) |
    ((hmac[offset + 1] & 0xff) << 16) |
    ((hmac[offset + 2] & 0xff) << 8) |
    (hmac[offset + 3] & 0xff);

  const otp = (code % 10 ** digits).toString().padStart(digits, "0");
  return otp;
}

function totpAt(secretBase32, epochSeconds) {
  const { period, digits, algorithm } = TOTP_CFG;
  const secretBytes = base32Decode(secretBase32);
  const counter = Math.floor(epochSeconds / period);
  return hotp(secretBytes, counter, digits, algorithm);
}

// Verify with ±window time steps
function verifyOtp({ secret, token, window = 1 } = {}) {
  const { period } = TOTP_CFG;
  const now = Math.floor(Date.now() / 1000);

  for (let w = -window; w <= window; w++) {
    const candidate = totpAt(secret, now + w * period);
    if (candidate === token) return true;
  }
  return false;
}

function getTimeStep({ period = TOTP_CFG.period } = {}) {
  return Math.floor(Date.now() / 1000 / period);
}

module.exports = {
  generateSecretBase32,
  configureTotp,
  verifyOtp,
  getTimeStep
};
