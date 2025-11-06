const express = require('express');
const cors = require('cors');
const fs = require('fs').promises;
const fsSync = require('fs');
const path = require('path');
const cron = require('node-cron');
const TelegramBot = require('node-telegram-bot-api');
const multer = require('multer');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// Telegram bot configuration
const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const CHAT_ID = process.env.TELEGRAM_CHAT_ID;

// Initialize bot only if credentials are provided
let bot = null;
let botReady = false;

async function initBot() {
    if (!BOT_TOKEN || !CHAT_ID) {
        console.log('Telegram credentials not provided, bot disabled');
        return;
    }

    try {
        // Create bot with webhook (no polling conflicts!)
        bot = new TelegramBot(BOT_TOKEN);

        // Set webhook URL
        const WEBHOOK_URL = process.env.NODE_ENV === 'production'
            ? 'https://escortwork.org/webhook'
            : `http://localhost:${PORT}/webhook`;

        await bot.setWebHook(WEBHOOK_URL);
        console.log('Webhook set to:', WEBHOOK_URL);

        botReady = true;
        console.log('Telegram bot started successfully via webhook');

        // Register commands
        bot.onText(/\/all/, async (msg) => {
            try {
                // Send request to generate screenshot via special endpoint
                await bot.sendMessage(msg.chat.id,
                    '⏳ Создаю скриншот текущего расписания...'
                );

                // Trigger screenshot generation
                console.log('/all command received - triggering screenshot');

                // Store pending screenshot request
                global.pendingScreenshotChatId = msg.chat.id;

            } catch (error) {
                console.error('Error handling /all command:', error.message);
                bot.sendMessage(msg.chat.id,
                    '⚠️ Не удалось создать скриншот\n\n' +
                    '💡 Попробуйте позже или используйте веб-интерфейс: https://escortwork.org'
                );
            }
        });

        bot.onText(/\/start/, (msg) => {
            bot.sendMessage(msg.chat.id,
                '👋 Привет! Я бот управления расписанием.\n\n' +
                'Команды:\n' +
                '/all - Информация о текущем расписании\n' +
                '\n' +
                '📱 Веб-интерфейс: https://escortwork.org\n' +
                '📸 Используйте кнопку в интерфейсе для отправки скриншотов'
            );
        });

    } catch (error) {
        console.error('Failed to initialize bot:', error.message);
        bot = null;
        botReady = false;
    }
}

// Middleware
app.use(cors());
app.use(express.json({ limit: '50mb' }));

// Multer configuration for file uploads
const storage = multer.memoryStorage();
const upload = multer({
    storage: storage,
    limits: { fileSize: 10 * 1024 * 1024 } // 10MB limit
});

// Data directory setup
const DATA_DIR = path.join(__dirname, 'data');
const SCREENSHOT_DIR = path.join(__dirname, 'screenshots');

// Initialize directories
async function initDirectories() {
    try {
        await fs.mkdir(DATA_DIR, { recursive: true });
        await fs.mkdir(SCREENSHOT_DIR, { recursive: true });
        console.log('Directories initialized');
    } catch (error) {
        console.error('Error creating directories:', error);
    }
}

// Get schedule data file path
function getDataFilePath() {
    return path.join(DATA_DIR, 'schedule.json');
}

// Read schedule data
async function readScheduleData() {
    try {
        const data = await fs.readFile(getDataFilePath(), 'utf8');
        return JSON.parse(data);
    } catch (error) {
        // Return empty structure if file doesn't exist
        return {
            scheduleData: {},
            activityLog: []
        };
    }
}

// Write schedule data
async function writeScheduleData(data) {
    try {
        await fs.writeFile(getDataFilePath(), JSON.stringify(data, null, 2), 'utf8');
        return true;
    } catch (error) {
        console.error('Error writing schedule data:', error);
        return false;
    }
}

// API Routes

// Get all schedule data
app.get('/api/schedule', async (req, res) => {
    try {
        const data = await readScheduleData();
        res.json(data);
    } catch (error) {
        res.status(500).json({ error: 'Failed to read schedule data' });
    }
});

