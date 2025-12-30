# Shanghai Schedule v2.0.0

Веб-приложение для управления расписанием столов с интеграцией Telegram и Supabase.

## Особенности

- **Адаптивный дизайн** - glassmorphism UI, работает на ПК и мобильных
- **7 пользователей** - kris, misha, katya, wang, lion, alexa, bj
- **Расписание на 3 дня** - с автоматическим сдвигом в 4:00 AM Shanghai
- **15 временных слотов** - с 12:00 до 02:00
- **10 таблиц** - 000, 111, 222, 333, 555, 666, 888, 999, 北京1, 北京2
- **Telegram уведомления** - в 11 групп при изменениях
- **Отслеживание баланса** - для 5 групп (Alexa, Elizabeth, Mihail, Kris, Talia)
- **Автоматические отчёты** - ежедневные, еженедельные, ежемесячные
- **Supabase** - облачная PostgreSQL база данных
- **Авто-синхронизация** - каждые 2 секунды

## Быстрый старт

```bash
# Клонировать
git clone https://github.com/Santazloy/she_v_1.0.git
cd she_v_1.0

# Установить зависимости
npm install

# Создать .env (см. .env.example)
cp .env.example .env
# Заполнить TELEGRAM_BOT_TOKEN, SUPABASE_URL, SUPABASE_ANON_KEY

# Запустить
npm start
```

Открыть: http://localhost:3000

## Логины

| Пользователь | Пароль |
|--------------|--------|
| kris | 12344321 |
| misha | 12344321 |
| katya | 12344321 |
| wang | 12344321 |
| lion | 12344321 |
| alexa | 090909 |
| bj | 121212 |

## Архитектура

```
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│   Frontend      │────▶│   Backend       │────▶│   Supabase      │
│   index.html    │     │   server.js     │     │   PostgreSQL    │
│   (Vanilla JS)  │◀────│   (Express)     │◀────│                 │
└─────────────────┘     └────────┬────────┘     └─────────────────┘
                                 │
                                 ▼
                        ┌─────────────────┐
                        │   Telegram Bot  │
                        │   (11 групп)    │
                        └─────────────────┘
```

## Структура файлов

```
she_v_1.0/
├── index.html          # Frontend (HTML + CSS + JS)
├── server.js           # Backend (Express + Telegram + Cron)
├── package.json        # Зависимости
├── .env                # Переменные окружения (не в git)
├── .env.example        # Шаблон переменных
├── supabase_setup.sql  # SQL схема для Supabase
├── render.yaml         # Конфигурация Render
├── render-build.sh     # Скрипт сборки
├── README.md           # Этот файл
└── SETUP_GUIDE.md      # Полное руководство
```

## API

| Метод | Endpoint | Описание |
|-------|----------|----------|
| GET | /api/health | Статус сервера |
| GET | /api/schedule | Получить расписание |
| POST | /api/schedule | Сохранить расписание |
| POST | /api/activity | Логирование активности |

## Переменные окружения

```env
PORT=3000
NODE_ENV=production
TELEGRAM_BOT_TOKEN=your_bot_token
SUPABASE_URL=your_supabase_url
SUPABASE_ANON_KEY=your_supabase_key
```

## Автоматизация (4:00 AM Shanghai)

- **Ежедневно**: архивирование расписания, сдвиг дат
- **Ежедневно**: отчёт по балансу групп
- **Воскресенье**: недельный отчёт
- **1-е число**: месячный отчёт

## Telegram группы

Уведомления отправляются в 11 групп:
- 111, 222, 333, 555, 666, 888, 999
- 北京1, 北京2
- ОБЩАЯ, 000

## Деплой на Render

1. Подключить GitHub репозиторий
2. Build Command: `./render-build.sh`
3. Start Command: `npm start`
4. Добавить переменные окружения

Подробнее: [SETUP_GUIDE.md](SETUP_GUIDE.md)

## Технологии

- **Frontend**: Vanilla JavaScript, CSS3 (glassmorphism)
- **Backend**: Node.js, Express
- **Database**: Supabase (PostgreSQL)
- **Bot**: node-telegram-bot-api
- **Cron**: node-cron
- **Deploy**: Render.com

## Live

- **URL**: https://escortwork.org
- **GitHub**: https://github.com/Santazloy/she_v_1.0