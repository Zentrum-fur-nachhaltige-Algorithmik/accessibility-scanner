#!/usr/bin/env sh
# Fails when an em-dash or en-dash appears in a tracked source, config or doc file.
if git ls-files -z src frontend tests scripts README.md Dockerfile docker-compose.yml package.json .env.example \
  | xargs -0 grep -nP '[\x{2013}\x{2014}]' 2>/dev/null; then
  echo "dash characters found (use ',', ':', '.', or '-')"
  exit 1
fi
