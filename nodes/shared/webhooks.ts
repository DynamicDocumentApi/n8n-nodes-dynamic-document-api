/**
 * Standard Webhooks signature check (https://www.standardwebhooks.com), as Dynamic Document API signs deliveries:
 * HMAC-SHA256 over `<webhook-id>.<webhook-timestamp>.<raw body>` with the endpoint secret (`whsec_<base64>`),
 * sent as `webhook-signature: v1,<base64>`, several space-separated entries while a secret rotates.
 */
import { createHmac, timingSafeEqual } from 'node:crypto';

export const SIGNATURE_TOLERANCE_SECONDS = 300;

type Headers = Record<string, string | string[] | undefined>;

function header(headers: Headers, name: string): string | undefined {
	const value = headers[name] ?? headers[name.toLowerCase()];
	return Array.isArray(value) ? value[0] : value;
}

export type SignatureCheck = { valid: true } | { valid: false; reason: string };

/** Checks a delivery's signature and timestamp against the endpoint secret. */
export function verifySignature(
	rawBody: Buffer,
	headers: Headers,
	secret: string,
	nowSeconds: number,
	toleranceSeconds = SIGNATURE_TOLERANCE_SECONDS,
): SignatureCheck {
	const id = header(headers, 'webhook-id');
	const timestamp = header(headers, 'webhook-timestamp');
	const signatures = header(headers, 'webhook-signature');
	if (!id || !timestamp || !signatures) return { valid: false, reason: 'missing signature headers' };

	const sentAt = Number(timestamp);
	if (!Number.isFinite(sentAt) || Math.abs(nowSeconds - sentAt) > toleranceSeconds) {
		return { valid: false, reason: 'timestamp outside the tolerance' };
	}

	const key = Buffer.from(secret.trim().replace(/^whsec_/, ''), 'base64');
	if (!key.length) return { valid: false, reason: 'invalid endpoint secret' };
	const expected = createHmac('sha256', key)
		.update(Buffer.concat([Buffer.from(`${id}.${timestamp}.`), rawBody]))
		.digest();

	let matched = false;
	for (const entry of signatures.split(' ')) {
		const part = entry.trim();
		if (!part.startsWith('v1,')) continue;
		const provided = Buffer.from(part.slice(3), 'base64');
		// Compare every candidate so the time taken doesn't reveal which one matched.
		if (provided.length === expected.length && timingSafeEqual(provided, expected)) matched = true;
	}
	return matched ? { valid: true } : { valid: false, reason: 'signature mismatch' };
}
