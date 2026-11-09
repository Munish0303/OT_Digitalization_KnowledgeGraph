-- Staging + time-series store in the DMZ (ADR-0001).
-- TimescaleDB if the image provides it; plain PostgreSQL works as a fallback.
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_available_extensions WHERE name = 'timescaledb') THEN
        CREATE EXTENSION IF NOT EXISTS timescaledb;
    END IF;
END $$;

CREATE SCHEMA staging;
CREATE SCHEMA ops;

-- Raw Process Values. They stay here; the knowledge graph only references them by tag id.
CREATE TABLE staging.process_value (
    time          timestamptz      NOT NULL,
    tag_id        text             NOT NULL,
    value         double precision,
    quality_good  boolean          NOT NULL DEFAULT true,
    PRIMARY KEY (tag_id, time)
);
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'timescaledb') THEN
        PERFORM create_hypertable('staging.process_value', by_range('time', INTERVAL '7 days'));
    ELSE
        CREATE INDEX ON staging.process_value (time);
    END IF;
END $$;

-- Batch, phase, alarm and material events. The bigserial id is the sync watermark.
CREATE TABLE staging.event (
    id           bigserial    PRIMARY KEY,
    event_id     text         NOT NULL UNIQUE,
    time         timestamptz  NOT NULL,
    topic        text         NOT NULL,
    event_type   text         NOT NULL,
    payload      jsonb        NOT NULL,
    ingested_at  timestamptz  NOT NULL DEFAULT now()
);

-- Topics that do not match the Engineering Master List (ADR-0002).
CREATE TABLE ops.unknown_topic (
    topic       text         PRIMARY KEY,
    first_seen  timestamptz  NOT NULL,
    last_seen   timestamptz  NOT NULL,
    msg_count   bigint       NOT NULL DEFAULT 1
);

CREATE TABLE ops.sync_watermark (
    source    text         PRIMARY KEY,
    last_id   bigint       NOT NULL,
    last_run  timestamptz  NOT NULL
);
