// Which discovered app a pane opens a workspace path in.
//
// The pane header's open menu and the click routing for a directory link both
// pick from the daemon's target list with the same rules, so the choice lives
// here: the operator's own workspace-target preference wins when it names an
// available editor, then a file manager, then any directory-capable target.
// The preference key belongs to bb itself (`bb.workspaceOpenTarget`), which
// the header menu already honored before this module existed.
import type { WorkspaceOpenTarget } from "@/lib/workspace-open";

/** bb's own workspace-target preference key. */
const WORKSPACE_TARGET_PREFERENCE_KEY = "bb.workspaceOpenTarget";

function readPreferredTargetId(): string | null {
	try {
		const raw = window.localStorage.getItem(WORKSPACE_TARGET_PREFERENCE_KEY);
		return raw === null ? null : (JSON.parse(raw) as string | null);
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
export function pickEditorTarget(
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

export function pickTargetOfKind(
	targets: readonly WorkspaceOpenTarget[],
	kind: string,
): WorkspaceOpenTarget | null {
	return targetsOfKind(targets, kind)[0] ?? null;
}

/**
 * The app a directory link opens: the preferred editor, then a file manager
 * (Finder on macOS), then a terminal, then the first target the daemon says
 * can open a directory. Null means the pane should leave the click alone.
 */
export function pickDirectoryTarget(
	targets: readonly WorkspaceOpenTarget[],
): WorkspaceOpenTarget | null {
	// A target that cannot open a directory is never a candidate, whatever its
	// kind: the daemon's capability list is the authority.
	const capable = (target: WorkspaceOpenTarget | null): target is WorkspaceOpenTarget =>
		target !== null && target.capabilities.openDirectory;
	const preferred = [
		pickEditorTarget(targets),
		pickTargetOfKind(targets, "file-manager"),
		pickTargetOfKind(targets, "default-app"),
		pickTargetOfKind(targets, "terminal"),
	].find(capable);
	if (preferred !== undefined) return preferred;
	return targets.find((target) => target.capabilities.openDirectory) ?? null;
}
