// The React view of lib/host-capabilities: one mount starts the host-version
// read, every mount reads the same store. Components that only need "does
// this host already own the surface" call this; the store dedupes the RPC and
// keeps the answer for the whole app generation.
import { useEffect, useSyncExternalStore } from "react";
import { useRpc } from "@get-bb/plugin-sdk/app";
import type { rpcContract } from "@/server";
import {
	hostCapabilities,
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
