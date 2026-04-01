import type { PageServerLoad } from './$types';
import { listRepoFiles, fetchGenerationConfig } from '$lib/server/huggingface';
import { getHardwareProfile, getUsableVram } from '$lib/server/hardware';
import { assessFit } from '$lib/server/recommendations';
import type { FitLevel } from '$lib/server/recommendations';

export const load: PageServerLoad = async ({ params }) => {
	const repoId = `${params.owner}/${params.repo}`;

	const [files, hardware, generationConfig] = await Promise.all([
		listRepoFiles(repoId),
		Promise.resolve(getHardwareProfile()),
		fetchGenerationConfig(repoId)
	]);

	const totalVram = getUsableVram(hardware);

	const filesWithFit = files.map((file) => ({
		...file,
		fit: (totalVram > 0 ? assessFit(file.size, totalVram) : 'no_fit') as FitLevel,
		isMmproj: file.isMmproj ?? false
	}));

	return {
		repoId,
		files: filesWithFit,
		hardware,
		generationConfig
	};
};
