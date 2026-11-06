import { APP_VERSION, type WhatsNewEntry, groupWhatsNewItems, unreleasedFingerprint } from "@/lib/whats-new";
import { cn } from "@/lib/utils";

/**
 * The condensed changelog feed, as tab content inside the settings modal.
 * It lists the entries it is given — either the delta since the stored
 * last-seen version (after an update), every recent entry (opened unprompted
 * from the gear), or a prerelease build's [Unreleased] group first — and it
 * carries no presentation state of its own: opening it is the caller's
 * signal to mark the version seen (the former standalone modal's side
 * effect, now in app.tsx). Changelog bullets tagged with `#### <surface>`
 * headings group their same-surface items under that label (Added, Changed,
 * and Fixed merge); untagged entries render flat.
 *
 * A dev build's [Unreleased] group is the one place the feed mixes old and
 * new: it accumulates between releases, so amber marks what is still
 * becoming true. When the entry carries `unseenLeads`, a bullet's amber is
 * its lead's membership — a fresh lead (and its children) tints amber, a
 * lead the reader already had open stays muted, a surface heading follows
 * whether any bullet under it is amber, and the entry header follows the
 * whole group. Without the set (released deltas render whole; no seen
 * ground truth exists), the group keeps the wholesale tint.
 *
 * A bullet whose body ends with the bracket contributor note ("[Fix and
 * tests by @handle]") renders that note as a muted attribution line under
 * its lead — secondary to the lead and never tinted amber on its own.
 */
export function WhatsNewFeed({ entries }: { entries: readonly WhatsNewEntry[] }) {
  return (
    <div>
      <p className="text-xs text-muted-foreground">
        {entries.length === 0
          ? `You are on version ${APP_VERSION}.`
          : "Recent changes since you last looked."}
      </p>
      <div className="mt-3" data-whats-new-feed>
        {entries.map((entry) => {
          // Amber arithmetic happens per line, not per group: when the
          // entry carries sighted ground truth, a group is amber only if a
          // bullet under it is, and the entry header follows the group.
          // Without ground truth the unreleased group tints wholesale.
          const unseen = entry.unseenLeads;
          const itemIsUnseen = (lead: string): boolean =>
            unseen !== undefined ? unseen.has(unreleasedFingerprint([lead])) : entry.unreleased === true;
          const groupHasUnseen = (label: string | null): boolean =>
            groupWhatsNewItems(entry.items).some(
              (candidate) =>
                candidate.label === label &&
                candidate.items.some((item) => itemIsUnseen(item.lead)),
            );
          const anyUnseen = unseen === undefined
            ? entry.unreleased === true
            : entry.items.some((item) => unseen.has(unreleasedFingerprint([item.lead])));
          const itemTone = (isUnseen: boolean): string => {
            if (!entry.unreleased) return "text-muted-foreground";
            if (unseen === undefined) return "text-amber-500";
            return isUnseen ? "text-amber-500" : "text-muted-foreground";
          };
          const headingTone = (hasUnseen: boolean): string => {
            if (!entry.unreleased) return "text-muted-foreground";
            if (unseen === undefined) return "text-amber-500";
            return hasUnseen ? "text-amber-500" : "text-muted-foreground";
          };
          return (
          <section key={entry.version} className="mb-3 last:mb-0">
            <h3
              className={cn(
                "mb-1 text-xs font-semibold",
                entry.unreleased ? headingTone(anyUnseen) : "text-foreground",
              )}
            >
              {entry.unreleased ? `Unreleased ${entry.version}` : `Version ${entry.version}`}
            </h3>
            <div key={`ul-${entry.version}`}>
              {groupWhatsNewItems(entry.items).map((group, groupIndex) => (
                <div key={group.label ?? `group-${groupIndex}`}>
                  {group.label !== null && (
                    <div
                      className={cn(
                        "mb-1 mt-2 text-[10px] font-semibold uppercase tracking-wider first:mt-0",
                        groupHasUnseen(group.label) ? headingTone(true) : headingTone(false),
                      )}
                    >
                      {group.label}
                    </div>
                  )}
                  <ul className={cn("list-disc space-y-1 pl-4 text-xs leading-relaxed")}>
                    {group.items.map((item) => {
                      const isUnseen = itemIsUnseen(item.lead);
                      return (
                      <li className={itemTone(isUnseen)} key={item.lead}>
                        {item.lead}
                        {item.contributor && (
                          <span
                            className="mt-0.5 block text-[10px] text-muted-foreground"
                            data-whats-new-contributor
                          >
                            {item.contributor}
                          </span>
                        )}
                        {item.children && item.children.length > 0 && (
                          <ul
                            className={cn(
                              "list-disc mt-1 space-y-1 pl-4",
                              itemTone(isUnseen),
                            )}
                          >
                            {item.children.map((child) => (
                              <li key={child}>{child}</li>
                            ))}
                          </ul>
                        )}
                      </li>
                      );
                    })}
                  </ul>
                </div>
              ))}
            </div>
          </section>
          );
        })}
      </div>
    </div>
  );
}
