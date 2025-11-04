#!/usr/bin/env bash
# Install dependencies
npm install

# Install Chrome for Puppeteer with timeout
export PUPPETEER_CACHE_DIR=$PWD/.cache/puppeteer
timeout 300 npx puppeteer browsers install chrome || echo "Chrome installation completed or timed out"
