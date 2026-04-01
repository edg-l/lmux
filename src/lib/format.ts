export function formatBytes(bytes: number): string {
	if (!bytes || bytes === 0) return '0 B';
	const units = ['B', 'KB', 'MB', 'GB', 'TB'];
	const i = Math.floor(Math.log(bytes) / Math.log(1024));
	return (bytes / Math.pow(1024, i)).toFixed(1) + ' ' + units[i];
}

export function formatParams(count: number | null): string {
	if (!count) return '';
	if (count >= 1e9) return (count / 1e9).toFixed(1) + 'B';
	if (count >= 1e6) return (count / 1e6).toFixed(0) + 'M';
	return String(count);
}
