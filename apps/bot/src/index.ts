import { Bot } from '@maxhub/max-bot-api';

const token = process.env.BOT_TOKEN;

if (!token) {
  console.error('BOT_TOKEN не задан. Скопируйте .env.example в .env и впишите токен от Master Bot.');
  process.exit(1);
}

const bot = new Bot(token);

bot.on('bot_started', (ctx) => ctx.reply('Привет! Это MaxTown — помощник жильцов дома.'));

bot.start();
