// The thread pane header's workspace-open control, the pane's take on the
// main thread view's open button: an icon that opens the thread's workspace
// in the preferred editor, plus an attached chevron whose dropdown lists the
// other destinations — file explorer, terminal, new window, copy link.
//
// The daemon conversation lives server-side (lib/workspace-open.ts via the
// workspace_open_* RPCs); this component only picks targets and renders.
// When no local open is possible — no workspace, daemon down, workspace on
// another host — the control renders nothing, matching how bb's own header
// hides its workspace button without a target.
import { useCallback, useEffect, useState } from "react";
import { useRpc } from "@get-bb/plugin-sdk/app";
import { z } from "zod";
import type { rpcContract } from "@/server";
import { Icon } from "@/components/ui/icon";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { HEADER_ICON_BUTTON_CLASS } from "@/lib/pane-chrome";

type WorkspaceOpenTargets = z.infer<
	(typeof rpcContract)["workspace_open_targets"]["output"]
>;
type WorkspaceOpenTarget = WorkspaceOpenTargets["targets"][number];

interface WorkspaceOpenMenuProps {
	threadId: string;
	/** The thread's app-relative URL for the new-window and copy-link entries. */
	threadHref: string;
}

/** The app's own workspace-target preference key (workspace-open-target-preference). */
const WORKSPACE_TARGET_PREFERENCE_KEY = "bb.workspaceOpenTarget";

function readPreferredTargetId(): string | null {
	try {
		const raw = window.localStorage.getItem(WORKSPACE_TARGET_PREFERENCE_KEY);
		return raw === null ? null : JSON.parse(raw);
	} catch {
		return null;
	}
}

function targetsOfKind(
	targets: readonly WorkspaceOpenTarget[],
	kind: string,
): WorkspaceOpenTarget[] {
	return targets.filter((target) => target.kind === kind);
}

/**
 * The editor entry follows the operator's own workspace-target preference
 * when it names an available editor; otherwise the first editor target.
 */
function pickEditorTarget(
	targets: readonly WorkspaceOpenTarget[],
): WorkspaceOpenTarget | null {
	const editors = targetsOfKind(targets, "editor");
	if (editors.length === 0) return null;
	const preferredId = readPreferredTargetId();
	if (preferredId !== null) {
		const preferred = editors.find((target) => target.id === preferredId);
		if (preferred !== undefined) return preferred;
	}
	return editors[0] ?? null;
}

function pickTargetOfKind(
	targets: readonly WorkspaceOpenTarget[],
	kind: string,
): WorkspaceOpenTarget | null {
	return targetsOfKind(targets, kind)[0] ?? null;
}

