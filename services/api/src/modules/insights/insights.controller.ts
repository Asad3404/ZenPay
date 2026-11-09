import { Body, Controller, Delete, Get, HttpCode, Param, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiProperty, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsIn, IsString, Length, Matches, MaxLength, ValidateNested } from 'class-validator';
import { AuthUser, CurrentUser } from '../../common/auth';
import { SUPPORTED_CURRENCIES, toMinor } from '../../common/money';
import { InsightsService } from './insights.service';

export const CATEGORIES = ['Food & Dining', 'Groceries', 'Transport', 'Shopping', 'Bills & Utilities', 'Entertainment', 'Health', 'Travel', 'Education', 'Transfers', 'Other'];

class BudgetDto {
  @ApiProperty({ enum: CATEGORIES }) @IsIn(CATEGORIES) category: string;
  @ApiProperty({ example: '300.00' }) @Matches(/^\d+(\.\d{1,2})?$/) monthlyLimit: string;
  @ApiProperty({ enum: SUPPORTED_CURRENCIES }) @IsIn(SUPPORTED_CURRENCIES) currency: string;
}

class ChatTurn {
  @IsIn(['user', 'assistant']) role: 'user' | 'assistant';
  @IsString() @MaxLength(4000) content: string;
}

class ChatDto {
  @ApiProperty() @IsString() @Length(1, 1000) message: string;
  @ApiProperty({ type: [ChatTurn] })
  @IsArray()
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => ChatTurn)
  history: ChatTurn[] = [];
}

@ApiTags('insights')
@ApiBearerAuth()
@Controller('insights')
export class InsightsController {
  constructor(private readonly insights: InsightsService) {}

  @Get()
  summary(@CurrentUser() user: AuthUser) {
    return this.insights.insights(user.id);
  }

  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @HttpCode(200)
  @Post('assistant')
  chat(@CurrentUser() user: AuthUser, @Body() dto: ChatDto) {
    return this.insights.chat(user.id, dto.message, dto.history ?? []);
  }

  @Get('categories')
  categories() {
    return CATEGORIES;
  }

  @Get('budgets')
  budgets(@CurrentUser() user: AuthUser) {
    return this.insights.listBudgets(user.id);
  }

  @Post('budgets')
  upsert(@CurrentUser() user: AuthUser, @Body() dto: BudgetDto) {
    return this.insights.upsertBudget(user.id, dto.category, toMinor(dto.monthlyLimit, dto.currency), dto.currency);
  }

  @Delete('budgets/:id')
  remove(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.insights.deleteBudget(user.id, id);
  }
}
