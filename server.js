const express = require('express');
const cors = require('cors');
const fs = require('fs').promises;
const path = require('path');
const cron = require('node-cron');
const TelegramBot = require('node-telegram-bot-api');
const puppeteer = require('puppeteer');
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
        // Create bot without polling
        bot = new TelegramBot(BOT_TOKEN, { polling: false });

        // Force delete webhook and clear any conflicts
        await bot.deleteWebHook({ drop_pending_updates: true });
        console.log('Webhook deleted, all pending updates dropped');

        // Wait a bit for Telegram to process
        await new Promise(resolve => setTimeout(resolve, 2000));

        // Now start polling
        await bot.startPolling({
            polling: {
                interval: 300,
                params: { timeout: 10 }
            }
        });

        botReady = true;
        console.log('Telegram bot started successfully');

        // Register commands
        bot.onText(/\/all/, async (msg) => {
            try {
                const screenshotPath = await takeScreenshot();
                await bot.sendPhoto(msg.chat.id, screenshotPath, {
                    caption: '📋 Актуальное расписание на сегодня'
                });
            } catch (error) {
                console.error('Screenshot error for /all command:', error.message);
                bot.sendMessage(msg.chat.id,
                    '⚠️ Скриншоты недоступны на Free tier Render (нужно 2GB RAM).\n\n' +
                    '💡 Используйте веб-интерфейс: https://she-v-1-0.onrender.com'
                );
            }
        });

        bot.onText(/\/start/, (msg) => {
            bot.sendMessage(msg.chat.id,
                '👋 Привет! Я бот управления расписанием.\n\n' +
                'Команды:\n' +
                '/all - Получить текущее расписание\n' +
                '\n' +
                '📱 Веб-интерфейс: https://she-v-1-0.onrender.com'
            );
        });

        // Handle polling errors
        bot.on('polling_error', (error) => {
            console.error('Polling error:', error.message);
        });

        // Graceful shutdown
        process.on('SIGTERM', async () => {
            console.log('SIGTERM - stopping bot...');
            if (bot) await bot.stopPolling();
            process.exit(0);
        });

        process.on('SIGINT', async () => {
            console.log('SIGINT - stopping bot...');
            if (bot) await bot.stopPolling();
            process.exit(0);
        });

    } catch (error) {
        console.error('Failed to initialize bot:', error.message);
        bot = null;
        botReady = false;
    }
}

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static('.'));

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

