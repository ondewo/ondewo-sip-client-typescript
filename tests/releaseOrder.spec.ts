// Copyright 2021-2026 ONDEWO GmbH
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.
//

/**
 * The release recipe runs its steps in an order where a failure leaves nothing half-released.
 *
 * Up to 5.5.0 the release pushed "Preparing for Release" to master BEFORE `npm publish`, and the npm
 * token was first used after that push, so a bad token left a release commit on master and nothing on
 * npm. The order pinned here: every credential is checked first (release_preflight), the full suite runs
 * before anything is committed, the package is checked against HEAD before it is published, npm must SERVE
 * the version before anything reaches origin, and the GitHub release comes last and is verified.
 *
 * @module
 */

import { test as runTestCase } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'child_process';
import { existsSync, readFileSync } from 'fs';
import { dirname, join } from 'path';

/**
 * @param start - The directory to start from.
 * @returns The closest ancestor directory holding the Makefile (the repository root).
 */
function findRepoRoot(start: string): string {
	let dir: string = start;
	while (!existsSync(join(dir, 'Makefile'))) {
		dir = dirname(dir);
	}
	return dir;
}

/** The repository root (the compiled spec runs from a build directory below it). */
const REPO_ROOT: string = findRepoRoot(__dirname);
/** The Makefile holding the release recipes. */
const MAKEFILE: string = readFileSync(join(REPO_ROOT, 'Makefile'), 'utf8');
/** The release toolchain image. */
const DOCKERFILE: string = readFileSync(join(REPO_ROOT, 'Dockerfile.utils'), 'utf8');

/**
 * @param target - The make target.
 * @returns The target's recipe lines (tab-indented, comments between them dropped), up to the next blank line.
 */
function recipeLinesOf(target: string): string[] {
	const start: number = MAKEFILE.indexOf(`\n${target}:`);
	if (start < 0) {
		throw new Error(`the Makefile has no ${target} target`);
	}
	return MAKEFILE.slice(start + 1)
		.split('\n\n')[0]
		.split('\n')
		.slice(1)
		.filter((line: string): boolean => line.startsWith('\t'))
		.map((line: string): string => line.trim());
}

