# UAT report

_Generated 2026-11-01T09:06:45.520Z by `npm run uat`._

## autotitle

Source: `/Users/cristos/Documents/code/bb-plugin-focus-board/tests/manual/uat-autotitle.yaml` · theme dark

| Step | Result | Detail |
| --- | --- | --- |
| A failed ✨ opens the fallback modal naming the reason, with blocked rows blocked by name | pass | ✓ text visible: "Auto-rename failed"; ✓ text visible: "Title task is not set to a plugin AI service"; ✓ text visible: "Simulated other service"; ✓ text visible: "Simulated unbridged service"; ✓ text visible: "does not expose the complete bridge focus-board calls"; ✓ text visible: "The thread's active model" |
| Picking the thread's active model sends useThreadModel and commits the rename on the closed editor | pass | ✓ thread_autotitle last called with {"useThreadModel":true}; ✓ text visible: "Simulated thread-model title" |
| A bridged alternative routes the pluginId/serviceId override the row names | pass | ✓ thread_autotitle last called with {"pluginId":"sim-alternative","serviceId":"other"}; ✓ text visible: "Simulated other title" |
| A failing bridged pick reopens the modal naming the bridge error it ran into | pass | ✓ thread_autotitle last called with {"pluginId":"sim-alternative","serviceId":"other"}; ✓ text visible: "Auto-rename failed"; ✓ text visible: "HTTP 400: rpc input validation failed" |
| After a failed bridged pick, the thread-model path still probes, commits, and closes the modal | pass | ✓ thread_autotitle last called with {"useThreadModel":true}; ✓ text visible: "Simulated thread-model title" |
| A typed manual title commits from the modal without any further generation attempt | pass | ✓ thread_autotitle last called with {"threadId":"thr_uat_queue"}; ✓ text visible: "Typed from the fallback modal" |
