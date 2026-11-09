/**
 * EMVCo Merchant-Presented QR (MPM) encoder/decoder.
 * Format: repeated TLV fields, each "ID(2) LEN(2) VALUE", ending with CRC "63 04 XXXX".
 * SecurePay's own data lives in merchant account template 26 under GUID "com.securepay".
 * The CRC detects corruption, not tampering: the server always re-checks amount and
 * currency against the stored payment request before taking money.
 */

const SECUREPAY_GUID = 'com.securepay';

export function crc16(data: string): string {
  let crc = 0xffff;
  for (const byte of Buffer.from(data, 'utf8')) {
    crc ^= byte << 8;
    for (let i = 0; i < 8; i++) {
      crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
    }
  }
  return crc.toString(16).toUpperCase().padStart(4, '0');
}

function tlv(id: string, value: string): string {
  const len = Buffer.byteLength(value, 'utf8');
  if (len > 99) throw new Error(`EMV field ${id} too long`);
  return `${id}${len.toString().padStart(2, '0')}${value}`;
}

export function parseTlv(data: string): Record<string, string> {
  const out: Record<string, string> = {};
  let i = 0;
  while (i < data.length) {
    const id = data.slice(i, i + 2);
    const len = Number(data.slice(i + 2, i + 4));
    if (!/^\d{2}$/.test(id) || Number.isNaN(len)) throw new Error('Malformed QR payload');
    const value = data.slice(i + 4, i + 4 + len);
    if (value.length !== len) throw new Error('Truncated QR payload');
    out[id] = value;
    i += 4 + len;
  }
  return out;
}

export interface SecurePayQr {
  requestId: string;
  merchantId: string;
  merchantName: string;
  city: string;
  country: string;
  currencyNumeric: string;
  amount?: string;
  reference?: string;
}

export function encodeQr(q: SecurePayQr): string {
  const merchantInfo = tlv('00', SECUREPAY_GUID) + tlv('01', q.merchantId) + tlv('02', q.requestId);
  let body =
    tlv('00', '01') + // payload format indicator
    tlv('01', q.amount ? '12' : '11') + // 12 = dynamic (single use), 11 = static
    tlv('26', merchantInfo) +
    tlv('52', '0000') + // merchant category code
    tlv('53', q.currencyNumeric) +
    (q.amount ? tlv('54', q.amount) : '') +
    tlv('58', q.country) +
    tlv('59', q.merchantName.slice(0, 25)) +
    tlv('60', q.city.slice(0, 15)) +
    (q.reference ? tlv('62', tlv('05', q.reference.slice(0, 25))) : '');
  body += '6304';
  return body + crc16(body);
}

export function decodeQr(payload: string): SecurePayQr {
  const data = (payload ?? '').trim();
  if (data.length < 20 || !data.slice(-8).startsWith('6304')) throw new Error('Not an EMV QR payload');
  const expected = crc16(data.slice(0, -4));
  if (expected !== data.slice(-4).toUpperCase()) throw new Error('QR checksum mismatch');
  const fields = parseTlv(data.slice(0, -8));
  if (fields['00'] !== '01') throw new Error('Unsupported QR format');
  const merchant = parseTlv(fields['26'] ?? '');
  if (merchant['00'] !== SECUREPAY_GUID) throw new Error('This QR code is not a SecurePay payment code');
  const additional = fields['62'] ? parseTlv(fields['62']) : {};
  return {
    merchantId: merchant['01'],
    requestId: merchant['02'],
    merchantName: fields['59'] ?? '',
    city: fields['60'] ?? '',
    country: fields['58'] ?? '',
    currencyNumeric: fields['53'],
    amount: fields['54'],
    reference: additional['05'],
  };
}
