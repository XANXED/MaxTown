import bcrypt from 'bcryptjs';

// bcrypt-хеш пароля Модератора для .env: npm run moderator:hash -- <пароль>
// Печатает готовую строку; одинарные кавычки нужны из-за «$» в хеше.

const password = process.argv[2];
if (!password) {
  console.error('Укажите пароль: npm run moderator:hash -- <пароль>');
  process.exit(1);
}
console.log(`MODERATOR_PASSWORD_HASH='${bcrypt.hashSync(password, 12)}'`);