// Update schedule data
app.post('/api/schedule', async (req, res) => {
    try {
        const success = await writeScheduleData(req.body);
        if (success) {
            res.json({ success: true });
        } else {
            res.status(500).json({ error: 'Failed to save schedule data' });
        }
    } catch (error) {
        res.status(500).json({ error: 'Failed to save schedule data' });
    }
});

// Add activity log entry
app.post('/api/activity', async (req, res) => {
    try {
        const data = await readScheduleData();
        const { message, user } = req.body;

        const now = new Date();
        const shanghaiTime = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Shanghai' }));
        const time = `${String(shanghaiTime.getHours()).padStart(2, '0')}:${String(shanghaiTime.getMinutes()).padStart(2, '0')}:${String(shanghaiTime.getSeconds()).padStart(2, '0')}`;

        data.activityLog = data.activityLog || [];
        data.activityLog.unshift({
            time,
            message,
            user,
            timestamp: shanghaiTime.toISOString()
        });

        // Keep last 100 entries
        if (data.activityLog.length > 100) {
            data.activityLog = data.activityLog.slice(0, 100);
        }

        await writeScheduleData(data);
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: 'Failed to add activity log' });
    }
});

// Screenshot upload endpoint (receives image from browser)
app.post('/api/screenshot', upload.single('screenshot'), async (req, res) => {
    if (!bot) {
        return res.status(503).json({
            success: false,
            error: 'Telegram bot not configured'
        });
    }

    try {
        const imageBuffer = req.file.buffer;
        const user = req.body.user || 'unknown';

        // Save screenshot to file
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const filename = `schedule-${timestamp}.jpg`;
        const filepath = path.join(SCREENSHOT_DIR, filename);

        await fs.writeFile(filepath, imageBuffer);
        console.log(`Screenshot saved: ${filepath} (${imageBuffer.length} bytes)`);

        // Send to Telegram
        const now = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Shanghai' }));
        const dateStr = `${now.getDate()}.${now.getMonth() + 1}.${now.getFullYear()}`;
        const timeStr = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;

        // Check if this is from /all command
        const targetChatId = global.pendingScreenshotChatId || CHAT_ID;
        global.pendingScreenshotChatId = null; // Clear pending request

        await bot.sendPhoto(targetChatId, imageBuffer, {
            caption: `📋 Расписание на ${dateStr} в ${timeStr}\n👤 Отправил: ${user}`,
            contentType: 'image/jpeg'
        });

        console.log('Screenshot sent to Telegram successfully');

        // Clean up old screenshots (keep last 10)
        try {
            const files = await fs.readdir(SCREENSHOT_DIR);
            const screenshots = files.filter(f => f.startsWith('schedule-')).sort();
            if (screenshots.length > 10) {
                for (let i = 0; i < screenshots.length - 10; i++) {
                    await fs.unlink(path.join(SCREENSHOT_DIR, screenshots[i]));
                }
            }
        } catch (cleanupError) {
            console.error('Error cleaning up old screenshots:', cleanupError);
        }

        res.json({
            success: true,
            message: 'Screenshot sent to Telegram',
            size: imageBuffer.length
        });

    } catch (error) {
        console.error('Screenshot upload error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to send screenshot'
        });
    }
});

// API endpoint to trigger screenshot (for /all command)
app.get('/api/trigger-screenshot', (req, res) => {
    res.json({
        success: true,
        pending: !!global.pendingScreenshotChatId
    });
});

