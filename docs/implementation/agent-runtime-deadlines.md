# Agent Runtime Delivery Deadlines

RabbitMQ delivery deadlines and Agent Server execution deadlines share one budget.
Time waiting for an executor, claiming a scan, creating a thread, and scheduling a
run counts against that budget; starting another nested agent does not reset it.

## Broker Settlement

`LCSP_AGENT_RUNTIME_BROKER_ACK_TIMEOUT_SECONDS` must match the broker's configured
consumer acknowledgement timeout. It defaults to 1800 seconds. This variable
describes the broker configuration; it does not modify RabbitMQ.

`LCSP_AGENT_RUNTIME_SETTLEMENT_MARGIN_SECONDS` reserves time for terminal callbacks
and delivery settlement. It defaults to 120 seconds and must be smaller than the
broker ACK timeout. The effective execution deadline is the smaller of the
requested boundary timeout and the broker ACK timeout minus this margin. With
defaults, a scan has a 1680-second execution deadline, before the 1800-second ACK
timeout. Existing short test-only boundary timeout overrides are preserved.

Longer execution requires increasing the broker timeout and matching runtime
configuration together. Do not disable terminal failure propagation or acknowledge
unfinished work as successful. Already-terminal scan redeliveries are acknowledged
without repeating terminal callbacks.

## Cooperative Cancellation And Usage Telemetry

The trusted run context carries an absolute `system_deadline_at`. A thread-local
cancellation signal is shared with nested agent calls, including boundaries running
through `asyncio.to_thread`. Deadline expiry and async cancellation both stop new
model calls. An already-running synchronous provider request may finish; its usage
is still recorded or durably queued before stopping further work.

Model usage is provider-reported token telemetry only: it is recorded or durably
queued for retry, never priced, and never debits a wallet or gates the run.

Restart both the broker consumer and Agent Server to apply these Python changes.
Existing failed scan jobs remain failed; recovery uses the canonical scan rerun API,
not direct broker publishing.
