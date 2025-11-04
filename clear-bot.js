// Run this once to clear all bot instances
require('dotenv').config();
const https = require('https');

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;

if (!BOT_TOKEN) {
    console.error('TELEGRAM_BOT_TOKEN not found in .env');
    process.exit(1);
}

// Delete webhook and drop all pending updates
const url = `https://api.telegram.org/bot${BOT_TOKEN}/deleteWebhook?drop_pending_updates=true`;

https.get(url, (res) => {
    let data = '';
    res.on('data', (chunk) => data += chunk);
    res.on('end', () => {
        console.log('Response:', data);
        console.log('\n✅ Webhook deleted and all pending updates dropped!');
        console.log('Now you can start the server.');
    });
}).on('error', (err) => {
    console.error('Error:', err.message);
    process.exit(1);
});