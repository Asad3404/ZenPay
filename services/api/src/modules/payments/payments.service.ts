import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import * as QRCode from 'qrcode';
import { config } from '../../config';
import { DbService } from '../../common/db.service';
import { assertCurrency, CURRENCIES, fromMinor, toMinor } from '../../common/money';
import { RedisService } from '../../common/redis.service';
import { TransfersService } from '../transfers/transfers.service';
import { decodeQr, encodeQr } from './emv-qr';

const numericToCode = Object.fromEntries(Object.entries(CURRENCIES).map(([code, c]) => [c.numeric, code]));

@Injectable()
export class PaymentsService {
  constructor(
    private readonly db: DbService,
    private readonly redis: RedisService,
    private readonly transfers: TransfersService,
  ) {}

  /** Dynamic, single-use QR for a fixed amount (merchant checkout or "request money"). */
  async createRequest(merchantId: string, amountMinor: number, currency: string, reference?: string) {
    const cur = assertCurrency(currency);
    const merchant = await this.db.one('SELECT id, full_name FROM users WHERE id = $1', [merchantId]);
    const row = await this.db.tx(async (client) => {
      const { rows } = await client.query(
        `INSERT INTO payment_requests (merchant_id, amount, currency, reference, payload, expires_at)
         VALUES ($1, $2, $3, $4, '', now() + ($5 || ' minutes')::interval) RETURNING *`,
        [merchantId, amountMinor, cur, reference ?? null, String(config.qrPaymentTtlMinutes)],
      );
      const payload = encodeQr({
        requestId: rows[0].id,
        merchantId,
        merchantName: merchant.full_name,
        city: 'Online',
        country: 'US',
        currencyNumeric: CURRENCIES[cur].numeric,
        amount: fromMinor(amountMinor, cur),
        reference,
      });
      await client.query('UPDATE payment_requests SET payload = $2 WHERE id = $1', [rows[0].id, payload]);
      return { ...rows[0], payload };
    });
    return this.presentRequest(row, true);
  }

  /** Static "pay me" QR: the payer chooses the amount. */
  async myQr(userId: string) {
    const user = await this.db.one('SELECT id, full_name, base_currency FROM users WHERE id = $1', [userId]);
    const payload = encodeQr({
      requestId: 'static',
      merchantId: user.id,
      merchantName: user.full_name,
      city: 'Online',
      country: 'US',
      currencyNumeric: CURRENCIES[user.base_currency].numeric,
    });
    return { payload, qrCodeDataUrl: await QRCode.toDataURL(payload), currency: user.base_currency };
  }

  async listRequests(merchantId: string) {
    await this.expireOld();
    const rows = await this.db.query('SELECT * FROM payment_requests WHERE merchant_id = $1 ORDER BY created_at DESC LIMIT 50', [merchantId]);
    return Promise.all(rows.map((r) => this.presentRequest(r, false)));
  }

  async cancelRequest(merchantId: string, id: string) {
    const rows = await this.db.query(
      `UPDATE payment_requests SET status = 'cancelled' WHERE id = $1 AND merchant_id = $2 AND status = 'pending' RETURNING id`,
      [id, merchantId],
    );
    if (!rows.length) throw new NotFoundException('Pending request not found');
    return { id, status: 'cancelled' };
  }

  /** Decodes and validates a scanned QR before the payer confirms. */
  async parse(payload: string, payerId: string) {
    let qr;
    try {
      qr = decodeQr(payload);
    } catch (err) {
      throw new BadRequestException((err as Error).message);
    }
    const currency = numericToCode[qr.currencyNumeric];
    if (!currency) throw new BadRequestException('Unsupported currency in QR code');
    if (qr.merchantId === payerId) throw new BadRequestException('This is your own QR code');
    const merchant = await this.db.one(`SELECT id, full_name, status FROM users WHERE id = $1`, [qr.merchantId]);
    if (!merchant || merchant.status !== 'active') throw new NotFoundException('Merchant not found');

    if (qr.requestId === 'static') {
      return { type: 'static', merchant: { id: merchant.id, fullName: merchant.full_name }, currency, amount: null, reference: null, requestId: null };
    }
    const req = await this.db.one('SELECT * FROM payment_requests WHERE id = $1', [qr.requestId]);
    if (!req || req.merchant_id !== merchant.id) throw new NotFoundException('Payment request not found');
    if (req.status !== 'pending') throw new ConflictException(`This payment request is ${req.status}`);
    if (new Date(req.expires_at) < new Date()) throw new ConflictException('This QR code has expired');
    // The QR content is untrusted: amount and currency must match what the merchant created.
    if (req.currency !== currency || fromMinor(req.amount, req.currency) !== qr.amount) {
      throw new BadRequestException('QR code does not match the payment request');
    }
    return {
      type: 'dynamic',
      requestId: req.id,
      merchant: { id: merchant.id, fullName: merchant.full_name },
      currency,
      amount: fromMinor(req.amount, req.currency),
      reference: req.reference,
      expiresAt: req.expires_at,
    };
  }

  async pay(
    payerId: string,
    dto: { payload: string; amount?: string; idempotencyKey: string; mfaCode?: string },
    deviceId?: string,
    ip?: string,
  ) {
    const info = await this.parse(dto.payload, payerId);
    const currency = info.currency;
    const amountMinor = info.type === 'dynamic' ? toMinor(info.amount!, currency) : toMinor(dto.amount ?? '', currency);
    if (amountMinor <= 0) throw new BadRequestException('Enter an amount');

    const lockKey = info.requestId ? `qrpay:${info.requestId}` : null;
    if (lockKey && !(await this.redis.client.set(lockKey, payerId, 'EX', 30, 'NX'))) {
      throw new ConflictException('This payment is already being processed');
    }
    try {
      const result = await this.transfers.send({
        senderId: payerId,
        recipientId: info.merchant.id,
        amountMinor,
        currency,
        idempotencyKey: dto.idempotencyKey,
        mfaCode: dto.mfaCode,
        deviceId,
        ip,
        kind: 'qr_payment',
        note: info.reference ?? undefined,
        metadata: { paymentRequestId: info.requestId },
      });
      if (info.requestId) {
        await this.db.query(`UPDATE payment_requests SET status = 'paid', paid_by = $2, entry_id = $3 WHERE id = $1 AND status = 'pending'`, [
          info.requestId,
          payerId,
          result.id,
        ]);
      }
      return result;
    } finally {
      if (lockKey) await this.redis.client.del(lockKey);
    }
  }

  private async expireOld() {
    await this.db.query(`UPDATE payment_requests SET status = 'expired' WHERE status = 'pending' AND expires_at < now()`);
  }

  private async presentRequest(r: any, withImage: boolean) {
    return {
      id: r.id,
      amount: fromMinor(r.amount, r.currency),
      currency: r.currency,
      reference: r.reference,
      status: r.status,
      payload: r.payload,
      qrCodeDataUrl: withImage ? await QRCode.toDataURL(r.payload) : undefined,
      expiresAt: r.expires_at,
      createdAt: r.created_at,
    };
  }
}