// Get activity log file path
function getActivityLogPath() {
    return path.join(DATA_DIR, 'activity.json');
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

// Helper function to resolve Chrome executable
const fsSync = require('fs');

async function resolveChromeExecutable() {
    if (process.env.PUPPETEER_EXECUTABLE_PATH && fsSync.existsSync(process.env.PUPPETEER_EXECUTABLE_PATH)) {
        console.log('Using PUPPETEER_EXECUTABLE_PATH:', process.env.PUPPETEER_EXECUTABLE_PATH);
        return process.env.PUPPETEER_EXECUTABLE_PATH;
    }

    try {
        const ep = await puppeteer.executablePath();
        if (ep && fsSync.existsSync(ep)) {
            console.log('Using Puppeteer auto-detected path:', ep);
            return ep;
        }
    } catch (e) {
        console.log('Puppeteer auto-detection failed:', e.message);
    }

    const base = path.join(__dirname, '.cache', 'puppeteer');
    console.log('Checking project cache:', base);

    if (fsSync.existsSync(base)) {
        const vendors = fsSync.readdirSync(base);
        console.log('Found vendors:', vendors);

        for (const v of vendors) {
            const versionsRoot = path.join(base, v);
            if (!fsSync.existsSync(versionsRoot)) continue;

            const versions = fsSync.readdirSync(versionsRoot);
            versions.sort().reverse();
            console.log(`Versions for ${v}:`, versions);

            for (const ver of versions) {
                const candidate = path.join(versionsRoot, ver, 'chrome-linux64', 'chrome');
                console.log('Checking candidate:', candidate);
                if (fsSync.existsSync(candidate)) {
                    console.log('Found Chrome:', candidate);
                    return candidate;
                }
            }
        }
    }

    throw new Error('Chrome not found');
}

// Screenshot functionality
async function takeScreenshot() {
    let browser;
    try {
        const execPath = await resolveChromeExecutable();
        console.log('Chrome path:', execPath, 'exists?', fsSync.existsSync(execPath));

        browser = await puppeteer.launch({
            headless: 'new',
            executablePath: execPath,
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage',
                '--disable-accelerated-2d-canvas',
                '--disable-gpu',
                '--window-size=1920x1080'
            ]
        });

        const page = await browser.newPage();
        await page.setViewport({ width: 1200, height: 1800 });

        // Load the app
        const url = process.env.NODE_ENV === 'production'
            ? 'https://she-v-1-0.onrender.com'
            : `http://localhost:${PORT}`;

        await page.goto(url, { waitUntil: 'networkidle0' });

        // Auto-login as system user for screenshot
        await page.evaluate(() => {
            localStorage.setItem('currentUser', 'system');
            document.getElementById('loginScreen').style.display = 'none';
            document.getElementById('appContainer').style.display = 'block';
        });

        await page.waitForTimeout(1000);

        // Take screenshot
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const filename = `schedule-${timestamp}.png`;
        const filepath = path.join(SCREENSHOT_DIR, filename);

        await page.screenshot({ path: filepath, fullPage: true });

        return filepath;
    } catch (error) {
        console.error('Screenshot error:', error);
        throw error;
    } finally {
        if (browser) {
            await browser.close();
        }
    }
}

// Send screenshot to Telegram
async function sendScreenshotToTelegram(filepath, caption = '') {
    if (!bot) {
        console.log('Telegram bot not configured, skipping screenshot send');
        return false;
    }
    try {
        await bot.sendPhoto(CHAT_ID, filepath, { caption });
        console.log('Screenshot sent to Telegram');
        return true;
    } catch (error) {
        console.error('Error sending to Telegram:', error);
        return false;
    }
}

// Archive and reset schedule at 4 AM Shanghai time
async function archiveAndResetSchedule() {
    try {
        console.log('Starting daily archive and reset...');

        // Take screenshot before reset
        const screenshotPath = await takeScreenshot();

        // Get current schedule data
        const data = await readScheduleData();

        // Send screenshot to Telegram with today's date
        const now = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Shanghai' }));
        const dateStr = `${now.getDate()}.${now.getMonth() + 1}.${now.getFullYear()}`;
        await sendScreenshotToTelegram(screenshotPath, `📅 Расписание за ${dateStr}`);

        // Get dates
        const dates = getNextThreeDates();

        // Remove oldest day data
        if (data.scheduleData && data.scheduleData[dates[0].key]) {
            delete data.scheduleData[dates[0].key];
        }

        // Save updated data
        await writeScheduleData(data);

        console.log('Archive and reset completed');
    } catch (error) {
        console.error('Error in archive and reset:', error);
    }
}

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

// Schedule daily reset at 4 AM Shanghai time
// Cron format: minute hour day month weekday
cron.schedule('0 4 * * *', archiveAndResetSchedule, {
    timezone: 'Asia/Shanghai'
});

// API endpoint for manual screenshot
app.post('/api/screenshot', async (req, res) => {
    try {
        const screenshotPath = await takeScreenshot();
        res.json({
            success: true,
            message: 'Screenshot taken',
            path: screenshotPath
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: 'Failed to take screenshot'
        });
    }
});

// Health check endpoint
app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', time: new Date().toISOString() });
});

// Start server
async function startServer() {
    await initDirectories();
    await initBot();

    app.listen(PORT, () => {
        console.log(`Server running on port ${PORT}`);
        console.log(`Daily reset scheduled for 4:00 AM Shanghai time`);
    });
}

startServer();