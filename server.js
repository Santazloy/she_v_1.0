const express = require('express');
const cors = require('cors');
const cron = require('node-cron');
const { createClient } = require('@supabase/supabase-js');
const TelegramBot = require('node-telegram-bot-api');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// Supabase configuration (REQUIRED - no fallback!)
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_ANON_KEY;

if (!SUPABASE_URL || !SUPABASE_KEY) {
    console.error('❌ FATAL: Supabase credentials not configured!');
    console.error('Set SUPABASE_URL and SUPABASE_ANON_KEY in .env file');
    process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
console.log('✅ Supabase client initialized');

// Telegram bot configuration
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || '7780834477:AAHLcpVOWOQNn1DkGMneZGm2D-GQTbk-uCk';
const bot = new TelegramBot(TELEGRAM_BOT_TOKEN, { polling: false });

// Telegram chat IDs for each table
const TELEGRAM_CHAT_IDS = {
    '000': '-1003456380758',
    '111': '-1002168406968',
    '222': '-1002433229203',
    '333': '-1002406184936',
    '555': '-1002342166200',
    '666': '-1002315659294',
    '888': '-1002250158149',
    '999': '-1003362558902',
    '北京1': '-1003591371312',
    '北京2': '-1003493686928',
    '⚽️': '-1002468561827'
};

console.log('✅ Telegram bot configured');

// Middleware
app.use(cors());
app.use(express.json({ limit: '50mb' }));

// Read schedule data (ONLY Supabase - NO fallback!)
async function readScheduleData() {
    if (!supabase) {
        throw new Error('Supabase not configured');
    }

    console.log('[Supabase] Reading from schedule_data...');
    const { data, error } = await supabase
        .from('schedule_data')
        .select('schedule_data, activity_log, active_dates')
        .eq('data_key', 'main')
        .single();

    if (error) {
        // If record doesn't exist (PGRST116), return empty data
        if (error.code === 'PGRST116') {
            console.log('[Supabase] No data found - returning empty structure');
            return {
                scheduleData: {},
                activityLog: [],
                activeDates: null
            };
        }

        // Any other error - throw it!
        console.error('[Supabase] ❌ Read error:', error.message);
        throw new Error(`Supabase read failed: ${error.message}`);
    }

    console.log('[Supabase] ✅ Read successful');
    return {
        scheduleData: data?.schedule_data || {},
        activityLog: data?.activity_log || [],
        activeDates: data?.active_dates || null
    };
}

// Write schedule data (ONLY Supabase - NO fallback!)
async function writeScheduleData(data) {
    if (!supabase) {
        throw new Error('Supabase not configured');
    }

    const { error } = await supabase
        .from('schedule_data')
        .upsert({
            data_key: 'main',
            schedule_data: data.scheduleData || {},
            activity_log: data.activityLog || [],
            active_dates: data.activeDates || null
        }, {
            onConflict: 'data_key'
        });

    if (error) {
        console.error('[Supabase] ❌ Write error:', error.message);
        throw new Error(`Supabase write failed: ${error.message}`);
    }

    console.log('[Supabase] ✅ Data saved successfully');
    return true;
}

// Helper function to send Telegram notifications
async function sendTelegramNotification(chatId, message) {
    try {
        await bot.sendMessage(chatId, message, { parse_mode: 'HTML' });
        console.log(`✅ Telegram notification sent to ${chatId}`);
    } catch (error) {
        console.error(`❌ Failed to send Telegram notification to ${chatId}:`, error.message);
    }
}

// Helper function to detect changes between old and new schedule data
function detectScheduleChanges(oldData, newData, user) {
    const changes = [];
    
    // Get all unique date keys from both old and new data
    const allDates = new Set([
        ...Object.keys(oldData || {}).filter(key => key !== 'sharedNotes'),
        ...Object.keys(newData || {}).filter(key => key !== 'sharedNotes')
    ]);
    
    allDates.forEach(dateKey => {
        const oldDateData = oldData?.[dateKey] || { tables: [], slots: {} };
        const newDateData = newData?.[dateKey] || { tables: [], slots: {} };
        
        // Get all unique tables from both old and new data
        const allTables = new Set([
            ...(oldDateData.tables || []),
            ...(newDateData.tables || [])
        ]);
        
        allTables.forEach(table => {
            const oldSlots = oldDateData.slots?.[table] || {};
            const newSlots = newDateData.slots?.[table] || {};
            
            // Get all time slots (excluding 'address')
            const allTimeSlots = new Set([
                ...Object.keys(oldSlots).filter(key => key !== 'address'),
                ...Object.keys(newSlots).filter(key => key !== 'address')
            ]);
            
            allTimeSlots.forEach(timeSlot => {
                const oldValue = oldSlots[timeSlot];
                const newValue = newSlots[timeSlot];
                
                if (oldValue !== newValue) {
                    // Parse date for display
                    const [year, month, day] = dateKey.split('-');
                    const displayDate = `${parseInt(day)}.${parseInt(month)}`;
                    
                    if (!oldValue && newValue) {
                        // New entry added
                        changes.push({
                            type: 'add',
                            table,
                            date: displayDate,
                            time: timeSlot,
                            newValue,
                            user
                        });
                    } else if (oldValue && !newValue) {
                        // Entry deleted
                        changes.push({
                            type: 'delete',
                            table,
                            date: displayDate,
                            time: timeSlot,
                            oldValue,
                            user
                        });
                    } else if (oldValue && newValue) {
                        // Entry modified
                        changes.push({
                            type: 'modify',
                            table,
                            date: displayDate,
                            time: timeSlot,
                            oldValue,
                            newValue,
                            user
                        });
                    }
                }
            });
        });
    });
    
    return changes;
}

// Helper function to check if string contains only emojis
function isOnlyEmojis(str) {
    // Remove all emojis and whitespace, check if anything remains
    const emojiRegex = /[\u{1F600}-\u{1F64F}]|[\u{1F300}-\u{1F5FF}]|[\u{1F680}-\u{1F6FF}]|[\u{1F1E0}-\u{1F1FF}]|[\u{2600}-\u{26FF}]|[\u{2700}-\u{27BF}]|[\u{1F900}-\u{1F9FF}]|[\u{1F000}-\u{1F02F}]|[\u{1F0A0}-\u{1F0FF}]|[\u{1F100}-\u{1F64F}]|[\u{1F680}-\u{1F6FF}]|[\u{1F700}-\u{1F77F}]|[\u{1F780}-\u{1F7FF}]|[\u{1F800}-\u{1F8FF}]|[\u{1FA00}-\u{1FA6F}]|[\u{1FA70}-\u{1FAFF}]/gu;
    const withoutEmojis = str.replace(emojiRegex, '').trim();
    return str.length > 0 && withoutEmojis.length === 0;
}

// Process and send notifications for detected changes
async function processScheduleChanges(changes) {
    for (const change of changes) {
        // Skip if value contains only emojis
        if (isOnlyEmojis(change.newValue || '') || isOnlyEmojis(change.oldValue || '')) {
            console.log(`Skipping emoji-only change in ${change.table}`);
            continue;
        }
        
        let message = '';
        
        // Extract actual booking value (time slot value, not the time column)
        const bookingValue = change.newValue || change.oldValue || '';
        
        switch (change.type) {
            case 'add':
                message = `📝 <b>бронь/预订 ${change.table}</b>\n` +
                         `📅 ${change.date} ⏰ ${bookingValue}`;
                break;
                
            case 'delete':
                message = `🗑️ <b>отмена брони/消除 ${change.table}</b>\n` +
                         `❌ ${change.date} ⏰ ${bookingValue}`;
                break;
                
            case 'modify':
                message = `✏️ <b>Изменение/改变 ${change.table}</b>\n` +
                         `📅${change.date}  ⏰ ${change.oldValue}🔄 ${change.newValue}`;
                break;
        }
        
        // Send to table-specific group
        const tableChatId = TELEGRAM_CHAT_IDS[change.table];
        if (tableChatId) {
            await sendTelegramNotification(tableChatId, message);
        }
        
        // Check if entry contains ⚽️ or 👄 emojis
        const checkValue = change.newValue || change.oldValue || '';
        if (checkValue.includes('⚽️') || checkValue.includes('👄')) {
            // Also send to football group
            const footballChatId = TELEGRAM_CHAT_IDS['⚽️'];
            if (footballChatId && footballChatId !== tableChatId) {
                await sendTelegramNotification(footballChatId, message);
            }
        }
    }
}

// API Routes

// Get all schedule data
app.get('/api/schedule', async (req, res) => {
    try {
        const data = await readScheduleData();

        // Ensure activeDates is set (important for preventing automatic date shifts)
        if (!data.activeDates) {
            data.activeDates = getNextThreeDates();
            await writeScheduleData(data);
        }

        res.json(data);
    } catch (error) {
        res.status(500).json({ error: 'Failed to read schedule data' });
    }
});

// Update schedule data
app.post('/api/schedule', async (req, res) => {
    try {
        // Get the current data before updating
        const oldData = await readScheduleData();
        const newScheduleData = req.body.scheduleData;
        const user = req.body.user || 'unknown'; // Extract user from request
        
        // Detect changes between old and new schedule data
        const changes = detectScheduleChanges(oldData.scheduleData, newScheduleData, user);
        
        // Process and send notifications for detected changes
        if (changes.length > 0) {
            console.log(`📬 Detected ${changes.length} schedule changes by ${user}`);
            await processScheduleChanges(changes);
        }
        
        // Write the updated data
        const success = await writeScheduleData(req.body);
        if (success) {
            res.json({ success: true });
        } else {
            res.status(500).json({ error: 'Failed to save schedule data' });
        }
    } catch (error) {
        console.error('Error in /api/schedule:', error);
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


// Get next three dates helper
function getNextThreeDates() {
    const dates = [];
    const now = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Shanghai' }));

    // CRITICAL: Day changes at 4:00 AM, not midnight!
    // If it's before 4:00 AM, we're still in "yesterday"
    if (now.getHours() < 4) {
        now.setDate(now.getDate() - 1);
    }

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

// Archive and reset schedule (manual trigger only)
async function archiveAndResetSchedule() {
    try {
        console.log('Starting manual day reset...');

        // Get current schedule data
        const data = await readScheduleData();

        // Get current dates with 4:00 AM day boundary
        const now = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Shanghai' }));

        // CRITICAL: Day changes at 4:00 AM, not midnight!
        // If it's before 4:00 AM, we're still in "yesterday"
        if (now.getHours() < 4) {
            now.setDate(now.getDate() - 1);
        }

        // Get today's key (which will become yesterday after reset)
        const todayKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;

        // Preserve shared notes (NOT tied to any specific date)
        const sharedNotes = data.scheduleData.sharedNotes || '';
        console.log('Preserving shared notes:', sharedNotes ? `${sharedNotes.substring(0, 50)}...` : 'empty');

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

        // IMPORTANT: Shared notes stay at top level (not in any specific date)
        if (sharedNotes) {
            data.scheduleData.sharedNotes = sharedNotes;
            console.log('Preserved shared notes at top level');
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

        // Update active dates (CRITICAL: prevents UI from auto-shifting at midnight)
        data.activeDates = getNextThreeDates();
        console.log('Updated active dates:', data.activeDates.map(d => d.display).join(', '));

        // Save updated data
        await writeScheduleData(data);

        console.log('Reset completed successfully');
        console.log('Current days:', Object.keys(data.scheduleData).filter(key => key !== 'sharedNotes'));

    } catch (error) {
        console.error('Error in reset:', error.message);
        throw error;
    }
}

// Health check endpoints
app.get('/api/health', (req, res) => {
    res.json({
        status: 'ok',
        time: new Date().toISOString()
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

// Serve static files (must be after all API routes)
app.use(express.static('.'));

// Start server
async function startServer() {
    // Schedule automatic daily reset at 4:00 AM Shanghai time
    cron.schedule('0 4 * * *', async () => {
        try {
            console.log('🕐 Automatic daily reset triggered at 4:00 AM Shanghai time');
            await archiveAndResetSchedule();
            console.log('✅ Automatic daily reset completed successfully');
        } catch (error) {
            console.error('❌ Automatic daily reset failed:', error.message);
        }
    }, {
        timezone: 'Asia/Shanghai'
    });

    app.listen(PORT, '0.0.0.0', () => {
        console.log(`Server running on port ${PORT}`);
        console.log('✅ Telegram notifications ENABLED for schedule changes');
        console.log('✅ Screenshot feature disabled');
        console.log('✅ Automatic daily reset at 4:00 AM Shanghai time');
        console.log('✅ Manual reset removed (automatic only)');
        console.log('✅ NO file storage fallback - Supabase ONLY!');
    });
}

startServer().catch(err => {
    console.error('Failed to start server:', err);
    process.exit(1);
});