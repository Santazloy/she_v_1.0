#!/usr/bin/env bash
set -e

echo "==> Installing dependencies..."
npm install --loglevel=verbose

echo "==> Installing Chrome for Puppeteer..."
export PUPPETEER_CACHE_DIR=$PWD/.cache/puppeteer
npx puppeteer browsers install chrome --verbose

echo "==> Build complete!"
