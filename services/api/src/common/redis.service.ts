import { Injectable, OnModuleDestroy } from '@nestjs/common';
import Redis from 'ioredis';
import { config } from '../config';

@Injectable()
export class RedisService implements OnModuleDestroy {
  readonly client = new Redis(config.redisUrl, { maxRetriesPerRequest: 2, lazyConnect: false });

  async setJson(key: string, value: unknown, ttlSeconds: number) {
    await this.client.set(key, JSON.stringify(value), 'EX', ttlSeconds);
  }

  async getJson<T>(key: string): Promise<T | null> {
    const raw = await this.client.get(key);
    return raw ? (JSON.parse(raw) as T) : null;
  }

  async onModuleDestroy() {
    await this.client.quit();
  }
}
