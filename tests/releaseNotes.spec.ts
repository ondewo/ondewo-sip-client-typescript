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
 * The GitHub release body is sliced out of RELEASE.md by the Makefile's `CURRENT_RELEASE_NOTES`:
 * `perl -ne 'print if /Release ONDEWO SIP Typescript Client ${ONDEWO_SIP_VERSION}/../^\*{5}/'`.
 *
 * A heading spelled any other way gives an empty slice, and `gh release create -n ""` then publishes a
 * release without notes and without an error; a section without its `*****` separator runs on into the
 * next release's notes. `make build` copies src/RELEASE.md (the source of truth) over RELEASE.md.
 *
 * @module
 */

import { test as runTestCase } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'fs';
import { join } from 'path';

/** The repository root (this spec runs from `.test-build/`). */
const REPO_ROOT: string = join(__dirname, '..');
/** The released notes file. */
const RELEASE_NOTES: string = readFileSync(join(REPO_ROOT, 'RELEASE.md'), 'utf8');
/** The Makefile holding the slice command and the version. */
const MAKEFILE: string = readFileSync(join(REPO_ROOT, 'Makefile'), 'utf8');
/** The text the slice starts at, followed by the version. */
const HEADING_TEXT: string = 'Release ONDEWO SIP Typescript Client ';
/** A separator line ends a section. */
const SEPARATOR: RegExp = /^\*{5}/;

/**
 * Reproduce the Makefile's perl range `/Release ONDEWO SIP Typescript Client <version>/../^\*{5}/`.
 *
 * @param version - The version whose notes to slice.
 * @returns The sliced lines, heading and separator included; empty when no heading matches.
 */
function releaseNotesSlice(version: string): string[] {
	const lines: string[] = RELEASE_NOTES.split('\n');
	const start: number = lines.findIndex((line: string): boolean => line.includes(`${HEADING_TEXT}${version}`));
	if (start < 0) {
		return [];
	}
	const end: number = lines.findIndex((line: string, index: number): boolean => index > start && SEPARATOR.test(line));
	return lines.slice(start, end < 0 ? lines.length : end + 1);
}

runTestCase('the Makefile slices RELEASE.md with the heading and separator this test pins', () => {
	assert.ok(
		MAKEFILE.includes("perl -ne 'print if /Release ONDEWO SIP Typescript Client ${ONDEWO_SIP_VERSION}/../^\\*{5}/'")
	);
});

runTestCase('every release heading uses the spelling the Makefile slices', () => {
	const headings: string[] = RELEASE_NOTES.split('\n').filter((line: string): boolean =>
		/^#+ *Release ONDEWO/i.test(line)
	);
	assert.ok(headings.length > 0);
	const misspelled: string[] = headings.filter(
		(heading: string): boolean => !new RegExp(`^## ${HEADING_TEXT}[0-9]+\\.[0-9]+\\.[0-9]+$`).test(heading)
	);
	assert.deepEqual(misspelled, []);
});

runTestCase('every release section ends at its own separator before the next heading', () => {
	const lines: string[] = RELEASE_NOTES.split('\n');
	const starts: number[] = lines.flatMap((line: string, index: number): number[] =>
		line.startsWith(`## ${HEADING_TEXT}`) ? [index] : []
	);
	const unterminated: string[] = starts
		.filter((start: number, position: number): boolean => {
			const next: number = position + 1 < starts.length ? starts[position + 1] : lines.length;
			return !lines.slice(start + 1, next).some((line: string): boolean => SEPARATOR.test(line));
		})
		.map((start: number): string => lines[start]);
	assert.deepEqual(unterminated, []);
});

runTestCase('every version has exactly one section', () => {
	const versions: string[] = RELEASE_NOTES.split('\n')
		.filter((line: string): boolean => line.startsWith(`## ${HEADING_TEXT}`))
		.map((line: string): string => line.slice(`## ${HEADING_TEXT}`.length));
	assert.deepEqual(
		versions.filter((version: string, index: number): boolean => versions.indexOf(version) !== index),
		[]
	);
});

runTestCase('the version the Makefile releases has non-empty release notes', () => {
	const match: RegExpMatchArray | null = /^ONDEWO_SIP_VERSION *= *(\S+)$/m.exec(MAKEFILE);
	assert.ok(match !== null);
	const section: string[] = releaseNotesSlice(match[1]);
	assert.ok(section.length > 0, `no "${HEADING_TEXT}${match[1]}" heading in RELEASE.md`);
	const body: string[] = section.slice(1, -1).filter((line: string): boolean => line.trim() !== '');
	assert.ok(body.length > 1);
});

runTestCase('RELEASE.md is the copy of src/RELEASE.md that make build produces', () => {
	assert.equal(RELEASE_NOTES, readFileSync(join(REPO_ROOT, 'src', 'RELEASE.md'), 'utf8'));
});
