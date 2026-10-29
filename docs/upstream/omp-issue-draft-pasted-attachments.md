# OMP issue draft: ACP attachments arrive as a bare filename

**Target repository.** [`can1357/oh-my-pi`](https://github.com/can1357/oh-my-pi), MIT, default branch `main`, 4,262 open issues and pull requests on 29 Oct 2026. This is the source project, not a release mirror: `gh repo view` reports `isMirror: false`, and the code concerned sits in the public tree at `packages/coding-agent/src/modes/acp/`. The installed `/opt/homebrew/bin/omp` resolves to `/opt/homebrew/Cellar/omp/18.13.2/bin/omp`, built from the tap `can1357/tap`, whose formula (`/opt/homebrew/Library/Taps/can1357/homebrew-tap/Formula/omp.rb`, `version "18.13.2"`) downloads a standalone binary and names `github.com/can1357/oh-my-pi/releases/download/v18.13.2/omp-darwin-arm64` as its mirror. Same project, same tag.

**Policy finding on agent-submitted issues.** No rule against them, and no rule requiring disclosure, on the issue side. `README.md` says "Issues and pull requests are open to everyone." The `AI-assisted contributions` section of `CONTRIBUTING.md` governs pull requests only: "AI agents are welcome as tools, not as unattended contributors", followed by four review requirements and "Every pull request body **MUST include at least one sentence written by you**". Nothing in it mentions issues. The three issue forms (`.github/ISSUE_TEMPLATE/bug_report.yml`, `feature_request.yml`, `question.yml`) carry no authorship field, and `config.yml` sets `blank_issues_enabled: true`. The only issue-side instruction is the duplicate-work warning under "Do not open an issue for work you are about to submit": "robomp treats actionable issues as work to pick up and may start the same fix in parallel." Their own `AGENTS.md` tells agents working in that repo to get a person's confirmation before creating an issue, which is a rule for their agents, not a bar on outsiders. Read strictly, the answer is silence on agent-filed issues rather than permission, on top of a general "open to everyone".

**Disclosure.** OMP asks for none. The `> AGENT GENERATED CONTENT` line at the end is there because this repo's `CONTRIBUTING.md` requires it on agent-written text, and the person who posts the issue can keep it or drop it without breaking any OMP rule.

**Before posting.** `robomp` acknowledges, reproduces, and often opens the fix itself within a day, so filing is not inert. If a fix is already planned on this end, say so in the body instead of filing, per the section quoted above.

<!-- issue-body:start -->

## Description

An ACP client attaches a file by sending a `resource_link` prompt block. The block carries the file's `uri` and `mimeType`; `name` is the label the client shows in its composer. OMP 18.13.2 keeps only the label.

`#convertPromptBlocks` in `packages/coding-agent/src/modes/acp/acp-agent.ts` pushes `block.title ?? block.name ?? block.uri` into the prompt text and never looks at the URI again. A file staged outside the session cwd, which is where clients keep attachments, reaches the model as a bare filename with no path and no content. Nothing errors: the model reads the name, tries the cwd, and answers from whatever it can guess.

## Environment

| | |
|---|---|
| omp | 18.13.2, standalone Homebrew binary (`can1357/tap`), `/opt/homebrew/Cellar/omp/18.13.2/bin/omp` |
| OS | macOS 26.7.1, arm64 |
| Transport | ACP over stdio, direct client, no editor |
| Model | `cove/text:standard` behind a custom OpenAI-compatible endpoint. Model selection is downstream of the loss: any model receives the same text. |
| Bun | not involved. The tap artifact is the compiled binary. Host Bun is 1.4.4. |
| First seen in | bb 0.47.1, whose ACP client sends `resource_link{uri: "file:///…/Attachments/Pasted-text-3.txt", name: "Pasted text.txt"}` for a 29 KB paste |

## Steps to Reproduce

The script starts `omp acp`, opens one session in an empty directory, and sends the same file twice: once as a `resource_link`, once as a `resource` block with inline text. The file sits outside the session cwd, the way a client stages an attachment.

```python
import glob, json, os, subprocess, tempfile, time

NOTE = "Pasted-text-1793249999123-k3x9qd.txt"
BODY = "ZQ-REPRO-9911 is the token. Quote it back verbatim.\n" + "filler to reach paste size\n" * 200

src = tempfile.mkdtemp(prefix="omp-attach-src-")  # outside the session cwd
path = os.path.join(src, NOTE)
open(path, "w").write(BODY)
cwd = tempfile.mkdtemp(prefix="omp-attach-cwd-")

p = subprocess.Popen(["omp", "acp"], stdin=subprocess.PIPE, stdout=subprocess.PIPE, text=True, bufsize=1)
n = 0

def send(method, params):
    global n
    n += 1
    p.stdin.write(json.dumps({"jsonrpc": "2.0", "id": n, "method": method, "params": params}) + "\n")
    p.stdin.flush()
    while True:
        m = json.loads(p.stdout.readline())
        if m.get("id") == n:
            return m
        if "method" in m and "id" in m:
            p.stdin.write(json.dumps({"jsonrpc": "2.0", "id": m["id"], "error": {"code": -32601, "message": "unsupported"}}) + "\n")
            p.stdin.flush()

def model_saw(session_id):
    time.sleep(2)
    hits = glob.glob(os.path.expanduser(f"~/.omp/agent/sessions/*/*{session_id}.jsonl"))
    users = []
    for line in open(hits[0]):
        if '"role":"user"' in line:
            o = json.loads(line)
            users.append("".join(c.get("text", "") for c in o["message"]["content"] if c.get("type") == "text"))
    return users[-1]

send("initialize", {"protocolVersion": 1, "clientCapabilities": {"fs": {"readTextFile": True, "writeTextFile": True}, "terminal": True}})
sid = send("session/new", {"cwd": cwd, "mcpServers": []})["result"]["sessionId"]

for mode in ("link", "resource"):
    block = ({"type": "resource_link", "uri": f"file://{path}", "name": NOTE, "mimeType": "text/plain"}
             if mode == "link" else
             {"type": "resource", "resource": {"uri": f"file://{path}", "mimeType": "text/plain", "text": BODY}})
    send("session/prompt", {"sessionId": sid, "prompt": [
        {"type": "text", "text": "Reply with the exact token from the attached file, and nothing else."}, block]})
    print(f"[{mode}] model-facing text: {model_saw(sid)[:150]!r}")

p.stdin.close()
```

Output on 18.13.2:

```text
[link] model-facing text: 'Reply with the exact token from the attached file, and nothing else.\n\nPasted-text-1793249999123-k3x9qd.txt'
[resource] model-facing text: 'Reply with the exact token from the attached file, and nothing else.\n\nZQ-REPRO-9911 is the token. Quote it back verbatim.\nfiller to reach paste size\nf'
```

The `resource` arm carries the body. The `resource_link` arm carries the filename and drops the absolute path that the block itself contains.

## Expected Behavior

A `resource_link` that points at a readable text file delivers something the model can act on: the URI, the file body, or both. The block already carries `uri` and `mimeType`, and OMP advertises `promptCapabilities.embeddedContext: true`, so a client sending either shape is within the protocol.

## Actual Behavior

The model receives the display name as plain text. From the thread that surfaced this, `~/.omp/agent/sessions/-Documents-projects-bv-brain2/2026-10-26T15-03-21-964Z_01a178bc-ce6c-76b4-9cad-17bd3e88e12a.jsonl`, line 4724:

```json
{"role":"user","content":[{"type":"text","text":"now give me a short update to post in this email thread:\n\nPasted text.txt"}],"attribution":"user"}
```

The turn spent a glob over `/Users/cristos/**` that timed out, then `ls` over `/tmp`, `~/Desktop`, `~/Downloads`, and `~/Documents`. It found a copy the user had saved by hand. A second paste with no instruction text arrived as the single string `11497-email-thread.txt` and recovered the same way, by luck. Under a common display name the search has nothing unique to look for, and the model answers from the name alone.

In the script above the `link` turn did finish with the right token, because the model searched the disk and this filename is unique. That is the point: the content is missing, and whether a turn survives depends on how findable the filename happens to be.

## Where the text is dropped

`packages/coding-agent/src/modes/acp/acp-agent.ts`, in `#convertPromptBlocks` (line 2104 on the `v18.13.2` tag, 2106 on `main`):

```ts
case "resource_link":
    textParts.push(block.title ?? block.name ?? block.uri);
    break;
```

The neighboring `resource` arm shows the intended treatment for text: `if ("text" in block.resource && typeof block.resource.text === "string") textParts.push(block.resource.text);`.

The flattening is also asserted today: `packages/coding-agent/test/acp-agent.test.ts:1343` (`steers a running turn through _session/steering`) sends `{ type: "resource_link", uri: "file:///plan.md", name: "plan" }` and expects the prompt text `"use the existing parser\n\nplan"`. A fix moves that expectation to the URI or the body.

## Why this is not a malformed path from the client

`resource_link` carries the absolute path in `uri`; `name` is display text that clients reuse verbatim. On the reporting host, all 31 `localFile` prompt inputs across 22 threads and four ACP providers carry a bare display name, each staged to an absolute path outside the workspace, so the URI is the only place the path exists. The same block through opencode on the same host arrives as `"Attached file: clean-note-1793231297248-2ph5xr.txt"` followed by the file body inline, and that turn answers without a tool call.

## What a fix looks like from the outside

At minimum, keep the URI in the prompt text so the model can open the file. Better, treat a text `resource_link` the way the `resource` text arm is treated and inline the body. Either change ends the guessing; the `resource` block above is already the working shape.

## Related issues

None found. Searched the issue tracker for `resource_link` (0 hits), `attachment` and `ACP` in titles, `pasted` in titles, and `bare filename`. The closest reports are about pasted images and the TUI composer (`#10576`, `#9931`, `#13605`), which are local input paths rather than ACP prompt blocks. ACP reports such as `#12434` and `#11644` cover turn lifecycle, not prompt content.

> AGENT GENERATED CONTENT

<!-- issue-body:end -->
