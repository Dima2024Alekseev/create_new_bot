require('dotenv').config({ path: __dirname + '/../primer.env' });
const { Telegraf, session } = require('telegraf');
const LocalSession = require('telegraf-session-local');
const connectDB = require('./config/db');
const { handleStart, checkSubscriptionStatus, extendSubscription, promptForQuestion, requestVpnInfo, handleVpnConfigured } = require('./controllers/userController');
const { handlePhoto, handleApprove, handleReject } = require('./controllers/paymentController');
const { checkPayments, stats } = require('./controllers/adminController'); // Убрали switchMode
const { handleQuestion, handleAnswer, listQuestions } = require('./controllers/questionController');
const { setupReminders } = require('./services/reminderService');
const { checkAdmin } = require('./controllers/adminController');
const { Markup } = require('telegraf');

const bot = new Telegraf(process.env.BOT_TOKEN, {
  telegram: { 
    agent: null,
    handshakeTimeout: 30000
  }
});

bot.use((new LocalSession({ database: 'session_db.json' })).middleware());

connectDB().catch(err => {
  console.error('❌ MongoDB connection failed:', err);
  process.exit(1);
});

process.on('unhandledRejection', (err) => {
  console.error('⚠️ Unhandled Rejection:', err);
});
process.on('uncaughtException', async (err) => {
  console.error('⚠️ Uncaught Exception:', err);
  await bot.stop();
  process.exit(1);
});

// ===== Middleware для ответов АДМИНА и отправки инструкций =====
bot.use(async (ctx, next) => {
  console.log(`[Middleware Debug] Сообщение от: ${ctx.from?.id}`);
  console.log(`[Middleware Debug] awaitinAnswerFor: ${ctx.session?.awaitingAnswerFor}`);
  console.log(`[Middleware Debug] awaitingVpnFileFor: ${ctx.session?.awaitingVpnFileFor}`);
  console.log(`[Middleware Debug] awaitingVpnVideoFor: ${ctx.session?.awaitingVpnVideoFor}`);
  console.log(`[Middleware Debug] Тип сообщения: ${Object.keys(ctx.message || {})}`);

  if (ctx.from?.id === parseInt(process.env.ADMIN_ID)) {
    // 1. Обработка ответа на вопрос
    if (ctx.session?.awaitingAnswerFor && ctx.message?.text) {
      console.log(`[AdminMiddleware] Обработка ответа на вопрос для пользователя ${ctx.session.awaitingAnswerFor}`);
      await handleAnswer(ctx, ctx.session.awaitingAnswerFor, ctx.message.text);
      ctx.session.awaitingAnswerFor = null;
      return;
    }

    // 2. Обработка отправки ФАЙЛА инструкции от админа
    if (ctx.session?.awaitingVpnFileFor && ctx.message?.document) {
      const targetUserId = ctx.session.awaitingVpnFileFor;
      try {
        console.log(`[AdminMiddleware] Отправка файла пользователю ${targetUserId}`);
        await ctx.telegram.sendDocument(targetUserId, ctx.message.document.file_id, {
          caption: '📁 Ваш файл конфигурации VPN:'
        });
        await ctx.reply(`✅ Файл конфигурации успешно отправлен пользователю ${targetUserId}.`);
        
        ctx.session.awaitingVpnFileFor = null;
        ctx.session.awaitingVpnVideoFor = targetUserId;
        await ctx.reply('Теперь, пожалуйста, загрузите видеоинструкцию для этого пользователя:');
        return;
      } catch (error) {
        console.error(`Ошибка при отправке файла пользователю ${targetUserId}:`, error);
        await ctx.reply(`⚠️ Произошла ошибка при отправке файла пользователю ${targetUserId}.`);
        ctx.session.awaitingVpnFileFor = null;
        ctx.session.awaitingVpnVideoFor = null;
        return;
      }
    }

    // 3. Обработка отправки ВИДЕО инструкции от админа
    if (ctx.session?.awaitingVpnVideoFor && ctx.message?.video) {
      const targetUserId = ctx.session.awaitingVpnVideoFor;
      try {
        console.log(`[AdminMiddleware] Отправка видео пользователю ${targetUserId}`);
        await ctx.telegram.sendVideo(targetUserId, ctx.message.video.file_id, {
          caption: '🎬 Видеоинструкция по настройке VPN:'
        });
        await ctx.reply(`✅ Видеоинструкция успешно отправлена пользователю ${targetUserId}.`);

        await ctx.telegram.sendMessage(
            targetUserId,
            'Если вы успешно настроили VPN, пожалуйста, нажмите кнопку ниже:',
            Markup.inlineKeyboard([
                Markup.button.callback('✅ Успешно настроил', `vpn_configured_${targetUserId}`)
            ])
        );

      } catch (error) {
        console.error(`Ошибка при отправке видео пользователю ${targetUserId}:`, error);
        await ctx.reply(`⚠️ Произошла ошибка при отправке видео пользователю ${targetUserId}.`);
      } finally {
        ctx.session.awaitingVpnVideoFor = null;
      }
      return;
    }
    
    if (ctx.message) {
        console.log(`[AdminMiddleware] Сообщение админа не соответствует текущему состоянию ожидания: ${JSON.stringify(ctx.message)}`);
    }
  }
  return next();
});

