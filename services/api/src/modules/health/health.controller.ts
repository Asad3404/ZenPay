import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Public } from '../../common/auth';
import { DbService } from '../../common/db.service';
import { RedisService } from '../../common/redis.service';

@ApiTags('health')
@Controller('health')
export class HealthController {
  constructor(private readonly db: DbService, private readonly redis: RedisService) {}

  @Public()
  @Get()
  async check() {
    try {
      await this.db.query('SELECT 1');
      await this.redis.client.ping();
      return { status: 'ok', time: new Date().toISOString() };
    } catch (err) {
      throw new ServiceUnavailableException({ status: 'degraded', error: (err as Error).message });
    }
  }
}
