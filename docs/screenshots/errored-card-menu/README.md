# Errored card menu: Retry and Ignore error (issue #405)

Harness frames from `tests/manual/uat-errored-card-menu.yaml` (real Chrome, the plugin's mocked sidebar), captured by the UAT runner's per-step shots. `docs/uat/shots/` is gitignored, so the frames a doc references are copied here.

| File | Step | Shows |
|---|---|---|
| `errored-card-menu-open.png` | `error-card-menu-offers-retry-and-ignore-error` | The errored card's context menu open on an error card: Retry beside Ignore error, both between the state toggles (Mark Read, Mark Done). |
| `retry-refusal-banner.png` | `retry-refusal-surfaces-the-reason` | A refused retry: the board's amber notice banner reports bb's reason verbatim ("Retrying the thread failed: thread is stopping"). |
| `ignore-error-settles.png` | `ignore-error-writes-the-ack-and-settles-the-card` | After Ignore error the byte-identical acknowledgment write lands and the card has left Needs you for Idle · Recent. |
