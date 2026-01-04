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
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;

if (!TELEGRAM_BOT_TOKEN) {
    console.error('❌ FATAL: TELEGRAM_BOT_TOKEN not configured!');
    console.error('Set TELEGRAM_BOT_TOKEN in .env file');
    process.exit(1);
}

const bot = new TelegramBot(TELEGRAM_BOT_TOKEN, { polling: true });

// OpenAI Configuration
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const GPT_MODEL = 'gpt-5'; // Самая мощная модель

// Память чатов для GPT (30 сообщений на чат)
const chatMemory = new Map();
const MAX_MEMORY_MESSAGES = 30;

// Системный промпт для GPT
const GPT_SYSTEM_PROMPT = `Ты умный и полезный ассистент. Отвечай четко, структурированно и не слишком объёмно.

ВАЖНО! Форматируй ответы по следующим правилам:
1. Каждый заголовок раздела должен быть ЖИРНЫМ с эмодзи: <b>📌 Заголовок</b>
2. Весь текст под заголовком оберни в <pre>текст</pre>
3. Используй подходящие эмодзи для заголовков: 📌 💡 🔥 ⚡ 🎯 ✨ 📊 🛠 💎 🚀
4. Если ответ содержит несколько частей - делай отдельный заголовок для каждой
5. Будь лаконичен - не растягивай текст

Пример формата:
<b>🎯 Основная мысль</b>
<pre>Краткое объяснение сути вопроса</pre>

<b>💡 Решение</b>
<pre>Конкретные шаги или ответ</pre>`;

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
    '⚽️': '-1002468561827',
    '北京': '-1003698590476'
};

