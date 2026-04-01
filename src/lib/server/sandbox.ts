let landLockAvailable: boolean | null = null;
let bashPath: string = '/bin/bash';

export function isLandlockAvailable(): boolean {
	if (landLockAvailable === null) {
		landLockAvailable = !!Bun.which('landlock-restrict');
		bashPath = Bun.which('bash') ?? '/bin/bash';
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
				bashPath,
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