/** The release steps in the order the recipe must run them, each as the recipe line that runs it. */
const RELEASE_STEPS: [string, RegExp][] = [
	['release_preflight', /^\$\(MAKE\) release_preflight$/],
	['build', /^\$\(WITHOUT_CREDENTIALS\) \$\(MAKE\) build$/],
	['check_build', /^\$\(WITHOUT_CREDENTIALS\) \$\(MAKE\) check_build$/],
	['release_tests', /^\$\(WITHOUT_CREDENTIALS\) \$\(MAKE\) release_tests$/],
	['run_precommit_hooks', /^\$\(WITHOUT_CREDENTIALS\) \$\(MAKE\) run_precommit_hooks$/],
	['local commit', /git diff --cached --quiet \|\| .*git commit --no-verify -m "Preparing for Release/],
	['check_tag_matches_package', /^\$\(WITHOUT_CREDENTIALS\) \$\(MAKE\) check_tag_matches_package$/],
	['npm publish', /^\$\(MAKE\) publish_npm_via_docker$/],
	['npm serves the version', /^\$\(MAKE\) check_npm_published$/],
	['git push', /^\$\(WITHOUT_CREDENTIALS\) git push$/],
	['release branch', /^\$\(WITHOUT_CREDENTIALS\) \$\(MAKE\) create_release_branch$/],
	['release tag', /^\$\(WITHOUT_CREDENTIALS\) \$\(MAKE\) create_release_tag$/],
	['GitHub release', /^\$\(MAKE\) release_to_github_via_docker_image$/],
	['release_verify', /^\$\(MAKE\) release_verify$/]
];

runTestCase('the release recipe runs every step once, in the pinned order', () => {
	const lines: string[] = recipeLinesOf('release');
	const positions: number[] = RELEASE_STEPS.map(([name, pattern]: [string, RegExp]): number => {
		const matches: number[] = lines
			.map((line: string, index: number): [string, number] => [line, index])
			.filter(([line]: [string, number]): boolean => pattern.test(line))
			.map(([, index]: [string, number]): number => index);
		assert.equal(matches.length, 1, `release must run "${name}" exactly once`);
		return matches[0];
	});
	const outOfOrder: string[] = RELEASE_STEPS.flatMap(([name]: [string, RegExp], index: number): string[] => {
		if (index === 0 || positions[index] > positions[index - 1]) {
			return [];
		}
		return [`${name} runs before ${RELEASE_STEPS[index - 1][0]}`];
	});
	assert.deepEqual(outOfOrder, []);
});

runTestCase('no release line ignores its own failure', () => {
	assert.deepEqual(
		recipeLinesOf('release').filter((line: string): boolean => line.startsWith('-')),
		[]
	);
});

runTestCase('every git and make step of the release that needs no credential runs without one', () => {
	const unprotected: string[] = recipeLinesOf('release').filter((line: string): boolean =>
		/^(git (push|commit|diff)|\$\(MAKE\) (build|check_build|release_tests|run_precommit_hooks|check_tag_matches_package|create_release_branch|create_release_tag))\b/.test(
			line
		)
	);
	assert.deepEqual(unprotected, []);
	assert.match(MAKEFILE, /^WITHOUT_CREDENTIALS=env -u GITHUB_GH_TOKEN -u NPM_AUTOMATION_TOKEN -u GH_TOKEN$/m);
});

runTestCase('release_tests installs from the lockfile and runs the whole suite', () => {
	const lines: string[] = recipeLinesOf('release_tests');
	assert.ok(lines.some((line: string): boolean => /\bnpm ci\b/.test(line)));
	assert.ok(lines.some((line: string): boolean => /\bnpm test$/.test(line)));
	assert.ok(!lines.some((line: string): boolean => /\bnpm (install|i)\b/.test(line)));
});

runTestCase('release_preflight probes every credential and refuses a released version before anything happens', () => {
	const recipe: string = recipeLinesOf('release_preflight').join('\n');
	assert.match(MAKEFILE, /^release_preflight: spc build_tools_docker_image /m);
	assert.ok(recipe.includes('npm whoami --userconfig'));
	assert.ok(recipe.includes('gh api repos/$(GH_REPO_SLUG) --jq .permissions.push'));
	assert.ok(recipe.includes('git push --dry-run'));
	assert.ok(recipe.includes('npm view "$(NPM_PACKAGE)@${ONDEWO_SIP_VERSION}" version'));
	assert.ok(recipe.includes('$(RELEASE_NOTES_SLICE) src/RELEASE.md'));
	assert.ok(!/\b(git (commit|tag|push(?! --dry-run))|npm publish|gh release create)\b/.test(recipe));
});

runTestCase(
	'release_preflight and release_verify load the credentials from DEVOPS_ACCOUNT_DIR when run standalone',
	() => {
		assert.match(MAKEFILE, /^LOAD_CREDENTIALS=if .*\[ -d "\$\(DEVOPS_ACCOUNT_DIR\)" \]; then set -a; eval /m);
		const tokenLines: string[] = ['release_preflight', 'release_verify'].flatMap((target: string): string[] =>
			recipeLinesOf(target).filter((line: string): boolean =>
				/-e (GITHUB_GH_TOKEN|NPM_AUTOMATION_TOKEN)\b|test -n "\$\$(GITHUB_GH_TOKEN|NPM_AUTOMATION_TOKEN)"/.test(line)
			)
		);
		assert.ok(tokenLines.length >= 5);
		assert.deepEqual(
			tokenLines.filter((line: string): boolean => !line.startsWith('@$(LOAD_CREDENTIALS); ')),
			[]
		);
	}
);

runTestCase('release_verify checks the tag, the GitHub release body and npm', () => {
	const recipe: string = recipeLinesOf('release_verify').join('\n');
	assert.ok(recipe.includes('git ls-remote --exit-code --tags origin "refs/tags/${ONDEWO_SIP_VERSION}"'));
	assert.ok(recipe.includes('gh release view "${ONDEWO_SIP_VERSION}"'));
	assert.ok(recipe.includes("grep -q '[^[:space:]]'"));
	assert.ok(recipe.includes('$(MAKE) check_npm_published'));
	assert.match(
		recipeLinesOf('check_npm_published').join('\n'),
		/npm view "\$\(NPM_PACKAGE\)@\$\{ONDEWO_SIP_VERSION\}" version/
	);
});

runTestCase('the GitHub release refuses empty notes', () => {
	const lines: string[] = recipeLinesOf('build_gh_release');
	assert.match(lines[0], /^@test -n "\$\(CURRENT_RELEASE_NOTES\)" \|\| \{/);
	assert.ok(lines[1].includes('gh release create'));
});

runTestCase('ondewo_release deletes the devops-accounts clone before the release runs, and on failure', () => {
	const recipe: string = recipeLinesOf('ondewo_release').join('\n');
	const load: number = recipe.indexOf("eval \"$$(grep -h -E '^(GITHUB_GH_TOKEN|NPM_AUTOMATION_TOKEN)='");
	const remove: number = recipe.indexOf('if [ -n "$$clone_dir" ]; then rm -rf "$$clone_dir"; fi');
	const release: number = recipe.lastIndexOf('$(MAKE) release');
	assert.ok(load > 0 && remove > load && release > remove, 'load -> delete clone -> $(MAKE) release');
	assert.ok(recipe.includes(`trap 'rm -rf "$$clone_dir"' EXIT INT TERM`));
	assert.ok(recipe.includes('clone_dir=$$(mktemp -d)'), 'the clone lives outside the repository');
	assert.ok(recipe.includes('[ -d "$(DEVOPS_ACCOUNT_DIR)" ]'), "the driver's DEVOPS_ACCOUNT_DIR is honoured");
	assert.match(MAKEFILE, /^DEVOPS_ACCOUNT_DIR\?=$/m);
	assert.match(MAKEFILE, /^ondewo_release: spc /m);
	assert.ok(recipe.indexOf('if [ -n "$(DRY_RUN)" ]') < recipe.indexOf('git clone'), 'make -n never clones');
	assert.match(MAKEFILE, /^DRY_RUN:=\$\(findstring n,\$\(firstword -\$\(MAKEFLAGS\)\)\)$/m);
});

runTestCase('spc checks branch and tag anchored, locally and on origin', () => {
	const recipe: string = recipeLinesOf('spc').join('\n');
	assert.ok(recipe.includes('git rev-parse -q --verify "refs/tags/${ONDEWO_SIP_VERSION}"'));
	assert.ok(recipe.includes('git rev-parse -q --verify "refs/heads/release/${ONDEWO_SIP_VERSION}"'));
	assert.ok(recipe.includes('git ls-remote --exit-code --heads origin "refs/heads/release/${ONDEWO_SIP_VERSION}"'));
	assert.ok(recipe.includes('git ls-remote --exit-code --tags origin "refs/tags/${ONDEWO_SIP_VERSION}"'));
	assert.ok(!/\| *grep/.test(recipe), 'no unanchored grep');
});

runTestCase('the version bump matches multi-digit version components', () => {
	assert.ok(
		recipeLinesOf('update_package')[0].includes(
			'"s/\\"version\\": \\"[0-9]+\\.[0-9]+\\.[0-9]+\\"/\\"version\\": \\"${ONDEWO_SIP_VERSION}\\"/g"'
		)
	);
});

runTestCase('src/package.json is on the Makefile version', () => {
	const version: RegExpExecArray | null = /^ONDEWO_SIP_VERSION=(\S+)$/m.exec(MAKEFILE);
	assert.ok(version !== null);
	const pkg: { version: string } = JSON.parse(readFileSync(join(REPO_ROOT, 'src', 'package.json'), 'utf8')) as {
		version: string;
	};
	assert.equal(pkg.version, version[1]);
});

/** The part of a package.json the dependency check reads. */
interface Manifest {
	/** The dev dependencies by name. */
	devDependencies?: Record<string, string>;
}

runTestCase('the codegen source package.json carries the dev dependencies the root declares', () => {
	// The codegen rewrites the root package.json from src/package.json and restore_ci_test_setup merges
	// .ci-package.json back, so a devDependency missing or older in src/package.json is downgraded by every
	// release (it took eslint from 10 back to 9).
	const read: (file: string) => Manifest = (file: string): Manifest =>
		JSON.parse(readFileSync(join(REPO_ROOT, file), 'utf8')) as Manifest;
	const restored: Record<string, string> = {
		...read('src/package.json').devDependencies,
		...read('.ci-package.json').devDependencies
	};
	assert.deepEqual(restored, { ...read('package.json').devDependencies });
});

runTestCase('the build neither pushes ondewo-sip-api nor mounts the repository root into the codegen', () => {
	assert.ok(!MAKEFILE.includes('make -C ${SIP_APIS_DIR}'));
	assert.ok(!MAKEFILE.includes('$(MAKE) -C ${SIP_APIS_DIR}'));
	const codegen: string = recipeLinesOf('npm_run_build').join('\n');
	assert.ok(codegen.includes('-v "$(CURDIR)/src":/input-volume:ro'));
	assert.ok(codegen.includes('-v "$(CURDIR)/$(CODEGEN_OUTPUT_DIR)":/output-volume'));
	assert.ok(!/\/\.\.:\/output-volume|"\$\(CURDIR\)":\/output-volume/.test(codegen));
	assert.ok(codegen.includes('rm -rf $(CODEGEN_OUTPUT_DIR)/node_modules $(CODEGEN_OUTPUT_DIR)/package-lock.json'));
	assert.ok(
		!/\bsudo\b/.test(
			MAKEFILE.split('\n')
				.filter((line: string): boolean => line.startsWith('\t'))
				.join('\n')
		)
	);
});

runTestCase('the toolchain image is pinned, carries no credential and has a tools-only stage', () => {
	assert.match(DOCKERFILE, /^FROM node:[0-9.]+-[a-z-]+@sha256:[0-9a-f]{64} AS tools$/m);
	assert.match(DOCKERFILE, /^ARG GH_VERSION=[0-9]+\.[0-9]+\.[0-9]+$/m);
	assert.match(DOCKERFILE, /sha256sum -c/);
	assert.equal(/^ENV [A-Z_]*(TOKEN|PASSWORD|SECRET)/m.exec(DOCKERFILE), null);
	assert.ok(!DOCKERFILE.includes(':latest'));
	assert.match(MAKEFILE, /--target tools -f Dockerfile\.utils/);
	const dockerignore: string[] = readFileSync(join(REPO_ROOT, '.dockerignore'), 'utf8').split('\n');
	assert.ok(dockerignore.includes('*'));
	assert.ok(dockerignore.includes('ondewo-devops-accounts'));
});

/**
 * @param args - Extra make arguments.
 * @returns The `-le <attempts>` and `sleep <seconds>` values `make -n check_npm_published` would poll with.
 */
function npmPollOf(args: string[]): string[] {
	const out: string = execFileSync('make', ['-s', '-n', '-C', REPO_ROOT, 'check_npm_published', ...args], {
		encoding: 'utf8'
	});
	return [/-le (\d+)/.exec(out)?.[1] ?? '', /sleep (\d+)/.exec(out)?.[1] ?? ''];
}

runTestCase(
	'release_verify honours the driver-wide VERIFY_ATTEMPTS / VERIFY_INTERVAL_S and the old NPM_VERIFY_*',
	() => {
		assert.match(MAKEFILE, /^NPM_VERIFY_ATTEMPTS\?=\$\(VERIFY_ATTEMPTS\)$/m);
		assert.match(MAKEFILE, /^NPM_VERIFY_INTERVAL_S\?=\$\(VERIFY_INTERVAL_S\)$/m);
		assert.deepEqual(npmPollOf([]), ['20', '30']);
		assert.deepEqual(npmPollOf(['VERIFY_ATTEMPTS=3', 'VERIFY_INTERVAL_S=10']), ['3', '10']);
		assert.deepEqual(
			npmPollOf(['VERIFY_ATTEMPTS=3', 'VERIFY_INTERVAL_S=10', 'NPM_VERIFY_ATTEMPTS=7', 'NPM_VERIFY_INTERVAL_S=5']),
			['7', '5']
		);
	}
);
