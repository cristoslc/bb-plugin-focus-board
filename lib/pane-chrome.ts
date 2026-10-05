// Shared chrome classes for the thread pane's header buttons.
//
// A 28px ghost icon button that grows to a 36px touch target on coarse
// pointers (phones), matching bb's own headers. Lives here — not in
// thread-pane.tsx — because both the pane and the workspace-open menu
// render header buttons, and a menu→pane import would be circular.
import { COARSE_POINTER_HEADER_ICON_BUTTON_CLASS } from "@/components/ui/coarse-pointer-sizing";

export const HEADER_ICON_BUTTON_CLASS = `${COARSE_POINTER_HEADER_ICON_BUTTON_CLASS} shrink-0 text-muted-foreground hover:text-foreground`;