export function WorkspaceOpenMenu({ threadId, threadHref }: WorkspaceOpenMenuProps) {
	const rpc = useRpc<typeof rpcContract>();
	const [state, setState] = useState<WorkspaceOpenTargets | null>(null);
	const [open, setOpen] = useState(false);
	const [error, setError] = useState<string | null>(null);

	useEffect(() => {
		let live = true;
		rpc
			.call("workspace_open_targets", { threadId })
			.then((result) => {
				if (live) setState(result);
			})
			.catch(() => {
				// Discovery is best-effort: an unreachable RPC is the same
				// operator-visible verdict as an unreachable daemon.
				if (live) {
					setState({
						status: "unavailable",
						reason: "Local host daemon is unavailable.",
						root: null,
						targets: [],
					});
				}
			});
		return () => {
			live = false;
		};
	}, [rpc, threadId]);

	const openInTarget = useCallback(
		async (target: WorkspaceOpenTarget): Promise<boolean> => {
			setError(null);
			try {
				const result = await rpc.call("workspace_open_in_target", {
					threadId,
					targetId: target.id,
				});
				if (!result.ok) {
					setError(result.message ?? "Failed to open the workspace.");
					return false;
				}
				return true;
			} catch (cause) {
				setError(cause instanceof Error ? cause.message : String(cause));
				return false;
			}
		},
		[rpc, threadId],
	);

	if (state === null || state.status !== "available" || state.root === null) {
		return null;
	}

	const editor = pickEditorTarget(state.targets);
	const fileExplorer =
		pickTargetOfKind(state.targets, "file-manager") ??
		pickTargetOfKind(state.targets, "default-app");
	const terminal = pickTargetOfKind(state.targets, "terminal");
	const primary = editor ?? fileExplorer ?? terminal;
	if (primary === null) return null;

	const absoluteHref = new URL(threadHref, window.location.origin).toString();

	// Workspace destinations ask the daemon; thread destinations are local
	// to this surface. The dropdown draws a divider between the groups.
	const workspaceItems: {
		id: string;
		label: string;
		icon: string;
		target: WorkspaceOpenTarget;
	}[] = [];
	if (editor !== null) {
		workspaceItems.push({
			id: "editor",
			label: "Open in editor",
			icon: "Code",
			target: editor,
		});
	}
	if (fileExplorer !== null) {
		workspaceItems.push({
			id: "file-explorer",
			label: "Open in file explorer",
			icon: "FolderOpen",
			target: fileExplorer,
		});
	}
	if (terminal !== null) {
		workspaceItems.push({
			id: "terminal",
			label: "Open in terminal",
			icon: "Terminal",
			target: terminal,
		});
	}
	const threadItems: { id: string; label: string; icon: string; run: () => void }[] = [
		{
			id: "new-window",
			label: "Open in new window",
			icon: "NewTab",
			// noopener: the opened tab must not reach back through
			// window.opener into this board.
			run: () => window.open(absoluteHref, "_blank", "noopener"),
		},
		{
			id: "copy-link",
			label: "Copy thread link",
			icon: "Copy",
			run: () =>
				void navigator.clipboard?.writeText(absoluteHref).catch(() => {
					// Same console fallback the pane's copy affordances use.
					console.debug("[focus-board:copy-thread-link]", absoluteHref);
				}),
		},
	];

	return (
		<div className="inline-flex shrink-0 items-stretch overflow-hidden rounded-md">
			<Button
				variant="ghost"
				size="icon"
				className={cn(HEADER_ICON_BUTTON_CLASS, "rounded-r-none")}
				aria-label={`Open workspace in ${primary.label}`}
				// The menu stays up while the ask is in flight: closing on a
				// failure would read as a dead button, so only success closes —
				// and a failure from the icon itself opens the menu to show why.
				onClick={() =>
					void openInTarget(primary).then((opened) => {
						setOpen(!opened);
					})
				}
			>
				<Icon name="FolderOpen" className="size-4" />
			</Button>
			<div className="w-px self-stretch my-1.5 bg-border" aria-hidden />
			<Button
				variant="ghost"
				size="icon"
				className={cn(HEADER_ICON_BUTTON_CLASS, "rounded-l-none px-0")}
				aria-label="More places to open"
				aria-haspopup="menu"
				aria-expanded={open}
				onClick={() => setOpen((current) => !current)}
			>
				<Icon name="ChevronDown" className="size-3" />
			</Button>
			{open ? (
				<>
					<div
						className="fixed inset-0 z-40"
						onClick={() => setOpen(false)}
						aria-hidden
					/>
					<div
						role="menu"
						aria-label="More places to open"
						className="absolute right-0 top-8 z-50 min-w-40 rounded-md border border-border bg-popover p-1 shadow-md"
					>
						{workspaceItems.map((item) => (
							<button
								key={item.id}
								type="button"
								role="menuitem"
								onClick={() => {
									void openInTarget(item.target).then((opened) => {
										if (opened) setOpen(false);
									});
								}}
								className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-xs hover:bg-accent"
							>
								<Icon
									name={item.icon}
									className="size-3.5 shrink-0 text-muted-foreground"
									aria-hidden
								/>
								{item.label}
							</button>
						))}
						{workspaceItems.length > 0 ? (
							<div className="my-1 border-t border-border" aria-hidden />
						) : null}
						{threadItems.map((item) => (
							<button
								key={item.id}
								type="button"
								role="menuitem"
								onClick={() => {
									setOpen(false);
									item.run();
								}}
								className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-xs hover:bg-accent"
							>
								<Icon
									name={item.icon}
									className="size-3.5 shrink-0 text-muted-foreground"
									aria-hidden
								/>
								{item.label}
							</button>
						))}
						{error !== null ? (
							// The open ask failed: keep the menu up and say why —
							// a silently closed menu would read as a dead button.
							<p
								role="status"
								className="mt-1 border-t border-border px-2 pt-2 text-[11px] leading-snug text-destructive"
							>
								{error}
							</p>
						) : null}
					</div>
				</>
			) : null}
		</div>
	);
}
