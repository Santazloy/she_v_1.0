const TelegramBot = require('node-telegram-bot-api');

// Bot token
const TELEGRAM_BOT_TOKEN = '7780834477:AAHLcpVOWOQNn1DkGMneZGm2D-GQTbk-uCk';

// Create bot instance
const bot = new TelegramBot(TELEGRAM_BOT_TOKEN, { polling: false });

// Test chat ID (⚽️ group)
const testChatId = '-1002468561827';

async function testBot() {
    try {
        console.log('Testing Telegram bot...');
        
        // Send test message
        await bot.sendMessage(testChatId, '🚀 <b>Тест системы уведомлений</b>\n\nСистема уведомлений Shanghai Schedule активирована!', {
            parse_mode: 'HTML'
        });
        
        console.log('✅ Test message sent successfully!');
    } catch (error) {
        console.error('❌ Failed to send test message:', error.message);
    }
}

testBot();