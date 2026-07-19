-- Row-level Google Sheet retrieval and stale-row cleanup.
-- Apply after 0005_slack_dm_deliveries.sql.

create index knowledge_records_google_sheet_row_key_idx
on public.knowledge_records (organisation_id, (metadata ->> 'row_key_normalized'))
where source = 'Google Sheets' and metadata ->> 'record_kind' = 'sheet_row';

create index knowledge_records_google_sheet_file_generation_idx
on public.knowledge_records (connection_id, (metadata ->> 'google_file_id'), (metadata ->> 'google_sync_generation'))
where source = 'Google Sheets' and metadata ->> 'record_kind' = 'sheet_row';
