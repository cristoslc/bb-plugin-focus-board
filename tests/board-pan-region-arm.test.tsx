// @vitest-environment jsdom
// The pan router's re-arm (issue #403's UAT report): the wiring effect must
// attach again when the board region mounts after the mount readiness gate's
// loading view — a ref alone never re-triggers an effect, so the pre-fix
// router attached against an absent region and every toolbar slide reached
// the page. The harness mirrors the gate's shape: while `armed` is false the
// region is NOT mounted (the loading view), and its mount coincides with the
// flip.
import { describe, expect, it, vi } from "vitest";
import { render } from "@testing-library/react";
import { useRef } from "react";

import { useBoardPanRouter } from "../components/board-pan";

function Harness({ armed }: { armed: boolean }): React.JSX.Element {
  const ref = useRef<HTMLDivElement | null>(null);
  useBoardPanRouter(ref, armed);
  return armed ? <div ref={ref} data-board-region="" /> : <div>Loading…</div>;
}

describe("the pan router's wiring", () => {
  it("attaches when the region mounts past the gate, not before", () => {
    const attach = vi.spyOn(HTMLElement.prototype, "addEventListener");
    const { rerender, container } = render(<Harness armed={false} />);
    // The gate's shape: the loading view is on screen and the region is not
    // in the DOM at all.
    expect(container.querySelector("[data-board-region]")).toBeNull();
    rerender(<Harness armed={true} />);
    const region = container.querySelector("[data-board-region]");
    if (region === null) throw new Error("the region never mounted");
    // The wiring re-armed with the region: the router's touch listeners ride
    // the flip (pre-fix, the effect keyed on the ref alone and never re-ran).
    const touchesOnRegion = attach.mock.calls.filter(
      (_, index) => attach.mock.instances[index] === region && attach.mock.calls[index][0] === "touchstart",
    );
    expect(touchesOnRegion.length).toBeGreaterThanOrEqual(1);
  });
});
