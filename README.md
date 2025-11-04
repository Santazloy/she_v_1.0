# Shanghai Schedule Mini App

Мини-приложение для управления расписанием с интеграцией Telegram.

## Установка

1. Клонируйте репозиторий:
```bash
git clone <your-repo-url>
cd she_v_1.0
```

2. Установите зависимости:
```bash
npm install
```

3. Создайте файл `.env`:
```bash
cp .env.example .env
```

4. Запустите приложение:
```bash
npm start
```

Для разработки с автоперезагрузкой:
```bash
npm run dev
```

## Деплой на Render

1. Создайте аккаунт на [Render.com](https://render.com)
2. Подключите ваш GitHub репозиторий
3. Создайте новый Web Service
4. Настройки:
   - Build Command: `npm install`
   - Start Command: `npm start`
   - Environment: Node

## Настройка домена на GoDaddy

### Вариант 1: CNAME запись (рекомендуется)
1. Войдите в GoDaddy
2. Перейдите в управление DNS для домена escortwork.org
3. Добавьте/измените CNAME запись:
   - Type: CNAME
   - Name: @ (или subdomain если нужен поддомен)
   - Value: ваш-сервис.onrender.com
   - TTL: 600 seconds

### Вариант 2: A запись
1. В Render получите IP адрес сервиса
2. В GoDaddy добавьте A запись:
   - Type: A
   - Name: @
   - Value: IP адрес от Render
   - TTL: 600 seconds

## Функции

- Управление расписанием по таблицам (111, 222, 333, 555, 666, 888)
- Временные слоты с 12:00 до 02:00 (по 1 часу)
- Автоматическое обновление данных каждые 2 секунды
- Отображение времени Шанхая
- Журнал изменений
- Интеграция с Telegram ботом
- Автоматическая архивация в 4:00 по времени Шанхая
- Адаптивный дизайн для мобильных устройств

## Пользователи

- kris
- misha
- katya
- wang
- lion

Пароль для всех: 12344321

## Технологии

- Frontend: HTML, CSS, JavaScript
- Backend: Node.js, Express
- Bot: node-telegram-bot-api
- Screenshots: Puppeteer