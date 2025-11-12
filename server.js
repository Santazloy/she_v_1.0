const express = require('express');
const cors = require('cors');
const fs = require('fs').promises;
const fsSync = require('fs');
const path = require('path');
const cron = require('node-cron');
const TelegramBot = require('node-telegram-bot-api');
const multer = require('multer');
const { createClient } = require('@supabase/supabase-js');
const dns = require('dns').promises;
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// Telegram bot configuration
const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const CHAT_ID = process.env.TELEGRAM_CHAT_ID;

// Supabase configuration
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_ANON_KEY;
let supabase = null;

// Initialize Supabase client
if (SUPABASE_URL && SUPABASE_KEY) {
    supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
    console.log('Supabase client initialized');
} else {
    console.log('Supabase credentials not provided, using file storage');
}

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

        // Delete existing webhook first to avoid conflicts
        try {
            await bot.deleteWebHook();
            console.log('Cleared existing webhook');
        } catch (err) {
            console.log('No existing webhook to clear');
        }

        // Set new webhook
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
                '/pin - Отправить сообщение с кнопкой для закрепа\n' +
                '\n' +
                '📱 Веб-интерфейс: https://escortwork.org\n' +
                '📸 Используйте кнопку в интерфейсе для отправки скриншотов'
            );
        });

        bot.onText(/^\/pin(?:@[\w_]+)?$/, async (msg) => {
            const chatId = msg.chat.id;
            try {
                // Send message with URL button (opens in browser)
                const sent = await bot.sendMessage(chatId,
                    '📋 *Расписание Shanghai*\n\n' +
                    'Нажмите кнопку ниже для открытия расписания',
                    {
                        parse_mode: 'Markdown',
                        disable_web_page_preview: true,
                        reply_markup: {
                            inline_keyboard: [[
                                {
                                    text: '📋 Открыть расписание',
                                    url: 'https://escortwork.org'
                                }
                            ]]
                        }
                    }
                );

                // Try to pin the message
                try {
                    await bot.pinChatMessage(chatId, sent.message_id, { disable_notification: true });
                    console.log('/pin command executed - message sent and pinned in chat:', chatId);
                } catch (pinError) {
                    console.log('Could not pin message (bot may not be admin):', pinError.message);
                    await bot.sendMessage(chatId,
                        '💡 Сообщение отправлено, но не закреплено.\n' +
                        'Закрепите его вручную или дайте боту права администратора.'
                    );
                }
            } catch (error) {
                console.error('PIN ERROR:', error.message);
                await bot.sendMessage(chatId,
                    '⚠️ Не смог отправить сообщение: ' + error.message
                );
            }
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
    // Try Supabase first
    if (supabase) {
        try {
            console.log('[Supabase] Attempting to read from schedule_data...');
            const { data, error } = await supabase
                .from('schedule_data')
                .select('schedule_data, activity_log')
                .eq('data_key', 'main')
                .single();

            if (error) {
                console.error('[Supabase] Read error:', {
                    message: error.message,
                    details: error.details,
                    hint: error.hint,
                    code: error.code
                });
                throw error;
            }

            console.log('[Supabase] ✅ Read successful');
            return {
                scheduleData: data?.schedule_data || {},
                activityLog: data?.activity_log || []
            };
        } catch (error) {
            console.error('[Supabase] Failed to read, falling back to file:', {
                message: error.message,
                cause: error.cause,
                stack: error.stack?.split('\n')[0]
            });
        }
    }

    // Fallback to file storage
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
    // Try Supabase first
    if (supabase) {
        try {
            const { error } = await supabase
                .from('schedule_data')
                .upsert({
                    data_key: 'main',
                    schedule_data: data.scheduleData || {},
                    activity_log: data.activityLog || []
                }, {
                    onConflict: 'data_key'
                });

            if (error) {
                console.error('Supabase write error:', error.message);
                throw error;
            }

            console.log('✅ Data saved to Supabase');
            return true;
        } catch (error) {
            console.error('Failed to write to Supabase, falling back to file:', error.message);
        }
    }

    // Fallback to file storage
    try {
        await fs.writeFile(getDataFilePath(), JSON.stringify(data, null, 2), 'utf8');
        console.log('✅ Data saved to file');
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

        // Get current dates
        const now = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Shanghai' }));

        // Get today's key (which will become yesterday after reset)
        const todayKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;

        // Preserve permanentNotes from current first day (today)
        const permanentNotes = data.scheduleData?.[todayKey]?.permanentNotes || '';
        console.log('Preserving permanent notes:', permanentNotes ? `${permanentNotes.substring(0, 50)}...` : 'empty');

        // Get yesterday's date (the one we need to remove)
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

        // Get tomorrow's date key (which will become new first day)
        const tomorrow = new Date(now);
        tomorrow.setDate(tomorrow.getDate() + 1);
        const tomorrowKey = `${tomorrow.getFullYear()}-${String(tomorrow.getMonth() + 1).padStart(2, '0')}-${String(tomorrow.getDate()).padStart(2, '0')}`;

        // Ensure tomorrow exists in scheduleData
        if (!data.scheduleData[tomorrowKey]) {
            data.scheduleData[tomorrowKey] = {
                tables: [],
                slots: {}
            };
        }

        // IMPORTANT: Keep permanent notes in the NEW first day (tomorrow becomes today)
        // Permanent notes should ALWAYS stay in the first day
        if (permanentNotes) {
            data.scheduleData[tomorrowKey].permanentNotes = permanentNotes;
            console.log(`Preserved permanent notes in new first day: ${tomorrowKey}`);
        }

        // Preserve and transfer addresses from current first day to new first day
        const todaySlots = data.scheduleData?.[todayKey]?.slots || {};
        const addressesToPreserve = {};

        // Collect all addresses from today
        Object.keys(todaySlots).forEach(table => {
            if (todaySlots[table]?.address) {
                addressesToPreserve[table] = todaySlots[table].address;
            }
        });

        console.log('Preserving addresses:', Object.keys(addressesToPreserve).length > 0 ?
            Object.keys(addressesToPreserve).map(t => `${t}: ${addressesToPreserve[t].substring(0, 20)}...`).join(', ') :
            'none');

        // Transfer addresses to tomorrow (new first day)
        if (Object.keys(addressesToPreserve).length > 0) {
            // Ensure slots structure exists
            if (!data.scheduleData[tomorrowKey].slots) {
                data.scheduleData[tomorrowKey].slots = {};
            }

            // Transfer each address to corresponding table in tomorrow
            Object.keys(addressesToPreserve).forEach(table => {
                // Ensure table slot exists
                if (!data.scheduleData[tomorrowKey].slots[table]) {
                    data.scheduleData[tomorrowKey].slots[table] = {};
                }
                // Transfer the address
                data.scheduleData[tomorrowKey].slots[table].address = addressesToPreserve[table];
            });

            console.log(`Transferred ${Object.keys(addressesToPreserve).length} addresses to new first day: ${tomorrowKey}`);
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

// NOTE: Automatic daily reset is disabled
// Use the manual reset button in the web interface or POST to /api/manual-reset

// Health check endpoints
app.get('/api/health', (req, res) => {
    res.json({
        status: 'ok',
        time: new Date().toISOString(),
        bot: botReady,
        screenshots: 'html2canvas'
    });
});

// Supabase connection test endpoint
app.get('/api/test-supabase', async (req, res) => {
    const results = {
        config: {
            hasSupabaseUrl: !!SUPABASE_URL,
            hasSupabaseKey: !!SUPABASE_KEY,
            supabaseUrl: SUPABASE_URL,
            keyPrefix: SUPABASE_KEY?.substring(0, 20) + '...'
        },
        tests: {}
    };

    // Test 1: Basic fetch to google
    try {
        const response = await fetch('https://www.google.com', { method: 'HEAD' });
        results.tests.basicFetch = {
            success: response.ok,
            status: response.status
        };
    } catch (error) {
        results.tests.basicFetch = {
            success: false,
            error: error.message
        };
    }

    // Test 2: Fetch to Supabase REST API
    try {
        const response = await fetch(`${SUPABASE_URL}/rest/v1/`, {
            headers: {
                'apikey': SUPABASE_KEY,
                'Authorization': `Bearer ${SUPABASE_KEY}`
            }
        });
        results.tests.supabaseRestApi = {
            success: response.ok,
            status: response.status,
            statusText: response.statusText
        };
    } catch (error) {
        results.tests.supabaseRestApi = {
            success: false,
            error: error.message,
            cause: error.cause?.message
        };
    }

    // Test 3: Supabase JS client query
    if (supabase) {
        try {
            const { data, error } = await supabase
                .from('schedule_data')
                .select('id')
                .limit(1);

            results.tests.supabaseJsClient = {
                success: !error,
                error: error?.message,
                dataReceived: !!data
            };
        } catch (error) {
            results.tests.supabaseJsClient = {
                success: false,
                error: error.message,
                cause: error.cause?.message
            };
        }
    } else {
        results.tests.supabaseJsClient = {
            success: false,
            error: 'Supabase client not initialized'
        };
    }

    res.json(results);
});

// DNS diagnostic endpoint
app.get('/api/test-dns', async (req, res) => {
    const results = {
        timestamp: new Date().toISOString(),
        tests: {}
    };

    // Test 1: Resolve google.com
    try {
        const addresses = await dns.resolve4('www.google.com');
        results.tests.googleDns = {
            success: true,
            addresses: addresses
        };
    } catch (error) {
        results.tests.googleDns = {
            success: false,
            error: error.message
        };
    }

    // Test 2: Resolve supabase.com (main domain)
    try {
        const addresses = await dns.resolve4('supabase.com');
        results.tests.supabaseMainDns = {
            success: true,
            addresses: addresses
        };
    } catch (error) {
        results.tests.supabaseMainDns = {
            success: false,
            error: error.message
        };
    }

    // Test 3: Resolve your Supabase project domain
    const supabaseDomain = SUPABASE_URL?.replace('https://', '').replace('http://', '');
    if (supabaseDomain) {
        try {
            const addresses = await dns.resolve4(supabaseDomain);
            results.tests.supabaseProjectDns = {
                success: true,
                domain: supabaseDomain,
                addresses: addresses
            };
        } catch (error) {
            results.tests.supabaseProjectDns = {
                success: false,
                domain: supabaseDomain,
                error: error.message,
                code: error.code
            };
        }

        // Test 4: Try AAAA (IPv6) record
        try {
            const addresses = await dns.resolve6(supabaseDomain);
            results.tests.supabaseProjectDnsIPv6 = {
                success: true,
                domain: supabaseDomain,
                addresses: addresses
            };
        } catch (error) {
            results.tests.supabaseProjectDnsIPv6 = {
                success: false,
                domain: supabaseDomain,
                error: error.message
            };
        }

        // Test 5: ANY record
        try {
            const addresses = await dns.resolveAny(supabaseDomain);
            results.tests.supabaseProjectDnsAny = {
                success: true,
                domain: supabaseDomain,
                records: addresses
            };
        } catch (error) {
            results.tests.supabaseProjectDnsAny = {
                success: false,
                domain: supabaseDomain,
                error: error.message
            };
        }
    }

    res.json(results);
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
        console.log(`⚠️  Automatic daily reset is DISABLED - use manual reset button`);

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