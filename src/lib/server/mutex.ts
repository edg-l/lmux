export class Mutex {
	private _tail = Promise.resolve();

	lock(): Promise<() => void> {
		let release: () => void;
		const prev = this._tail;
		this._tail = new Promise((resolve) => {
			release = resolve;
		});
		return prev.then(() => release!);
	}
}
