// Например, если primer.env находится в корне проекта, а bot.js в папке src/, то __dirname + '/../primer.env' - правильный путь.
require('dotenv').config({ path: __dirname + '/../primer.env' });

// Отладочные логи для проверки загрузки переменных окружения
console.log('DEBUG: BOT_TOKEN is:', process.env.BOT_TOKEN ? 'LOADED' : 'NOT LOADED');
console.log('DEBUG: ADMIN_ID is:', process.env.ADMIN_ID ? 'LOADED' : 'NOT LOADED');
console.log('DEBUG: WG_EASY_BASE_URL is:', process.env.WG_EASY_BASE_URL ? 'LOADED' : 'NOT LOADED');

const { Telegraf, session, Markup } = require('telegraf'); // Добавил Markup
const LocalSession = require('telegraf-session-local');
const connectDB = require('./config/db'); // Импортируем функцию подключения к БД

// === Контроллеры пользователя ===
const {
    handleStart,
    checkSubscriptionStatus,
    extendSubscription,
    promptForQuestion,
    requestVpnInfo,
    handleVpnConfigured,
    handleUserReplyKeyboard, // У вас не было, но полезно для ReplyKeyboard
    showUserQuestions,       // У вас не было, но полезно для /myquestions
    handleVpnFailed,         // НОВОЕ: для кнопки "Не получилось настроить"
    handleUserVpnIssue       // НОВОЕ: для обработки описания проблемы от пользователя
} = require('./controllers/userController');

// === Контроллеры оплаты ===
const { handlePhoto, handleApprove, handleReject } = require('./controllers/paymentController');

// === Контроллеры администратора ===
const { checkPayments, stats, checkAdmin } = require('./controllers/adminController');

// === Контроллеры вопросов ===
const { handleQuestion, handleAnswer, listQuestions } = require('./controllers/questionController');

// === Сервисы ===
const { setupReminders } = require('./services/reminderService');


// Инициализация бота
const bot = new Telegraf(process.env.BOT_TOKEN, {
    telegram: {
        agent: null, // Используйте прокси, если требуется: new HttpsProxyAgent(process.env.PROXY_SOCKS5)
        handshakeTimeout: 30000 // Увеличьте, если наблюдаются частые таймауты
    }
});

// Использование LocalSession для хранения сессий пользователей
bot.use((new LocalSession({ database: 'session_db.json' })).middleware());

// ===== ГЛАВНАЯ ФУНКЦИЯ ЗАПУСКА БОТА =====
// Ваша логика запуска немного отличается, я сохранил вашу структуру
connectDB().catch(err => {
    console.error('❌ MongoDB connection failed:', err);
    process.exit(1);
});

// ===== Обработка необработанных ошибок для стабильности =====
process.on('unhandledRejection', (reason, promise) => {
    console.error('⚠️ Unhandled Rejection at:', promise, 'reason:', reason);
    // Можно также отправить уведомление администратору
});

process.on('uncaughtException', async (err) => {
    console.error('⚠️ Uncaught Exception:', err);
    // В случае критической ошибки, пытаемся остановить бота перед выходом
    try {
        await bot.stop();
        console.log('✅ Бот остановлен после Uncaught Exception');
    } catch (stopErr) {
        console.error('Ошибка при остановке бота после Uncaught Exception:', stopErr);
    }
    process.exit(1); // Завершаем процесс
});


