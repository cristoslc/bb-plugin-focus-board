# Bug report: pasted attachments reach OMP models as a bare filename

Upstream-ready report for bb and OMP. Filed here as a findings document because the defect is not in Focus Board. Nothing was filed in an external tracker; that call is the operator's.

## Verdict in one paragraph

A paste over 5,000 characters becomes a file attachment in bb's composer. bb stages that file into the thread's storage and sends it to the ACP agent as a `resource_link` block that names the staged absolute path. The OMP agent (`omp` 18.13.2) flattens every `resource_link` to `title ?? name ?? uri` as plain text, so the model receives a bare filename with no path and no content. Every other ACP client on this host dereferences the same block and carries the content. The Focus Board pane is not involved at any point.

## 1. Related issues or pull requests

None known. This is the first report from this investigation.

## 2. Environment

| Item | Value |
|---|---|
| bb | 0.47.1 (`bb --version`) |
| provider-acp plugin | 0.1.0, built with bb 0.47.1, SDK 0.6.79 (artifact digest `b902e24c…`) |
| OMP | 18.13.2, `/opt/homebrew/bin/omp` → `/opt/homebrew/Cellar/omp/18.13.2/bin/omp`, tap `can1357/tap` |
| Focus Board | 1.7.2-dev (not implicated) |
| OS | macOS, arm64 |
| Affected thread | `thr_6d38n33qmm`, project `proj_9da9h742i7`, provider `acp-omp`, workspace `/Users/cristos/Documents/projects/bv-brain2` |
| Model | `cove/text:standard`, reasoning medium |

## 3. Reproduction steps

The reproduction needs no UI and no pasting. `bb thread tell --file` and `bb thread spawn --file` produce exactly the same recorded request and the same staging that a composer paste produces.

