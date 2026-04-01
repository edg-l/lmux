let landLockAvailable: boolean | null = null;

export function isLandlockAvailable(): boolean {
	if (landLockAvailable === null) {
		landLockAvailable = !!Bun.which('landlock-restrict');
	}
	return landLockAvailable;
}

export function buildSandboxedCommand(
	projectPath: string,
	command: string
): { args: string[]; sandboxed: boolean } {
	if (isLandlockAvailable()) {
		return {
			args: [
				'landlock-restrict',
				'-ro',
				'/',
				'-rw',
				projectPath,
				'-rw',
				'/tmp',
				'--',
				'bash',
				'-c',
				command
			],
			sandboxed: true
		};
	}
	return {
		args: ['bash', '-c', command],
		sandboxed: false
	};
}
