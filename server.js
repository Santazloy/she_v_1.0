const express = require('express');
const cors = require('cors');
const fs = require('fs').promises;
const fsSync = require('fs');
const path = require('path');
const cron = require('node-cron');
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

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

// Middleware
app.use(cors());
app.use(express.json({ limit: '50mb' }));

// Data directory setup
const DATA_DIR = path.join(__dirname, 'data');

// Initialize directories
async function initDirectories() {
    try {
        await fs.mkdir(DATA_DIR, { recursive: true });
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

// Manual trigger for daily reset
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

// Archive and reset schedule (manual trigger only)
async function archiveAndResetSchedule() {
    try {
        console.log('Starting manual day reset...');

        // Get current schedule data
        const data = await readScheduleData();

        // Get current dates
        const now = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Shanghai' }));

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
    await initDirectories();

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
        console.log('✅ Telegram bot disabled');
        console.log('✅ Screenshot feature disabled');
        console.log('✅ Automatic daily reset at 4:00 AM Shanghai time');
        console.log('✅ Manual reset button available');
    });
}

startServer().catch(err => {
    console.error('Failed to start server:', err);
    process.exit(1);
});