1. Write a note whose first line is a unique token and whose length is over 5,000 characters (the composer's paste-to-attachment threshold):

   ```bash
   mkdir -p /tmp/omp-src
   python3 - <<'EOF'
   lines = ["ZQ-REPRO-9911 is the token. Quote it back verbatim."]
   for i in range(200):
       lines.append(f"filler {i} to reach paste size")
   open('/tmp/omp-src/clean-note.txt', 'w').write("\n".join(lines))
   EOF
   ```

2. Create an empty workspace directory and spawn two hidden threads that differ only in provider:

   ```bash
   ENV=/private/var/folders/05/9j9563qs7k1gj2nw0jv_qlf40000gn/T/attachment-repro-empty
   mkdir -p "$ENV"

   bb thread spawn --project proj_p4562js7v2 --environment "$ENV" \
     --provider acp-omp --visibility hidden \
     --title "ACP omp attachment repro (clean)" \
     --prompt "Reply with the exact token string from the attached file, and nothing else." \
     --file /tmp/omp-src/clean-note.txt --json

   bb thread spawn --project proj_p4562js7v2 --environment "$ENV" \
     --provider acp-opencode --visibility hidden \
     --title "ACP opencode attachment repro (control)" \
     --prompt "Reply with the exact token string from the attached file, and nothing else." \
     --file /tmp/omp-src/clean-note.txt --json
   ```

3. Wait for both turns to go idle, then read what each model actually received. For OMP, open its session transcript (`grep -rl <providerThreadId> ~/.omp/agent/sessions`) and print the last 200 characters of the user message. For opencode, read the reasoning of the first agent message in `bb thread log <threadId> --all --json`.

Runs recorded during this investigation: `thr_tngag78tm5` (OMP, clean), `thr_nbcuijycvy` (opencode control, clean), `thr_vu32xjbfc2` (OMP, first attempt, confounded because the source file sat inside the agent's own working directory). All three are hidden threads in project `proj_p4562js7v2` and are kept as evidence.

## 4. Expected result

Both providers see the attached file's content, or at worst a path the model can open. The control run shows what a working client does: opencode's first agent message describes the message as `"Attached file: clean-note-1793231297248-2ph5xr.txt"` followed by the file body inline, and it answers with the token without running a tool.

## 5. Actual result

### 5.1 What bb recorded and staged

Request from the operator's own thread, `thr_6d38n33qmm` sequence 74468 (Oct 28 19:32):

```json
{"type":"text","text":"now give me a short update to post in this email thread:","mentions":[]},
{"type":"localFile","path":"Pasted-text-1793230346275-6ie6ob.txt","name":"Pasted text.txt","sizeBytes":29713,"mimeType":"text/plain"}
```

Sequence 74606 (Oct 28 19:35) carries `"path":"11497-email-thread-1793230551353-va1dr6.txt"`, `"name":"11497-email-thread.txt"`, `"sizeBytes":28837` the same way. Both carry `"source":"tell"`.

The bare path is correct by design. The plugin SDK documents `sourceProjectId` as "omit for destination-relative attachments", which is what these are, and bb's staging layer resolves bare names against the thread's own project. Staging ran and succeeded:

```
/Users/cristos/.bb/thread-storage/thr_6d38n33qmm/Attachments/Pasted-text-3.txt      29713  Oct 28 19:32:29
/Users/cristos/.bb/thread-storage/thr_6d38n33qmm/Attachments/11497-email-thread.txt  28837  Oct 28 19:35:51
~/.bb/attachments/proj_9da9h742i7/Pasted-text-1793230346275-6ie6ob.txt               29713  Oct 28 19:32:26
~/.bb/attachments/proj_9da9h742i7/11497-email-thread-1793230551353-va1dr6.txt         28837  Oct 28 19:35:51
```

`Pasted-text-3.txt` is the third staged paste in that thread, which is why its suffix differs from its display name; `attachmentFilename` reuses `name` and disambiguates collisions.

### 5.2 What bb sent to the agent

The host daemon stages attachments whose path is not runtime-readable (`src/command-handlers/prompt-attachments.ts`, `shouldStageAttachment`), then the ACP provider converts the staged input for the wire. From `provider-acp/dist/host.js`, `buildPromptContentBlocks`:

```js
case "localFile":
  n.push({ type: "resource_link", uri: `file://${i.path}`, name: i.name ?? uY(i.path) });
  break;
```

So the agent receives `resource_link{ uri: "file:///Users/cristos/.bb/thread-storage/thr_6d38n33qmm/Attachments/Pasted-text-3.txt", name: "Pasted text.txt" }`.

### 5.3 What the OMP model actually received

OMP's ACP server flattens prompt content blocks before the model sees them. From the `strings` output of the 18.13.2 binary, the private converter `#D`:

```js
case "resource_link":
  s.push(o.title ?? o.name ?? o.uri);
  break;
case "audio":
  s.push("[audio omitted]");
  break;
```

The model therefore gets the block's display name as text. The session transcript for `thr_6d38n33qmm` (`~/.omp/agent/sessions/-Documents-projects-bv-brain2/2026-10-26T15-03-21-964Z_01a178bc-ce6c-76b4-9cad-17bd3e88e12a.jsonl`, line 4724) shows the entire user message:

```json
{"role":"user","content":[{"type":"text","text":"now give me a short update to post in this email thread:\n\nPasted text.txt"}],"attribution":"user"}
```

The model's own first thought, line 4725:

```
The operator says "now give me a short update to post in this email thread: Pasted text.txt"
— they pasted a file reference but no content visible (the pasted text didn't render).
```

The second paste is worse, because it carried no instruction text at all. Line 4748 records the whole user message as:

```json
{"role":"user","content":[{"type":"text","text":"11497-email-thread.txt"}],"attribution":"user"}
```

The agent then ran `glob` for `/Users/cristos/**/11497-email-thread.txt`, which timed out, and `ls` over `/tmp`, `~/Desktop`, `~/Downloads`, `~/Documents`. It happened to find a copy in `~/Downloads` that the operator had saved, so that turn recovered by luck.

The clean headless reproduction reproduces the same shape. `thr_tngag78tm5`, user message tail:

```
Reply with the exact token string from the attached file, and nothing else.

clean-note-1793231299012-ipvd66.txt
```

and the model's thoughts show it taking the bare name literally: "The cwd is a temp dir 'attachment-repro-empty'. The file name is given: clean-note-1793231299012-ipvd66.txt. Possibly the file doesn't exist (empty)."

### 5.4 The same request through opencode

`thr_nbcuijycvy` recorded an identical request (`clean-note-1793231297248-2ph5xr.txt`, bare name, no `sourceProjectId`), staged to the same kind of path, and opencode's model read it as inline content. From that thread's first reasoning item:

```
the user message says "Attached file: clean-note-1793231297248-2ph5xr.txt" and then
"ZQ-REPRO-9911 is the token. Quote it back verbatim." followed by filler lines
```

One variable changed, provider, and the content arrives.

## 6. Is it universal, and whose layer is it

The bare-filename shape is universal and is not a defect. Across the whole bb database there are 31 `localFile` prompt inputs in 22 threads, and **all 31 carry a bare filename** with no directory. Their providers are acp-gh-copilot (11 threads), acp-opencode (9), acp-omp (1), acp-github-copilot-cli (1). Only two request sources exist in 10,977 recorded sends, `tell` and `spawn`, so no surface is distinguishable in the record and no surface can be blamed for the shape.

The failure is client-side and provider-specific:

- **bb core up to the wire is correct.** Staging happens, the path is absolute in the `resource_link`, and 14 of those 22 threads show the agent later touching `~/.bb/thread-storage/<threadId>/Attachments/…`, several by `cat` and `pandoc` on the staged copy.
- **Owning layer: OMP's ACP client.** `omp` 18.13.2 reduces `resource_link` to text (`title ?? name ?? uri`) and never reads the file. Both the `title` and `uri` are dropped in practice because bb sets `name`.
- **Secondary gap in bb:** the staged path is delivered only inside the `resource_link`. The only other route is the `BB_THREAD_STORAGE` environment variable, which bb exports to every agent (`/Users/cristos/.bb/thread-storage/<threadId>`), yet nothing in the general agent guidance tells an agent that attachments land in `$BB_THREAD_STORAGE/Attachments/`. The failing agent never tried it; the clean repro agent found it by listing `$BB_THREAD_STORAGE`.

## 7. Workarounds

- Paste under 5,000 characters, which bb keeps inline as text instead of turning it into a file. The composer's threshold constant is `5e3` in the builtin `composer` plugin.
- Put the file inside the workspace and reference it by path, so it is runtime-readable and never staged.
- In an OMP thread, name the path: "read `$BB_THREAD_STORAGE/Attachments/<name>`", or tell the agent the thread storage root.
- Send the same attachment to an opencode or Copilot thread, both of which carry the content.

## 8. Request or recommendation

1. **OMP (primary).** Stop flattening `resource_link` to a display name. Either inline the file for text MIME types, or put the `uri` in front of the model so it can read the path. `can1357/oh-my-pi` is the release mirror this build came from, so that is the likely tracker; confirm before filing.
2. **bb core (secondary, small).** For `localFile` inputs whose bytes bb already has in hand, prefer an ACP `resource` block with inline `text` for `text/*` MIME types, and fall back to `resource_link` for the rest. OMP expands `resource` blocks (`if ("text" in o.resource) s.push(o.resource.text)`), so this closes the gap for clients that do not dereference links. A one-line text preamble naming the staged path (`[attached file: /abs/path]`) would cost nothing and would have saved both turns here.
3. **bb core (docs).** Say in the agent guidance that attachments land in `$BB_THREAD_STORAGE/Attachments/`. The variable is already exported and already referenced by the workflows and inline-vis skills, just never as the attachment path.

## 9. What this report does not ask for

No change in Focus Board. The pane renders the host's `ThreadChat`, exposes no attachment props at all (`ThreadChatProps` has `threadId`, `variant`, `layout`, `focusRequest`, `permissionPolicy`, `className`, `leadingContent`, `messageActions`), and contains no paste or clipboard handling. Inlining pastes in the pane would duplicate a host responsibility and hide this defect.

> AGENT GENERATED CONTENT
