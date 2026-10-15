import {test} from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
test('database transaction prevents concurrent overselling and protects capacity',()=>{const result=spawnSync('python3',['-c',String.raw`
import sqlite3,tempfile,concurrent.futures,pathlib
with tempfile.TemporaryDirectory() as d:
 path=d+'/test.db'
 c=sqlite3.connect(path)
 for migration in sorted(pathlib.Path('migrations').glob('*.sql')):c.executescript(migration.read_text())
 c.execute("INSERT INTO events(id,title,start,end,deadline,price_cents,capacity,status,policy) VALUES('e','Test','2099-01-01','2099-01-02','2098-12-31',100,1,'published','Policy')")
 c.commit()
 def reserve(i):
  db=sqlite3.connect(path,timeout=10)
  try:
   db.execute("INSERT INTO orders(id,event_id,email,quantity,total_cents,status,source,expires_at,receipt_token) VALUES(?,'e','test@example.test',1,100,'held','online',1,?)",(str(i),'token'+str(i)))
   db.commit();return True
  except sqlite3.IntegrityError:
   db.rollback();return False
  finally:db.close()
 with concurrent.futures.ThreadPoolExecutor(max_workers=8) as pool: results=list(pool.map(reserve,range(8)))
 assert sum(results)==1,results
 try:c.execute("UPDATE events SET capacity=0 WHERE id='e'");raise AssertionError('capacity reduced')
 except sqlite3.IntegrityError:pass
 c.execute("UPDATE orders SET status='released'");c.commit()
 assert reserve(99)
 try:c.execute("UPDATE orders SET status='paid' WHERE id!='99'");raise AssertionError('reactivated released order')
 except sqlite3.IntegrityError:pass
 print('capacity invariants passed')
`],{encoding:'utf8'});assert.equal(result.status,0,result.stderr);});
