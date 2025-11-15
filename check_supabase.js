const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_ANON_KEY;

async function checkSupabase() {
    console.log('Connecting to Supabase...');
    console.log('URL:', SUPABASE_URL);

    const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

    try {
        console.log('\n📊 Reading data from Supabase...\n');

        const { data, error } = await supabase
            .from('schedule_data')
            .select('*');

        if (error) {
            console.error('❌ Error:', error.message);
            return;
        }

        console.log('✅ Found', data.length, 'record(s) in schedule_data table');
        console.log('\n📋 Data:\n');

        data.forEach((record, index) => {
            console.log(`\n--- Record ${index + 1} ---`);
            console.log('data_key:', record.data_key);
            console.log('created_at:', record.created_at);
            console.log('updated_at:', record.updated_at);

            if (record.schedule_data) {
                const dates = Object.keys(record.schedule_data).filter(k => k !== 'sharedNotes');
                console.log('Dates in schedule:', dates);

                dates.forEach(date => {
                    const tables = record.schedule_data[date]?.tables || [];
                    console.log(`  ${date}: ${tables.length} table(s) - [${tables.join(', ')}]`);
                });

                if (record.schedule_data.sharedNotes) {
                    console.log('Shared notes:', record.schedule_data.sharedNotes.substring(0, 100));
                }
            }

            if (record.activity_log) {
                console.log('Activity log entries:', record.activity_log.length);
            }

            console.log('\n--- Full JSON (first 500 chars) ---');
            console.log(JSON.stringify(record, null, 2).substring(0, 500));
        });

    } catch (error) {
        console.error('❌ Failed:', error.message);
    }
}

checkSupabase();