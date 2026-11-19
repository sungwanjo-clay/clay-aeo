-- 005: a weekly snapshot freezes membership as of the END of its week.
--
-- snapshot_date is the week's Monday, and Clay's firm runs happen during that week. 002 froze only evidence first
-- observed on or before the Monday itself (first_observed_at < d + 1), so a week published on Thursday froze
-- nothing found Monday–Thursday. Membership now includes evidence first observed before the following Monday
-- (first_observed_at < d + 7). Reopening an old week still reproduces that week's roster, not today's.
--
-- After applying: reopen and publish the week again (snapshot_open {snapshot_date, reopen: true}, then
-- snapshot_close {snapshot_date}). The "Portfolio Discovery: publish this week" workflow does both.

create or replace function portfolio.ingest_snapshot_close(rows jsonb) returns jsonb language plpgsql as $$
declare r jsonb; d date; st text; n int; out jsonb := '[]';
begin
  for r in select * from jsonb_array_elements(rows) loop
    d := (r->>'snapshot_date')::date;
    st := portfolio.snapshot_status(d);
    if st is null then
      out := out || jsonb_build_object('snapshot_date', d, 'result', 'not_open');
    elsif st = 'complete' then
      select count(*) into n from portfolio.snapshot_membership where snapshot_date = d;
      out := out || jsonb_build_object('snapshot_date', d, 'result', 'already_complete', 'members', n);
    else
      insert into portfolio.snapshot_membership (snapshot_date, relationship_id, company_id, firm_id, qualifying_sources, shared_by_partner, partnership_cut)
      select d, cf.relationship_id, cf.company_id, cf.firm_id,
             array_agg(distinct e.source order by e.source), bool_or(e.source = 'partner_list'), portfolio.partnership_cut(f)
      from portfolio.company_firms cf
      join portfolio.firms f using (firm_id)
      join portfolio.relationship_evidence e using (relationship_id)
      join portfolio.sources s on s.source = e.source and s.counts_toward_denominator
      where cf.verification_status = 'verified' and e.first_observed_at < d + 7
      group by cf.relationship_id, cf.company_id, cf.firm_id, f.firm_id;
      get diagnostics n = row_count;
      update portfolio.snapshots set status = 'complete', completed_at = now() where snapshot_date = d;
      out := out || jsonb_build_object('snapshot_date', d, 'result', 'completed', 'members', n);
    end if;
  end loop;
  return jsonb_build_object('snapshots', out);
end $$;

revoke execute on function portfolio.ingest_snapshot_close(jsonb) from public;