// ===== Обработчики команд =====
bot.start(handleStart);
bot.hears(/^[^\/].*/, handleQuestion); 

// Админские
bot.command('check', checkPayments);
bot.command('stats', stats);
bot.command('questions', listQuestions);
// bot.command('switchmode', switchMode); // Убрали команду

// Обработка платежей
bot.on('photo', handlePhoto);

// ===== Обработчики кнопок (callback_data) =====
// Кнопки админа
bot.action(/approve_(\d+)/, handleApprove);
bot.action(/reject_(\d+)/, handleReject);
bot.action('list_questions', listQuestions);
// bot.action('switch_mode', switchMode); // Убрали кнопку переключения
bot.action('check_payments_admin', checkPayments);
bot.action('show_stats_admin', stats);

bot.action(/answer_(\d+)/, async (ctx) => {
  if (!checkAdmin(ctx)) {
    return ctx.answerCbQuery('🚫 Только для админа');
  }
  ctx.session.awaitingAnswerFor = ctx.match[1];
  await ctx.reply('✍️ Введите ответ для пользователя:');
  await ctx.answerCbQuery();
});

bot.action(/send_instruction_to_(\d+)/, async (ctx) => {
  if (!checkAdmin(ctx)) {
    return ctx.answerCbQuery('🚫 Только для админа');
  }
  const targetUserId = ctx.match[1];
  ctx.session.awaitingVpnFileFor = targetUserId;
  ctx.session.awaitingVpnVideoFor = null;
  await ctx.reply(`Загрузите *файл* конфигурации (например, .ovpn) для пользователя ${targetUserId}:`);
  await ctx.answerCbQuery();
});

// Кнопки пользователя
bot.action('check_subscription', checkSubscriptionStatus);
bot.action('ask_question', promptForQuestion);
bot.action('extend_subscription', extendSubscription);
bot.action(/send_vpn_info_(\d+)/, requestVpnInfo);
bot.action(/vpn_configured_(\d+)/, handleVpnConfigured);


// ===== Напоминания =====
setupReminders(bot);

// ===== Запуск =====
bot.launch()
  .then(() => console.log('🤖 Бот запущен (Q&A + Payments)'))
  .catch(err => {
    console.error('🚨 Ошибка запуска:', err);
    process.exit(1);
  });

// Graceful shutdown
['SIGINT', 'SIGTERM'].forEach(signal => {
  process.once(signal, async () => {
    console.log(`🛑 Получен ${signal}, останавливаю бота...`);
    try {
      await bot.stop();
      console.log('✅ Бот остановлен');
      process.exit(0);
    } catch (err) {
      console.error('Ошибка завершения:', err);
      process.exit(1);
    }
  });
});