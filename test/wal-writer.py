# Test helper for wal.test.js: writes a WAL-mode database and, while its
# connection is still open (so nothing is checkpointed), copies the main
# file and the -wal file aside, as a browser would read them.
import shutil, sqlite3, sys
out = sys.argv[1]
c = sqlite3.connect(f'{out}/live.db', isolation_level=None)
c.execute('PRAGMA journal_mode=WAL'); c.execute('PRAGMA wal_autocheckpoint=0')
c.execute('CREATE TABLE t(x)')
c.execute('INSERT INTO t VALUES (1)')
c.execute('PRAGMA wal_checkpoint(TRUNCATE)')           # 1 row in the main file
for i in range(500): c.execute('INSERT INTO t VALUES (?)', ('x' * 200,))  # 500 rows only in the WAL
c.execute('BEGIN'); c.execute('INSERT INTO t VALUES (999)')
c.execute('INSERT INTO t SELECT x FROM t LIMIT 300')  # uncommitted, spills frames to the WAL
shutil.copy(f'{out}/live.db', f'{out}/snap.db'); shutil.copy(f'{out}/live.db-wal', f'{out}/snap.db-wal')
c.execute('COMMIT')
shutil.copy(f'{out}/live.db-wal', f'{out}/after.db-wal')
