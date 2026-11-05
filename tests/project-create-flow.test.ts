// The dialog's New project flows (lib/project-create-flow): the native
// folder picker on the board's single connected persistent host — bb's
// typical new-project flow, from picking to the create write's exact
// payload — plus the honest refusals (no host, ambiguous hosts, a picked
// root) that hand the dialog its inline name field with the reason.
import { describe, expect, it, vi } from "vitest";
import {
  createProjectFromPickedFolder,
  type ProjectCreateSdk,
} from "../lib/project-create-flow";
import { PROJECT_PATH_ROOT_REFUSAL } from "../lib/project-folder-name";

function sdkWith(
  {
    hosts = [],
    pickError,
    pickPath,
    createError,
  }: {
    hosts?: Array<Record<string, string>>;
    pickError?: Error;
    pickPath?: string | null;
    createError?: Error;
  } = {},
): { sdk: ProjectCreateSdk; listCalls: number; picks: Array<Record<string, string>>; creates: Array<Record<string, unknown>> } {
  const state = { listCalls: 0, picks: [] as Array<Record<string, string>>, creates: [] as Array<Record<string, unknown>> };
  const sdk: ProjectCreateSdk = {
    hosts: {
      list: async () => {
        state.listCalls += 1;
        return hosts as never;
      },
      pickFolder: async (args) => {
        state.picks.push(args as Record<string, string>);
        if (pickError !== undefined) throw pickError;
        return { path: pickPath ?? null };
      },
    },
    projects: {
      create: async (args) => {
        state.creates.push(args as Record<string, unknown>);
        if (createError !== undefined) throw createError;
        return { id: "proj_picked" };
      },
    },
  };
  return { sdk, ...state };
}

describe("createProjectFromPickedFolder (the dialog's typical-flow create)", () => {
  it("a single connected persistent host is the machine to ask: pickFolder gets that host as both target and client", async () => {
    const { sdk, picks } = sdkWith({
      hosts: [{ id: "host_local", name: "MacBook Pro", status: "connected", type: "persistent" }],
      pickPath: "/Users/me/code/auth-rework",
    });
    const result = await createProjectFromPickedFolder(sdk);
    expect(picks).toEqual([{ hostId: "host_local", clientHostId: "host_local" }]);
    expect(result).toEqual({ id: "proj_picked" });
  });

  it("the create carries bb's typical payload: the folder's own name and the local_path source", async () => {
    const { sdk, creates } = sdkWith({
      hosts: [{ id: "host_local", name: "MacBook Pro", status: "connected", type: "persistent" }],
      pickPath: "/Users/me/code/auth-rework/",
    });
    await createProjectFromPickedFolder(sdk);
    expect(creates).toEqual([
      {
        name: "auth-rework",
        source: { type: "local_path", hostId: "host_local", path: "/Users/me/code/auth-rework/" },
      },
    ]);
  });

  it("a cancelled pick (null path) creates nothing and returns no id", async () => {
    const { sdk, picks, creates } = sdkWith({
      hosts: [{ id: "host_local", name: "MacBook Pro", status: "connected", type: "persistent" }],
      pickPath: null,
    });
    const result = await createProjectFromPickedFolder(sdk);
    expect(picks).toHaveLength(1);
    expect(creates).toHaveLength(0);
    expect(result).toEqual({ id: null });
  });

  it("no connected persistent host refuses the pick with the reason (the dialog arms its name field with it)", async () => {
    const { sdk, picks } = sdkWith({ hosts: [] });
    await expect(createProjectFromPickedFolder(sdk)).rejects.toThrow(
      "No connected host to pick a project folder on.",
    );
    expect(picks).toHaveLength(0);
  });

  it("a disconnected-only board refuses the pick too", async () => {
    const { sdk } = sdkWith({
      hosts: [{ id: "host_local", name: "MacBook Pro", status: "disconnected", type: "persistent" }],
    });
    await expect(createProjectFromPickedFolder(sdk)).rejects.toThrow(
      "No connected host to pick a project folder on.",
    );
  });

  it("several connected persistent hosts refuse the pick (the client machine is unresolvable) without opening a picker", async () => {
    const { sdk, picks } = sdkWith({
      hosts: [
        { id: "host_a", name: "MacBook Pro", status: "connected", type: "persistent" },
        { id: "host_b", name: "studio", status: "connected", type: "persistent" },
      ],
    });
    await expect(createProjectFromPickedFolder(sdk)).rejects.toThrow(
      "Several hosts make this board, so the folder picker cannot know which machine to ask.",
    );
    expect(picks).toHaveLength(0);
  });

  it("an ephemeral machine alone cannot host the pick (the field flow serves the create instead)", async () => {
    const { sdk } = sdkWith({
      hosts: [{ id: "host_machine", name: "probe", status: "connected", type: "ephemeral" }],
    });
    await expect(createProjectFromPickedFolder(sdk)).rejects.toThrow(
      "No connected host to pick a project folder on.",
    );
  });

  it("a picked filesystem root refuses the create with bb's own words", async () => {
    const { sdk, creates } = sdkWith({
      hosts: [{ id: "host_local", name: "MacBook Pro", status: "connected", type: "persistent" }],
      pickPath: "/",
    });
    await expect(createProjectFromPickedFolder(sdk)).rejects.toThrow(PROJECT_PATH_ROOT_REFUSAL);
    expect(creates).toHaveLength(0);
  });

  it("a refused create write propagates its own reason (the dialog shows it inline)", async () => {
    const { sdk, creates } = sdkWith({
      hosts: [{ id: "host_local", name: "MacBook Pro", status: "connected", type: "persistent" }],
      pickPath: "/Users/me/code/auth-rework",
      createError: new Error(`A project named "auth-rework" already exists.`),
    });
    await expect(createProjectFromPickedFolder(sdk)).rejects.toThrow("already exists");
    expect(creates).toHaveLength(1);
  });
});
