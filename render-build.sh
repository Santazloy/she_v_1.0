#!/usr/bin/env bash
set -e

echo "==> Installing dependencies..."
npm install

echo "==> Build complete!"
echo "Note: Screenshots are disabled on Free tier (insufficient RAM)"
echo "To enable screenshots, upgrade to Starter plan ($7/month)"
