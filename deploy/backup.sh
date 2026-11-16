#!/usr/bin/env sh
# Daily backup of the public demo (see docs/DEPLOY.md, "Database"). Run from cron on the backend machine:
#   15 3 * * * /opt/aab/deploy/backup.sh >> /var/log/aab-backup.log 2>&1
# Keeps 7 days locally. Copy BACKUP_DIR off the machine (another host or object storage) for real recovery.
# Restore: docker compose -f deploy/docker-compose.demo.yml exec -T db pg_restore -U aab -d aab_demo --clean < <file>.dump
#          and extract the storage archive back into DEMO_STORAGE_DIR.
set -eu
REPO=${REPO:-/opt/aab}
BACKUP_DIR=${BACKUP_DIR:-/var/backups/aab}
STORAGE=${DEMO_STORAGE_DIR:-$REPO/apps/api/data-demo}
STAMP=$(date -u +%Y%m%d-%H%M%S)
mkdir -p "$BACKUP_DIR"
docker compose -f "$REPO/deploy/docker-compose.demo.yml" exec -T db pg_dump -U aab -Fc aab_demo > "$BACKUP_DIR/aab_demo-$STAMP.dump"
tar -czf "$BACKUP_DIR/storage-$STAMP.tar.gz" -C "$(dirname "$STORAGE")" "$(basename "$STORAGE")"
find "$BACKUP_DIR" -name 'aab_demo-*.dump' -mtime +7 -delete
find "$BACKUP_DIR" -name 'storage-*.tar.gz' -mtime +7 -delete
echo "backup $STAMP ok"
