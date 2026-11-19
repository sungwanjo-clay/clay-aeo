-- Run once in the Supabase SQL editor, after 001_portfolio.sql.
-- Holds only bcrypt hashes. The keys themselves were delivered separately and are not in this repo.
insert into portfolio.ingest_keys (key_name, key_hash, kinds) values
  ('clay-workflows', '$2a$10$zxw/eqDAfppt2xa.j/v4I.sglUndoXdU4y1NrRk0pLEseVVYBdoOa', '{firms,roster,snapshots,runs}'),
  ('dashboard-sync', '$2a$10$oWYdPhfITPwCYjjlDGUXfe/jWmOWCKRcx/SY5.jx9/hzL9N/9FriO', '{read}');
-- To revoke later:  update portfolio.ingest_keys set revoked_at = now() where key_name = 'clay-workflows';
