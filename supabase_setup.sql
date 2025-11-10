-- SQL скрипт для создания таблицы в Supabase
-- Выполните этот скрипт в Supabase SQL Editor

-- Создаем таблицу для хранения данных расписания
CREATE TABLE IF NOT EXISTS schedule_data (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    data_key TEXT UNIQUE NOT NULL DEFAULT 'main',
    schedule_data JSONB NOT NULL DEFAULT '{}'::jsonb,
    activity_log JSONB NOT NULL DEFAULT '[]'::jsonb,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Создаем индекс для быстрого поиска
CREATE INDEX IF NOT EXISTS idx_schedule_data_key ON schedule_data(data_key);

-- Вставляем начальную запись (если её нет)
INSERT INTO schedule_data (data_key, schedule_data, activity_log)
VALUES ('main', '{}'::jsonb, '[]'::jsonb)
ON CONFLICT (data_key) DO NOTHING;

-- Создаем функцию для автоматического обновления updated_at
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Создаем триггер для автоматического обновления updated_at
DROP TRIGGER IF EXISTS update_schedule_data_updated_at ON schedule_data;
CREATE TRIGGER update_schedule_data_updated_at
    BEFORE UPDATE ON schedule_data
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- Включаем Row Level Security (RLS)
ALTER TABLE schedule_data ENABLE ROW LEVEL SECURITY;

-- Создаем политику: разрешаем всем читать и писать (для упрощения)
-- В production лучше настроить более строгие правила
DROP POLICY IF EXISTS "Allow public read access" ON schedule_data;
CREATE POLICY "Allow public read access"
    ON schedule_data FOR SELECT
    USING (true);

DROP POLICY IF EXISTS "Allow public write access" ON schedule_data;
CREATE POLICY "Allow public write access"
    ON schedule_data FOR ALL
    USING (true)
    WITH CHECK (true);

-- Проверяем создание таблицы
SELECT * FROM schedule_data;