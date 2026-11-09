import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { configureApp } from './bootstrap';
import { config } from './config';
import { migrate } from './db/migrate';

async function main() {
  if (process.env.MIGRATE_ON_START !== 'false') await migrate();
  const app = await NestFactory.create(AppModule, { logger: ['log', 'warn', 'error'] });
  configureApp(app);
  app.enableShutdownHooks();
  await app.listen(config.port, '0.0.0.0');
  Logger.log(`SecurePay API listening on :${config.port} (docs at /docs)`, 'Bootstrap');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
