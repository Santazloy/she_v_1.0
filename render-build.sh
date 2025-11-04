#!/usr/bin/env bash
set -e

echo "Installing dependencies..."
npm install

echo "Creating cache directory..."
mkdir -p $PWD/.cache/puppeteer

echo "Installing Chrome for Puppeteer..."
export PUPPETEER_CACHE_DIR=$PWD/.cache/puppeteer
npx puppeteer browsers install chrome

echo "Verifying Chrome installation..."
ls -la $PWD/.cache/puppeteer/chrome/ || echo "Chrome directory not found"

echo "Build complete!"
