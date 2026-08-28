import crypto from 'node:crypto'

// AES-256-GCM. In production CREDENTIAL_ENC_KEY is fetched from KMS at boot
// rather than read from the environment; the interface below does not change.
const ALGO = 'aes-256-gcm'

function key(): Buffer {
  const raw = process.env.CREDENTIAL_ENC_KEY
  if (!raw) throw new Error('CREDENTIAL_ENC_KEY is not set')
  const buf = Buffer.from(raw, 'base64')
  if (buf.length !== 32) {
    // allow a plain-text dev key by hashing it up to 32 bytes
    return crypto.createHash('sha256').update(raw).digest()
  }
  return buf
}

/** Returns `v1.<iv>.<tag>.<ciphertext>`, all base64url. */
export function encryptSecret(plain: string): string {
  const iv = crypto.randomBytes(12)
  const cipher = crypto.createCipheriv(ALGO, key(), iv)
  const ct = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return ['v1', iv.toString('base64url'), tag.toString('base64url'), ct.toString('base64url')].join(
    '.',
  )
}

export function decryptSecret(payload: string): string {
  const [version, ivB64, tagB64, ctB64] = payload.split('.')
  if (version !== 'v1') throw new Error('unsupported ciphertext version')
  const decipher = crypto.createDecipheriv(ALGO, key(), Buffer.from(ivB64, 'base64url'))
  decipher.setAuthTag(Buffer.from(tagB64, 'base64url'))
  return Buffer.concat([
    decipher.update(Buffer.from(ctB64, 'base64url')),
    decipher.final(),
  ]).toString('utf8')
}

/** Never render a raw secret. Masked form is what the API returns by default. */
export function maskSecret(plain: string): string {
  if (plain.length <= 2) return '••••••'
  return plain.slice(0, 1) + '•'.repeat(Math.max(6, plain.length - 2)) + plain.slice(-1)
}

/** Stable, non-reversible hash for IPs / sessions / user agents in FunnelEvent. */
export function privacyHash(value: string, salt = 'funnel'): string {
  return crypto.createHash('sha256').update(`${salt}:${value}`).digest('base64url').slice(0, 24)
}
