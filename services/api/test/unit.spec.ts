import { fromMinor, toMinor } from '../src/common/money';
import { base32Decode, base32Encode, hotp, verifyTotp } from '../src/common/totp';
import { crc16, decodeQr, encodeQr } from '../src/modules/payments/emv-qr';
import { FraudService } from '../src/modules/fraud/fraud.service';

describe('money', () => {
  it('converts decimals to minor units without float drift', () => {
    expect(toMinor('0.10', 'USD')).toBe(10);
    expect(toMinor('19.99', 'USD')).toBe(1999);
    expect(toMinor('1000', 'JPY')).toBe(1000);
    expect(fromMinor(1999, 'USD')).toBe('19.99');
    expect(fromMinor(5, 'USD')).toBe('0.05');
    expect(fromMinor(-250, 'EUR')).toBe('-2.50');
  });
  it('rejects bad input', () => {
    expect(() => toMinor('1.234', 'USD')).toThrow();
    expect(() => toMinor('1.5', 'JPY')).toThrow();
    expect(() => toMinor('-3', 'USD')).toThrow();
    expect(() => toMinor('5', 'XYZ')).toThrow();
  });
});

describe('TOTP (RFC 6238)', () => {
  it('matches the RFC 4226 HOTP test vectors', () => {
    const secret = base32Encode(Buffer.from('12345678901234567890'));
    expect(['755224', '287082', '359152'].map((_, i) => hotp(secret, i))).toEqual(['755224', '287082', '359152']);
  });
  it('round-trips base32 and verifies within drift window', () => {
    const buf = Buffer.from('hello securepay secret');
    expect(base32Decode(base32Encode(buf)).equals(buf)).toBe(true);
    const secret = base32Encode(Buffer.from('12345678901234567890'));
    const now = 59_000;
    expect(verifyTotp(secret, hotp(secret, 1), now)).toBe(1);
    expect(verifyTotp(secret, '000000', now)).toBeNull();
    expect(verifyTotp(secret, 'abc', now)).toBeNull();
  });
});

describe('EMV QR codec', () => {
  it('computes the standard CRC-16/CCITT-FALSE', () => {
    expect(crc16('123456789')).toBe('29B1');
  });
  it('round-trips a dynamic payment QR', () => {
    const payload = encodeQr({
      requestId: '7f0f5c3e-2a7e-4a4a-9b52-0a2a3f8f1c11',
      merchantId: '0b8a1e6e-9f0f-4f7b-8b3a-6e5f1d2c3b4a',
      merchantName: 'Corner Cafe',
      city: 'Lahore',
      country: 'PK',
      currencyNumeric: '840',
      amount: '12.50',
      reference: 'ORDER-42',
    });
    const qr = decodeQr(payload);
    expect(qr.amount).toBe('12.50');
    expect(qr.reference).toBe('ORDER-42');
    expect(qr.merchantName).toBe('Corner Cafe');
  });
  it('rejects tampered payloads', () => {
    const payload = encodeQr({ requestId: 'static', merchantId: 'abc', merchantName: 'X', city: 'Y', country: 'US', currencyNumeric: '840' });
    expect(() => decodeQr(payload.replace('5901X', '5901Z'))).toThrow('checksum');
    expect(() => decodeQr('hello')).toThrow();
  });
});

describe('fraud rules', () => {
  const fraud = new FraudService({} as any);
  const base = {
    amount_usd: 20,
    account_age_days: 200,
    tx_count_1h: 0,
    tx_count_24h: 1,
    amount_sum_24h_usd: 20,
    avg_amount_90d_usd: 30,
    is_new_recipient: 0,
    is_known_device: 1,
    kyc_level: 1,
    hour_of_day: 14,
  };
  it('allows normal behaviour', () => {
    const r = fraud.rules(base);
    expect(fraud.decide(r.score)).toBe('allow');
  });
  it('never lets the model block on its own, but lets it hold for review', () => {
    expect(fraud.decide(fraud.combine(0, 0.99))).toBe('review');
    expect(fraud.decide(fraud.combine(0.15, 0.99))).toBe('review');
    expect(fraud.decide(fraud.combine(0.35, 0.99))).toBe('block');
    expect(fraud.combine(0.2, null)).toBe(0.2);
  });
  it('escalates unusual patterns', () => {
    const r = fraud.rules({ ...base, amount_usd: 4000, avg_amount_90d_usd: 25, is_new_recipient: 1, is_known_device: 0, tx_count_1h: 6 });
    expect(r.score).toBeGreaterThanOrEqual(0.75);
    expect(r.reasons.length).toBeGreaterThan(2);
  });
});
