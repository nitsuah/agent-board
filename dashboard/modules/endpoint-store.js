/**
 * Persistent encrypted store for custom LLM endpoints.
 *
 * API keys are encrypted with AES-256-GCM before writing to disk.
 * The encryption key is derived from ENDPOINT_STORE_SECRET (env) via scrypt.
 * Endpoints without API keys are stored as-is.
 *
 * Storage: ENDPOINT_STORE_PATH env (default /data/endpoints.json)
 */
import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'crypto';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { dirname } from 'path';

const STORE_PATH = process.env.ENDPOINT_STORE_PATH || '/data/endpoints.json';
// NOTE: the literal strings below are key-derivation material (scrypt input), not
// display branding — do not "fix" the motor-pool naming here. Changing either value
// changes the derived AES key and silently makes any existing encrypted
// /data/endpoints.json unreadable for installs relying on the default (unset
// ENDPOINT_STORE_SECRET) key. Left as-is intentionally; see docs/TASKS.md naming pass.
const RAW_SECRET = process.env.ENDPOINT_STORE_SECRET || 'motor-pool-default-secret-change-me';
const ALGO = 'aes-256-gcm';
const SALT = Buffer.from('motor-pool-ep-v1');

// Derive a 32-byte key once at startup
const ENC_KEY = scryptSync(RAW_SECRET, SALT, 32);

if (RAW_SECRET === 'motor-pool-default-secret-change-me') {
  console.warn('[endpoint-store] ENDPOINT_STORE_SECRET is not set — using default key. Set it in .env for real encryption.');
}

function encrypt(plaintext) {
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALGO, ENC_KEY, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1:${iv.toString('hex')}:${tag.toString('hex')}:${encrypted.toString('hex')}`;
}

function decrypt(ciphertext) {
  const parts = ciphertext.split(':');
  if (parts.length !== 4 || parts[0] !== 'v1') throw new Error('Unrecognised ciphertext format');
  const [, ivHex, tagHex, dataHex] = parts;
  const decipher = createDecipheriv(ALGO, ENC_KEY, Buffer.from(ivHex, 'hex'));
  decipher.setAuthTag(Buffer.from(tagHex, 'hex'));
  return decipher.update(Buffer.from(dataHex, 'hex'), undefined, 'utf8') + decipher.final('utf8');
}

export function loadEndpoints() {
  if (!existsSync(STORE_PATH)) return [];
  try {
    const raw = JSON.parse(readFileSync(STORE_PATH, 'utf8'));
    if (!Array.isArray(raw)) return [];
    return raw.map(ep => {
      if (ep._encryptedApiKey) {
        try {
          return { ...ep, apiKey: decrypt(ep._encryptedApiKey), _encryptedApiKey: undefined };
        } catch (e) {
          console.error(`[endpoint-store] Failed to decrypt apiKey for "${ep.key}":`, e.message);
          return { ...ep, apiKey: '', _encryptedApiKey: undefined };
        }
      }
      return ep;
    });
  } catch (e) {
    console.error('[endpoint-store] Failed to load endpoints:', e.message);
    return [];
  }
}

export function saveEndpoints(endpoints) {
  try {
    mkdirSync(dirname(STORE_PATH), { recursive: true });
    const serializable = endpoints.map(ep => {
      const { apiKey, ...rest } = ep;
      if (apiKey) {
        return { ...rest, _encryptedApiKey: encrypt(apiKey) };
      }
      return rest;
    });
    writeFileSync(STORE_PATH, JSON.stringify(serializable, null, 2), 'utf8');
  } catch (e) {
    console.error('[endpoint-store] Failed to save endpoints:', e.message);
  }
}
