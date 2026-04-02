import type { ServerInfo } from '$lib/types/chat';

let serverInfo = $state<ServerInfo | null>(null);
let serverLogs = $state<string[]>([]);
let subscribers = 0;
let eventSource: EventSource | null = null;

export function getServerInfo(): ServerInfo | null {
	return serverInfo;
}

export function getServerLogs(): string[] {
	return serverLogs;
}

export function connectServerInfo(): () => void {
	subscribers++;
	if (subscribers === 1) {
		eventSource = new EventSource('/api/server/status');
		eventSource.onmessage = (event) => {
			try {
				const data = JSON.parse(event.data);
				serverInfo = data;
				if (data.stderr && Array.isArray(data.stderr)) {
					serverLogs = data.stderr.slice(-100);
				}
			} catch {
				/* ignore */
			}
		};
	}
	return () => {
		subscribers--;
		if (subscribers === 0 && eventSource) {
			eventSource.close();
			eventSource = null;
		}
	};
}
