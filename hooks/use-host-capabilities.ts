// The React view of lib/host-capabilities: one mount starts the host-version
// read, every mount reads the same store. Components that only need "does
// this host already own the surface" call this; the store dedupes the RPC and
// keeps the answer for the whole app generation.
import { useEffect, useSyncExternalStore } from "react";
import { useRpc } from "@get-bb/plugin-sdk/app";
import type { rpcContract } from "@/server";
import {
	hostCapabilities,
	hostCapabilitiesSettled,
	resolveHostCapabilities,
	subscribeHostCapabilities,
	type HostCapabilities,
} from "@/lib/host-capabilities";

export function useHostCapabilities(): HostCapabilities {
	const rpc = useRpc<typeof rpcContract>();
	useEffect(() => {
		void resolveHostCapabilities(async () => {
			const result = await rpc.call("host_version", null);
			return result.version;
		});
	}, [rpc]);
	return useSyncExternalStore(
		subscribeHostCapabilities,
		hostCapabilities,
		hostCapabilities,
	);
}

/**
 * Whether the host's version read has settled, either way. A surface that must
 * not act on the unknown set waits for this one, the readiness gate's cousin:
 * `useHostCapabilities` alone cannot tell "this host may split" from "nobody
 * has asked it yet". Call it beside `useHostCapabilities`, which owns starting
 * the read.
 */
export function useHostCapabilitiesSettled(): boolean {
	return useSyncExternalStore(
		subscribeHostCapabilities,
		hostCapabilitiesSettled,
		hostCapabilitiesSettled,
	);
}