// ===== Middleware для обработки сообщений администратора И пользователя =====
bot.use(async (ctx, next) => {
    // Отладочные логи для Middleware
    console.log(`[Middleware Debug] Сообщение от: ${ctx.from?.id}`);
    console.log(`[Middleware Debug] awaitingAnswerFor: ${ctx.session?.awaitingAnswerFor}`);
    console.log(`[Middleware Debug] awaitingVpnFileFor: ${ctx.session?.awaitingVpnFileFor}`); // У вас есть эта сессия
    console.log(`[Middleware Debug] awaitingVpnVideoFor: ${ctx.session?.awaitingVpnVideoFor}`);
    console.log(`[Middleware Debug] awaitingVpnIssueFor: ${ctx.session?.awaitingVpnIssueFor}`); // НОВОЕ
    console.log(`[Middleware Debug] Тип сообщения: ${Object.keys(ctx.message || {})}`);

    // Проверяем, является ли отправитель администратором
    if (ctx.from?.id === parseInt(process.env.ADMIN_ID)) {
        // 1. Обработка ответа на вопрос
        if (ctx.session?.awaitingAnswerFor && ctx.message?.text) {
            console.log(`[AdminMiddleware] Обработка ответа на вопрос для пользователя ${ctx.session.awaitingAnswerFor}`);
            await handleAnswer(ctx, ctx.session.awaitingAnswerFor, ctx.message.text);
            ctx.session.awaitingAnswerFor = null; // Сбрасываем ожидание
            return; // Завершаем обработку
        }

        // 2. Обработка отправки ФАЙЛА инструкции от админа (ваша текущая логика)
        if (ctx.session?.awaitingVpnFileFor && ctx.message?.document) {
            const targetUserId = ctx.session.awaitingVpnFileFor;
            try {
                console.log(`[AdminMiddleware] Отправка файла пользователю ${targetUserId}`);
                await ctx.telegram.sendDocument(targetUserId, ctx.message.document.file_id, {
                    caption: '📁 Ваш файл конфигурации VPN:'
                });
                await ctx.reply(`✅ Файл конфигурации успешно отправлен пользователю ${targetUserId}.`);

                ctx.session.awaitingVpnFileFor = null; // Сбрасываем ожидание файла
                ctx.session.awaitingVpnVideoFor = targetUserId; // Устанавливаем ожидание видео
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

                // После отправки видео, пользователь УЖЕ получил кнопки подтверждения/отказа
                // Эти кнопки отправляются в handleApprove, поэтому здесь не дублируем.

            } catch (error) {
                console.error(`Ошибка при отправке видео пользователю ${targetUserId}:`, error);
                await ctx.reply(`⚠️ Произошла ошибка при отправке видео пользователю ${targetUserId}.`);
            } finally {
                ctx.session.awaitingVpnVideoFor = null; // Сбрасываем ожидание в любом случае
            }
            return; // Завершаем обработку
        }

        // Если админ отправил сообщение, которое не соответствует ни одному ожидающему состоянию
        if (ctx.message) {
            console.log(`[AdminMiddleware] Сообщение админа не соответствует текущему состоянию ожидания: ${JSON.stringify(ctx.message)}`);
            // Можно добавить тут какое-то дефолтное поведение или игнорирование
        }
        // Если это админ, мы завершаем обработку здесь, если он не обрабатывал что-то специфичное для админа.
        // Это предотвратит попадание админских сообщений в handleQuestion.
        return next(); // Передаем управление дальше, если админское сообщение не было обработано как ответ/видео
    }

    // *** ЛОГИКА ДЛЯ ПОЛЬЗОВАТЕЛЯ (Или любого, кто не админ) ***
    // НОВОЕ: Обработка описания проблемы с VPN от пользователя
    if (ctx.session?.awaitingVpnIssueFor && ctx.message?.text && ctx.from.id === ctx.session.awaitingVpnIssueFor) {
        console.log(`[UserMiddleware] Обработка описания проблемы VPN от пользователя ${ctx.from.id}`);
        await handleUserVpnIssue(ctx);
        return; // Завершаем обработку
    }

    return next(); // Передаем управление следующему middleware или обработчику (например, bot.hears)
});

// ===== Обработчики команд =====
bot.start(handleStart);
// bot.command('myquestions', showUserQuestions); // Если хотите использовать /myquestions

// !!! ВАЖНО: Обработчики для Reply Keyboard (если будут) ДОЛЖНЫ быть ПЕРЕД общим bot.hears(/^[^\/].*/, handleQuestion);
// Это позволяет обработать нажатия кнопок до того, как они будут интерпретированы как вопрос.
// Если у вас есть Reply Keyboard, то здесь их обрабатывайте, например:
// bot.hears('🗓 Моя подписка', handleUserReplyKeyboard);
// bot.hears('❓ Задать вопрос', handleUserReplyKeyboard);
// bot.hears('💰 Продлить VPN', handleUserReplyKeyboard);
// bot.hears('📚 Мои вопросы', handleUserReplyKeyboard);