// Balance tracking groups
const BALANCE_GROUPS = {
    '-1003338510072': 'Alexa',
    '-1003687023938': 'Elizabeth',
    '-1003560225793': 'Mihail',
    '-1003505763286': 'Kris',
    '-1003369127776': 'Talia'
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
    
    // Get all unique date keys from both old and new data (exclude global keys)
    const globalKeys = ['sharedNotes', 'sharedAddresses'];
    const allDates = new Set([
        ...Object.keys(oldData || {}).filter(key => !globalKeys.includes(key)),
        ...Object.keys(newData || {}).filter(key => !globalKeys.includes(key))
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
                    if (!oldValue && newValue) {
                        // New entry added
                        changes.push({
                            type: 'add',
                            table,
                            dateKey,
                            time: timeSlot,
                            newValue,
                            user
                        });
                    } else if (oldValue && !newValue) {
                        // Entry deleted
                        changes.push({
                            type: 'delete',
                            table,
                            dateKey,
                            time: timeSlot,
                            oldValue,
                            user
                        });
                    } else if (oldValue && newValue) {
                        // Entry modified
                        changes.push({
                            type: 'modify',
                            table,
                            dateKey,
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

// Get today's date key (with 4:00 AM boundary)
function getTodayKey() {
    const now = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Shanghai' }));
    if (now.getHours() < 4) {
        now.setDate(now.getDate() - 1);
    }
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

// Process and send notifications for detected changes (TODAY only!)
async function processScheduleChanges(changes) {
    const todayKey = getTodayKey();

    for (const change of changes) {
        // ONLY publish changes for TODAY - future days will be published when they become "today"
        if (change.dateKey !== todayKey) {
            console.log(`Skipping notification for future day ${change.dateKey} (today is ${todayKey})`);
            continue;
        }

        // Skip if value contains only emojis
        if (isOnlyEmojis(change.newValue || '') || isOnlyEmojis(change.oldValue || '')) {
            console.log(`Skipping emoji-only change in ${change.table}`);
            continue;
        }

        let message = '';

        // Extract actual booking value (time slot value, not the time column)
        const bookingValue = change.newValue || change.oldValue || '';

        // Messages WITHOUT dates (as requested)
        switch (change.type) {
            case 'add':
                message = `📝 <b>бронь/预订 ${change.table}</b>\n` +
                         `⏰ ${bookingValue}`;
                break;

            case 'delete':
                message = `🗑️ <b>отмена брони/消除 ${change.table}</b>\n` +
                         `❌ ${bookingValue}`;
                break;

            case 'modify':
                message = `✏️ <b>Изменение/改变 ${change.table}</b>\n` +
                         `⏰ ${change.oldValue}🔄 ${change.newValue}`;
                break;
        }

        // Send to table-specific group
        const tableChatId = TELEGRAM_CHAT_IDS[change.table];
        if (tableChatId) {
            await sendTelegramNotification(tableChatId, message);
        }

        // Check if entry contains ⚽️ or 👄 emojis -> send to football group
        const checkValue = change.newValue || change.oldValue || '';
        if (checkValue.includes('⚽️') || checkValue.includes('👄')) {
            const footballChatId = TELEGRAM_CHAT_IDS['⚽️'];
            if (footballChatId && footballChatId !== tableChatId) {
                await sendTelegramNotification(footballChatId, message);
            }
        }

        // Check if entry contains 💎 emoji -> send to 北京 group
        if (checkValue.includes('💎')) {
            const beijingChatId = TELEGRAM_CHAT_IDS['北京'];
            if (beijingChatId && beijingChatId !== tableChatId) {
                await sendTelegramNotification(beijingChatId, message);
            }
        }
    }
}

// Balance Management Functions
async function getGroupBalance(chatId) {
    const { data, error } = await supabase
        .from('work_balance')
        .select('*')
        .eq('chat_id', chatId)
        .single();
    
    if (error && error.code !== 'PGRST116') {
        console.error('[Supabase] Error reading balance:', error);
        throw error;
    }
    
    return data;
}

async function updateGroupBalance(chatId, amount, operation) {
    const now = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Shanghai' }));
    const timestamp = now.toISOString();

    // CRITICAL: Day changes at 4:00 AM, not midnight!
    // Must match the logic in getDailyStats/getWeeklyStats/getMonthlyStats
    const dayDate = new Date(now);
    if (dayDate.getHours() < 4) {
        dayDate.setDate(dayDate.getDate() - 1);
    }
    const dayKey = `${dayDate.getFullYear()}-${String(dayDate.getMonth() + 1).padStart(2, '0')}-${String(dayDate.getDate()).padStart(2, '0')}`;

    // Get current balance
    const currentData = await getGroupBalance(chatId);
    const currentBalance = parseFloat(currentData?.current_balance || 0);

    // Calculate new balance
    const newBalance = operation === 'add' ? currentBalance + amount : currentBalance - amount;

    // Use upsert instead of update to handle missing records
    const { error: balanceError } = await supabase
        .from('work_balance')
        .upsert({
            chat_id: chatId,
            group_name: BALANCE_GROUPS[chatId],
            current_balance: newBalance,
            updated_at: timestamp
        }, {
            onConflict: 'chat_id'
        });

    if (balanceError) {
        console.error('[Supabase] Error updating balance:', balanceError);
        throw balanceError;
    }

    // Record transaction with explicit timestamp
    const { error: transactionError } = await supabase
        .from('work_transactions')
        .insert({
            group_name: BALANCE_GROUPS[chatId],
            chat_id: chatId,
            amount: amount,
            operation: operation,
            day_key: dayKey,
            timestamp: timestamp
        });

    if (transactionError) {
        console.error('[Supabase] Error recording transaction:', transactionError);
        throw transactionError;
    }

    console.log(`[Supabase] ✅ Balance updated for ${BALANCE_GROUPS[chatId]}: ${operation} ${amount}, new balance: ${newBalance}, day_key: ${dayKey}`);

    return newBalance;
}

// GPT Chat Functions
async function callGPT(messages) {
    if (!OPENAI_API_KEY) {
        throw new Error('OpenAI API key not configured');
    }

    const response = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${OPENAI_API_KEY}`
        },
        body: JSON.stringify({
            model: GPT_MODEL,
            messages: messages,
            max_completion_tokens: 2000
        })
    });

    if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error?.message || 'GPT API error');
    }

    const data = await response.json();
    return data.choices[0].message.content;
}

// Получить или создать память чата
function getChatMemory(chatId) {
    if (!chatMemory.has(chatId)) {
        chatMemory.set(chatId, []);
    }
    return chatMemory.get(chatId);
}

// Добавить сообщение в память
function addToMemory(chatId, role, content) {
    const memory = getChatMemory(chatId);
    memory.push({ role, content });

    // Ограничиваем до 30 сообщений
    while (memory.length > MAX_MEMORY_MESSAGES) {
        memory.shift();
    }
}

// Очистить память чата
function clearChatMemory(chatId) {
    chatMemory.set(chatId, []);
}

// Обработчик команды /gpt
bot.onText(/^\/gpt(?:\s+(.+))?$/s, async (msg, match) => {
    const chatId = msg.chat.id.toString();
    const userMessage = match[1]?.trim();

    // Если команда без текста - показать справку
    if (!userMessage) {
        const helpMessage = `<b>🤖 GPT Ассистент</b>

<pre>Использование:
/gpt [ваш вопрос]

Примеры:
/gpt Что такое машинное обучение?
/gpt Напиши код сортировки на Python

/gpt clear - очистить историю диалога</pre>

<b>💡 Модель:</b> <code>${GPT_MODEL}</code>
<b>📝 Память:</b> <code>${MAX_MEMORY_MESSAGES} сообщений</code>`;

        await sendTelegramNotification(chatId, helpMessage);
        return;
    }

    // Команда очистки памяти
    if (userMessage.toLowerCase() === 'clear') {
        clearChatMemory(chatId);
        await sendTelegramNotification(chatId, '🧹 <b>История диалога очищена!</b>');
        return;
    }

    try {
        // Отправляем "typing" статус
        await bot.sendChatAction(chatId, 'typing');

        // Добавляем сообщение пользователя в память
        addToMemory(chatId, 'user', userMessage);

        // Формируем сообщения для API
        const messages = [
            { role: 'system', content: GPT_SYSTEM_PROMPT },
            ...getChatMemory(chatId)
        ];

        // Вызываем GPT
        const response = await callGPT(messages);

        // Добавляем ответ в память
        addToMemory(chatId, 'assistant', response);

        // Отправляем ответ
        await sendTelegramNotification(chatId, response);

        console.log(`[GPT] Response sent to chat ${chatId}`);

    } catch (error) {
        console.error('[GPT] Error:', error.message);
        await sendTelegramNotification(chatId, `❌ <b>Ошибка GPT:</b>\n<pre>${error.message}</pre>`);
    }
});

// Telegram bot message handler for balance groups
bot.on('message', async (msg) => {
    try {
        const chatId = msg.chat.id.toString();
        const text = msg.text;

        // Check if message is from a balance tracking group
        if (!BALANCE_GROUPS[chatId]) {
            return;
        }

        // Skip if no text (e.g., stickers, photos, etc.)
        if (!text) {
            return;
        }

        // Parse amount from message (format: +100 or -50)
        const match = text.match(/^([+-])(\d+(?:\.\d+)?)$/);
        if (match) {
            const operation = match[1] === '+' ? 'add' : 'subtract';
            const amount = parseFloat(match[2]);

            try {
                const newBalance = await updateGroupBalance(chatId, amount, operation);
                const message = `✅ ${operation === 'add' ? 'Добавлено' : 'Вычтено'}: <b>${amount}</b>\n💰 Новый баланс: <b>${newBalance}</b>`;
                await sendTelegramNotification(chatId, message);
            } catch (error) {
                console.error(`[Balance] Error updating balance for ${BALANCE_GROUPS[chatId]}:`, error.message);
                await sendTelegramNotification(chatId, '❌ Ошибка обновления баланса');
            }
        }
    } catch (error) {
        console.error('[Bot] Unexpected error in message handler:', error.message);
    }
});

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

// Publish all entries for a specific day (used when day becomes "today" at 4:00 AM)
async function publishDayEntries(scheduleData, dateKey) {
    const dayData = scheduleData[dateKey];
    if (!dayData || !dayData.tables || dayData.tables.length === 0) {
        console.log(`No entries to publish for ${dateKey}`);
        return;
    }

    console.log(`📢 Publishing entries for new day ${dateKey}...`);

    const timeSlots = ['12:00', '13:00', '14:00', '15:00', '16:00', '17:00',
                       '18:00', '19:00', '20:00', '21:00', '22:00', '23:00',
                       '00:00', '01:00', '02:00'];

    // Iterate through tables and time slots in order (top to bottom)
    for (const table of dayData.tables) {
        const slots = dayData.slots?.[table] || {};

        for (const timeSlot of timeSlots) {
            const value = slots[timeSlot];
            if (!value) continue;

            // Skip if value contains only emojis
            if (isOnlyEmojis(value)) {
                console.log(`Skipping emoji-only entry in ${table} at ${timeSlot}`);
                continue;
            }

            const message = `📝 <b>бронь/预订 ${table}</b>\n⏰ ${value}`;

            // Send to table-specific group
            const tableChatId = TELEGRAM_CHAT_IDS[table];
            if (tableChatId) {
                await sendTelegramNotification(tableChatId, message);
            }

            // Check if entry contains ⚽️ or 👄 emojis -> send to football group
            if (value.includes('⚽️') || value.includes('👄')) {
                const footballChatId = TELEGRAM_CHAT_IDS['⚽️'];
                if (footballChatId && footballChatId !== tableChatId) {
                    await sendTelegramNotification(footballChatId, message);
                }
            }

            // Check if entry contains 💎 emoji -> send to 北京 group
            if (value.includes('💎')) {
                const beijingChatId = TELEGRAM_CHAT_IDS['北京'];
                if (beijingChatId && beijingChatId !== tableChatId) {
                    await sendTelegramNotification(beijingChatId, message);
                }
            }
        }
    }

    console.log(`✅ Finished publishing entries for ${dateKey}`);
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

        // Preserve shared notes and shared addresses (NOT tied to any specific date)
        const sharedNotes = data.scheduleData.sharedNotes || '';
        const sharedAddresses = data.scheduleData.sharedAddresses || {};
        console.log('Preserving shared notes:', sharedNotes ? `${sharedNotes.substring(0, 50)}...` : 'empty');
        console.log('Preserving shared addresses:', Object.keys(sharedAddresses).length > 0 ?
            Object.keys(sharedAddresses).map(t => `${t}: ${sharedAddresses[t].substring(0, 20)}...`).join(', ') : 'empty');

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

        // IMPORTANT: Shared notes and addresses stay at top level (not in any specific date)
        if (sharedNotes) {
            data.scheduleData.sharedNotes = sharedNotes;
            console.log('Preserved shared notes at top level');
        }

        // Shared addresses are now global and don't need transfer - just preserve them
        if (Object.keys(sharedAddresses).length > 0) {
            data.scheduleData.sharedAddresses = sharedAddresses;
            console.log('Preserved shared addresses at top level');
        }

        // Update active dates (CRITICAL: prevents UI from auto-shifting at midnight)
        data.activeDates = getNextThreeDates();
        console.log('Updated active dates:', data.activeDates.map(d => d.display).join(', '));

        // Save updated data
        await writeScheduleData(data);

        console.log('Reset completed successfully');
        const globalKeys = ['sharedNotes', 'sharedAddresses'];
        console.log('Current days:', Object.keys(data.scheduleData).filter(key => !globalKeys.includes(key)));

        // IMPORTANT: Publish all entries for the new "today" (which was "tomorrow" before reset)
        // This ensures future entries are announced when they become current
        await publishDayEntries(data.scheduleData, todayKey);

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
        console.log('✅ Balance tracking ENABLED for 5 groups (Alexa, Elizabeth, Mihail, Kris, Talia)');
        console.log('✅ Automatic daily reset at 4:00 AM Shanghai time');
        console.log('✅ NO file storage fallback - Supabase ONLY!');
        console.log(`✅ GPT Chat ENABLED (model: ${GPT_MODEL}, memory: ${MAX_MEMORY_MESSAGES} messages)`);
    });
}

startServer().catch(err => {
    console.error('Failed to start server:', err);
    process.exit(1);
});