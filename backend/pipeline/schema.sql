
CREATE TABLE IF NOT EXISTS `image_qc.qc_event_log` (
  event_id STRING NOT NULL,
  event_ts TIMESTAMP NOT NULL,
  event_type STRING,
  actor STRING,
  product_variant_id STRING,
  image_index INT64,
  old_status STRING,
  new_status STRING,
  issue_key STRING,
  old_issue_value BOOL,
  new_issue_value BOOL,
  issues_snapshot JSON,
  source STRING
)
PARTITION BY DATE(event_ts)
OPTIONS(
  description="Audit log of all QC actions (Status changes & Issue toggles)"
);