// Общий обработчик текстовых сообщений, если ни одна из предыдущих команд/hears не сработала
// Это также будет ловить ответы пользователя на вопрос о причине ненастройки VPN
bot.hears(/^[^\/].*/, handleQuestion); // Эту строку надо оставить, она будет ловить вопросы.
                                       // Middleware выше будет ловить ответы на awaitingVpnIssueFor

// === Админские команды ===
bot.command('check', checkPayments);
bot.command('stats', stats);
bot.command('questions', listQuestions); // Показать список вопросов

// Обработка фотографий (для отправки чеков оплаты)
bot.on('photo', handlePhoto);

// ===== Обработчики кнопок (callback_data) =====
// === Кнопки админа (Inline Keyboard) ===
bot.action(/approve_(\d+)/, handleApprove);
bot.action(/reject_(\d+)/, handleReject);
bot.action('list_questions', listQuestions);
bot.action('check_payments_admin', checkPayments);
bot.action('show_stats_admin', stats);

// Кнопка для ответа на вопрос (устанавливает ожидание ответа)
bot.action(/answer_(\d+)/, async (ctx) => {
    if (!checkAdmin(ctx)) {
        return ctx.answerCbQuery('🚫 Только для админа');
    }
    ctx.session.awaitingAnswerFor = ctx.match[1]; // Сохраняем ID пользователя, которому отвечаем
    await ctx.reply('✍️ Введите ответ для пользователя:');
    await ctx.answerCbQuery(); // Закрываем всплывающее уведомление от кнопки
});

// Кнопка для отправки файла/видео инструкции
bot.action(/send_instruction_to_(\d+)/, async (ctx) => {
    if (!checkAdmin(ctx)) {
        return ctx.answerCbQuery('🚫 Только для админа');
    }
    const targetUserId = ctx.match[1];
    ctx.session.awaitingVpnFileFor = targetUserId; // Устанавливаем ожидание файла
    ctx.session.awaitingVpnVideoFor = null; // Сбрасываем видео, если вдруг было
    await ctx.reply(`Загрузите *файл* конфигурации (например, .conf) для пользователя ${targetUserId}:`);
    await ctx.answerCbQuery();
});


// === Кнопки пользователя (Inline Keyboard) ===
// Эти кнопки могут быть вызваны из сообщений бота (например, после `/start` или `/check_subscription`)
bot.action('check_subscription', checkSubscriptionStatus);
bot.action('ask_question', promptForQuestion);
bot.action('extend_subscription', extendSubscription);
bot.action(/send_vpn_info_(\d+)/, requestVpnInfo); // Кнопка для запроса VPN информации/инструкций
bot.action(/vpn_configured_(\d+)/, handleVpnConfigured); // Кнопка подтверждения настройки VPN
bot.action(/vpn_failed_(\d+)/, handleVpnFailed); // НОВОЕ: Кнопка "Не получилось настроить"

// ===== Напоминания =====
setupReminders(bot);

// ===== Запуск =====
bot.launch()
    .then(() => console.log('🤖 Бот запущен (Q&A + Payments)'))
    .catch(err => {
        console.error('🚨 Ошибка запуска:', err);
        process.exit(1);
    });

// Graceful shutdown (аккуратное завершение работы)
// Обработка сигналов завершения процесса для корректной остановки бота
['SIGINT', 'SIGTERM'].forEach(signal => {
    process.once(signal, async () => {
        console.log(`🛑 Получен ${signal}, останавливаю бота...`);
        try {
            await bot.stop(); // Остановка бота Telegraf
            console.log('✅ Бот остановлен');
            process.exit(0); // Корректный выход из процесса
        } catch (err) {
            console.error('Ошибка завершения:', err);
            process.exit(1); // Выход с ошибкой
        }
    });
});