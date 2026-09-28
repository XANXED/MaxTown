-- Detach historical ballots from individual memberships while retaining the
-- aggregate counts residents could already see. Previous voters may vote once
-- again after this migration because identity links are intentionally erased.
CREATE TABLE poll_legacy_totals (
  poll_id uuid NOT NULL,
  option_id uuid NOT NULL,
  votes bigint NOT NULL CHECK (votes > 0),
  PRIMARY KEY (poll_id, option_id),
  FOREIGN KEY (option_id, poll_id) REFERENCES poll_options(id, poll_id) ON DELETE CASCADE
);

INSERT INTO poll_legacy_totals (poll_id, option_id, votes)
SELECT poll_id, option_id, count(*)::bigint
FROM poll_votes
GROUP BY poll_id, option_id;

DROP TABLE poll_votes;

CREATE TABLE poll_ballots (
  poll_id uuid NOT NULL REFERENCES polls(id) ON DELETE CASCADE,
  option_id uuid NOT NULL,
  voter_nullifier bytea NOT NULL CHECK (octet_length(voter_nullifier) = 32),
  PRIMARY KEY (poll_id, voter_nullifier),
  FOREIGN KEY (option_id, poll_id) REFERENCES poll_options(id, poll_id) ON DELETE CASCADE
);

CREATE INDEX poll_ballots_aggregate ON poll_ballots (poll_id, option_id);
