CREATE TABLE notices (
    id UUID PRIMARY KEY,
    notice_text TEXT NOT NULL,
    receipt_timestamp TIMESTAMPTZ NOT NULL,
    draft_timestamp TIMESTAMPTZ NOT NULL,
    is_temporary_test BOOLEAN NOT NULL DEFAULT FALSE
);
