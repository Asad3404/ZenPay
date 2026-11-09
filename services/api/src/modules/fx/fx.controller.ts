import { Controller, Get, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Public } from '../../common/auth';
import { CURRENCIES, fromMinor, toMinor } from '../../common/money';
import { FxService } from './fx.service';

@ApiTags('fx')
@Controller('fx')
export class FxController {
  constructor(private readonly fx: FxService) {}

  @Public()
  @Get('currencies')
  currencies() {
    return Object.entries(CURRENCIES).map(([code, c]) => ({ code, name: c.name, decimals: c.exponent }));
  }

  @Public()
  @Get('rates')
  rates() {
    return this.fx.getRates();
  }

  @Public()
  @Get('quote')
  async quote(@Query('from') from: string, @Query('to') to: string, @Query('amount') amount: string) {
    const q = await this.fx.quote(toMinor(amount, from), from, to);
    return {
      ...q,
      amount: fromMinor(q.amountMinor, q.from),
      fee: fromMinor(q.feeMinor, q.from),
      receive: fromMinor(q.receiveMinor, q.to),
    };
  }
}
