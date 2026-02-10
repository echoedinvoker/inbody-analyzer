#!/bin/bash
# Backup InBody Analyzer SQLite DB from Fly.io
# Usage: bash scripts/backup.sh

set -e
FLYCTL="/home/matt/.fly/bin/flyctl"
BACKUP_DIR="./backups"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
BACKUP_FILE="${BACKUP_DIR}/inbody_${TIMESTAMP}.db"

mkdir -p "$BACKUP_DIR"

echo "Connecting to Fly.io and downloading DB..."
$FLYCTL ssh console -a inbody-analyzer -C "cat /data/inbody.db" > "$BACKUP_FILE"

echo "Backup saved to: $BACKUP_FILE"
ls -lh "$BACKUP_FILE"