// Manual trigger for daily reset (for testing)
app.post('/api/manual-reset', async (req, res) => {
    try {
        console.log('Manual reset triggered');
        await archiveAndResetSchedule();
        res.json({ success: true, message: 'Reset completed' });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Get next three dates helper
function getNextThreeDates() {
    const dates = [];
    const now = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Shanghai' }));

    for (let i = 0; i < 3; i++) {
        const date = new Date(now);
        date.setDate(date.getDate() + i);

        const month = date.getMonth() + 1;
        const day = date.getDate();

        dates.push({
            key: `${date.getFullYear()}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`,
            display: `${day}.${month}`
        });
    }

    return dates;
}

// Archive and reset schedule at 4 AM Shanghai time
async function archiveAndResetSchedule() {
    try {
        console.log('Starting daily archive and reset at 4:00 AM Shanghai time...');

        // Get current schedule data
        const data = await readScheduleData();

        // Get yesterday's date (the one we need to remove)
        const now = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Shanghai' }));
        const yesterday = new Date(now);
        yesterday.setDate(yesterday.getDate() - 1);

        const yesterdayKey = `${yesterday.getFullYear()}-${String(yesterday.getMonth() + 1).padStart(2, '0')}-${String(yesterday.getDate()).padStart(2, '0')}`;

        console.log(`Removing data for: ${yesterdayKey}`);

        // Remove yesterday's data
        if (data.scheduleData && data.scheduleData[yesterdayKey]) {
            console.log(`Deleting schedule for ${yesterdayKey}`);
            delete data.scheduleData[yesterdayKey];
        }

        // Add new day (day after tomorrow)
        const newDay = new Date(now);
        newDay.setDate(newDay.getDate() + 2); // Day after tomorrow

        const newDayKey = `${newDay.getFullYear()}-${String(newDay.getMonth() + 1).padStart(2, '0')}-${String(newDay.getDate()).padStart(2, '0')}`;

        console.log(`Adding new empty day: ${newDayKey}`);

        // Create new day with empty schedule
        if (!data.scheduleData[newDayKey]) {
            data.scheduleData[newDayKey] = {
                tables: [],
                slots: {}
            };
        }

        // Save updated data
        await writeScheduleData(data);

        console.log('Archive and reset completed successfully');
        console.log('Current days:', Object.keys(data.scheduleData));

        // Send notification to Telegram
        if (bot) {
            const dateStr = `${yesterday.getDate()}.${yesterday.getMonth() + 1}.${yesterday.getFullYear()}`;
            const newDates = getNextThreeDates();

            await bot.sendMessage(CHAT_ID,
                `🔄 Ежедневное обновление расписания\n\n` +
                `🗑 Удалено: ${dateStr}\n` +
                `📅 Текущие дни:\n` +
                `  • ${newDates[0].display} (сегодня)\n` +
                `  • ${newDates[1].display} (завтра)\n` +
                `  • ${newDates[2].display} (послезавтра)\n\n` +
                `💡 Расписание: https://escortwork.org`
            ).catch(err => console.log('Could not send archive notification:', err.message));
        }

    } catch (error) {
        console.error('Error in archive and reset:', error.message);
        // Continue running even if archive fails
    }
}

// Schedule daily reset at 4 AM Shanghai time
// Cron format: minute hour day month weekday
cron.schedule('0 4 * * *', archiveAndResetSchedule, {
    timezone: 'Asia/Shanghai'
});

// Health check endpoints
app.get('/api/health', (req, res) => {
    res.json({
        status: 'ok',
        time: new Date().toISOString(),
        bot: botReady,
        screenshots: 'html2canvas'
    });
});

app.get('/health', (req, res) => {
    res.json({ status: 'ok', time: new Date().toISOString() });
});

// Root endpoint for Render health check
app.get('/', (req, res, next) => {
    // Check if request is from health checker (no HTML accept header)
    if (!req.headers.accept || !req.headers.accept.includes('text/html')) {
        return res.json({ status: 'ok', service: 'shanghai-schedule' });
    }
    // Otherwise serve static files
    next();
});

// Telegram webhook endpoint
app.post('/webhook', (req, res) => {
    if (bot) {
        bot.processUpdate(req.body);
    }
    res.sendStatus(200);
});

// Serve static files (must be after all API routes)
app.use(express.static('.'));

// Start server
async function startServer() {
    await initDirectories();

    // Start Express first
    app.listen(PORT, '0.0.0.0', async () => {
        console.log(`Server running on port ${PORT}`);
        console.log(`Screenshot method: html2canvas (browser-based)`);
        console.log(`Daily reset scheduled for 4:00 AM Shanghai time`);

        // Then initialize bot with webhook (non-blocking)
        initBot().catch(err => {
            console.error('Bot initialization failed, but server continues:', err.message);
        });
    });
}

startServer().catch(err => {
    console.error('Failed to start server:', err);
    process.exit(1);
});