import json
import os
import sqlite3
import sys
import time


def main():
    request = json.load(sys.stdin)
    database = request['database']
    if not os.path.isfile(database):
        raise ValueError('CC Switch database not found')
    connection = sqlite3.connect(database, timeout=5)
    connection.row_factory = sqlite3.Row
    if request['action'] == 'list':
        result = [dict(row) for row in connection.execute(
            "SELECT * FROM providers WHERE app_type='codex' ORDER BY sort_index,created_at")]
    elif request['action'] == 'save':
        connection.execute('BEGIN IMMEDIATE')
        row = connection.execute("SELECT * FROM providers WHERE app_type='codex' AND id=?",
                                 (request['id'],)).fetchone()
        if (row['settings_config'] if row else None) != request.get('expectedConfig'):
            raise ValueError('Configuration changed; refresh before saving')
        if row and row['is_current']:
            raise ValueError('Current CC Switch provider cannot be edited here')
        backup_dir = os.path.join(os.path.dirname(database), 'backups')
        os.makedirs(backup_dir, exist_ok=True)
        backup_path = os.path.join(backup_dir, 'negus-' + str(time.time_ns()) + '.db')
        # A second read connection backs up the committed snapshot, including WAL.
        with sqlite3.connect(database) as source, sqlite3.connect(backup_path) as target:
            source.backup(target)
        if row:
            connection.execute("UPDATE providers SET name=?,settings_config=?,cost_multiplier=? WHERE id=? AND app_type='codex'",
                               (request['name'], request['config'], request['multiplier'], request['id']))
        else:
            connection.execute("INSERT INTO providers(id,app_type,name,settings_config,meta,is_current,cost_multiplier,created_at) VALUES(?,'codex',?,?,'{}',0,?,?)",
                               (request['id'], request['name'], request['config'], request['multiplier'], int(time.time()*1000)))
        connection.commit()
        result = {'saved': True}
    elif request['action'] == 'delete':
        connection.execute('BEGIN IMMEDIATE')
        row = connection.execute("SELECT * FROM providers WHERE app_type='codex' AND id=?",
                                 (request['id'],)).fetchone()
        if not row:
            raise ValueError('Channel not found')
        if row['is_current']:
            raise ValueError('Current CC Switch provider cannot be deleted here')
        backup_dir = os.path.join(os.path.dirname(database), 'backups')
        os.makedirs(backup_dir, exist_ok=True)
        backup_path = os.path.join(backup_dir, 'negus-' + str(time.time_ns()) + '.db')
        with sqlite3.connect(database) as source, sqlite3.connect(backup_path) as target:
            source.backup(target)
        connection.execute("DELETE FROM providers WHERE app_type='codex' AND id=?", (request['id'],))
        connection.commit()
        result = {'deleted': True}
    else:
        raise ValueError('Invalid action')
    print(json.dumps(result, ensure_ascii=True))


try:
    main()
except Exception:
    print('CC Switch configuration operation failed; refresh and retry.', file=sys.stderr)
    sys.exit(1)
