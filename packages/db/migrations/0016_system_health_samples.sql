CREATE TABLE system_health_samples (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  captured_at timestamptz NOT NULL DEFAULT now(),
  postgres_latency_ms integer,
  redis_latency_ms integer,
  queue_waiting integer NOT NULL DEFAULT 0,
  queue_active integer NOT NULL DEFAULT 0,
  queue_failed integer NOT NULL DEFAULT 0
);

CREATE INDEX system_health_samples_captured_at_idx ON system_health_samples(captured_at DESC);
