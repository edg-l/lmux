import { queryAll, queryOne, execute } from './db';

export interface Project {
	id: number;
	name: string;
	path: string;
	created_at: string;
}

export function createProject(name: string, path: string): number {
	execute(`INSERT OR IGNORE INTO projects (name, path) VALUES ($name, $path)`, {
		$name: name,
		$path: path
	});
	const existing = queryOne<Project>(`SELECT * FROM projects WHERE path = $path`, { $path: path });
	return existing!.id;
}

export function getProject(id: number): Project | null {
	return queryOne<Project>(`SELECT * FROM projects WHERE id = $id`, { $id: id });
}

export function listProjects(): Project[] {
	return queryAll<Project>(`SELECT * FROM projects ORDER BY created_at DESC`);
}

export function deleteProject(id: number): void {
	execute(`DELETE FROM conversations WHERE project_id = $id`, { $id: id });
	execute(`DELETE FROM projects WHERE id = $id`, { $id: id });
}
