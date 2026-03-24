#!/bin/sh

set -eu

if [ -n "${TYPESENSE_SEARCH_API_KEY_FILE:-}" ]; then
  echo "Waiting for Typesense search key at ${TYPESENSE_SEARCH_API_KEY_FILE}"

  attempts=0
  while [ ! -s "${TYPESENSE_SEARCH_API_KEY_FILE}" ]; do
    attempts=$((attempts + 1))

    if [ "$attempts" -ge 120 ]; then
      echo "Timed out waiting for Typesense search key"
      exit 1
    fi

    sleep 1
  done

  TYPESENSE_SEARCH_API_KEY=$(tr -d '\n' < "${TYPESENSE_SEARCH_API_KEY_FILE}")
  export TYPESENSE_SEARCH_API_KEY
fi

pnpm --filter @openkeep/docs build
exec pnpm --filter @openkeep/docs serve --host 0.0.0.0 --port 3001
