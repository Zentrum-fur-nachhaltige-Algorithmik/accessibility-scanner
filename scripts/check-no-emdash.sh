#!/usr/bin/env sh
# Fails when an em-dash or en-dash appears in source, config or docs.
if grep -rnP '[\x{2013}\x{2014}]' src frontend tests scripts README.md Dockerfile docker-compose.yml package.json .env.example 2>/dev/null; then
  echo "dash characters found (use ',', ':', '.', or '-')"
  exit 1
fi
