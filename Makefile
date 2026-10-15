export
# ---------------- BEFORE RELEASE ----------------
# 1 - Update ONDEWO_SIP_VERSION / SIP_API_GIT_BRANCH below
# 2 - Add a `## Release ONDEWO SIP Typescript Client <version>` section to src/RELEASE.md
# 3 - make build, review and commit the generated code
# -------------- Release (make ondewo_release) --------------
# spc -> load the credentials -> delete the devops-accounts clone -> make release:
#   release_preflight (credentials valid, version unreleased, notes present, host tools)
#   -> build -> check_build -> release_tests -> pre-commit -> local commit
#   -> check_tag_matches_package -> npm publish -> check_npm_published
#   -> git push -> release branch -> tag -> GitHub release -> release_verify
# Pinned by tests/releaseOrder.spec.ts.

########################################################
# 		Variables
########################################################

ONDEWO_SIP_VERSION=5.5.2

SIP_API_GIT_BRANCH=tags/5.5.2
# Must name the tag the committed ondewo-proto-compiler submodule points at, otherwise
# check_out_correct_submodule_versions checks the submodule BACK to the older tag.
ONDEWO_PROTO_COMPILER_GIT_BRANCH=tags/5.15.7
ONDEWO_PROTO_COMPILER_DIR=ondewo-proto-compiler
# The compiler image is tagged with the compiler version instead of `latest`.
PROTO_COMPILER_VERSION=$(patsubst tags/%,%,$(ONDEWO_PROTO_COMPILER_GIT_BRANCH))
PROTO_COMPILER_IMAGE=ondewo-typescript-proto-compiler:$(PROTO_COMPILER_VERSION)
# The codegen container runs as root and writes into this scratch directory, never into the
# repository root, so nothing else in the checkout is mounted into it.
CODEGEN_OUTPUT_DIR=.codegen-output
SIP_APIS_DIR=src/ondewo-sip-api
SIP_PROTOS_DIR=${SIP_APIS_DIR}/ondewo
GOOGLE_APIS_DIR=${SIP_APIS_DIR}/googleapis
GOOGLE_PROTOS_DIR=${GOOGLE_APIS_DIR}/google
GITHUB_GH_TOKEN?=
NPM_AUTOMATION_TOKEN?=
NPM_PACKAGE=@ondewo/sip-client-typescript
NPM_REGISTRY=https://registry.npmjs.org/
# release_verify polls npm this many times, this many seconds apart. VERIFY_ATTEMPTS / VERIFY_INTERVAL_S are
# the names the release driver passes to every client; NPM_VERIFY_* still work and win when set.
VERIFY_ATTEMPTS?=20
VERIFY_INTERVAL_S?=30
NPM_VERIFY_ATTEMPTS?=$(VERIFY_ATTEMPTS)
NPM_VERIFY_INTERVAL_S?=$(VERIFY_INTERVAL_S)
IMAGE_UTILS_NAME=ondewo-sip-client-utils-typescript:${ONDEWO_SIP_VERSION}
# The `tools` stage of Dockerfile.utils: node/npm, make and gh, no repository content.
IMAGE_TOOLS_NAME=ondewo-sip-client-tools-typescript:${ONDEWO_SIP_VERSION}
PRETTIER_WRITE?=

# Steps that need no credential run without them: npm ci (third-party install scripts), the test suite,
# the pre-commit hooks, git. Only release_preflight, the npm publish, the GitHub release and
# release_verify see a token, each inside its own container.
WITHOUT_CREDENTIALS=env -u GITHUB_GH_TOKEN -u NPM_AUTOMATION_TOKEN -u GH_TOKEN
# node/npm run on the host when it has them, otherwise in the pinned tools image (as the invoking user).
HOST_HAS_NODE:=$(shell command -v node >/dev/null 2>&1 && command -v npm >/dev/null 2>&1 && echo yes)
NODE_EXEC=$(if $(HOST_HAS_NODE),,docker run --rm --user $$(id -u):$$(id -g) -e HOME=/tmp -v "$(CURDIR)":"$(CURDIR)" -w "$(CURDIR)" $(IMAGE_TOOLS_NAME))

# The GitHub release body: the section of RELEASE.md whose heading is exactly this version.
RELEASE_NOTES_SLICE=perl -ne 'print if /^\#+ Release ONDEWO SIP Typescript Client \Q${ONDEWO_SIP_VERSION}\E$$/../^\*{5}/'
CURRENT_RELEASE_NOTES=`cat RELEASE.md | $(RELEASE_NOTES_SLICE)`

GH_REPO="https://github.com/ondewo/ondewo-sip-client-typescript"
GH_REPO_SLUG=ondewo/ondewo-sip-client-typescript
DEVOPS_ACCOUNT_GIT=ondewo-devops-accounts
# Set by the ondewo-sip-api release driver to its single temporary clone; empty means clone here.
DEVOPS_ACCOUNT_DIR?=
# Non-empty under `make -n`. make runs a recipe line containing $(MAKE) even then, so ondewo_release
# checks it to keep a dry run away from the devops-accounts clone and the credentials.
DRY_RUN:=$(findstring n,$(firstword -$(MAKEFLAGS)))
# release_preflight and release_verify also run standalone (the sip-api driver calls them with only
# DEVOPS_ACCOUNT_DIR set): a recipe line that needs a token starts with this, which loads the anchored
# `^NAME=` lines from that directory when the environment does not already carry both tokens.
LOAD_CREDENTIALS=if { [ -z "$$GITHUB_GH_TOKEN" ] || [ -z "$$NPM_AUTOMATION_TOKEN" ]; } && [ -n "$(DEVOPS_ACCOUNT_DIR)" ] && [ -d "$(DEVOPS_ACCOUNT_DIR)" ]; then set -a; eval "$$(grep -h -E '^(GITHUB_GH_TOKEN|NPM_AUTOMATION_TOKEN)=' "$(DEVOPS_ACCOUNT_DIR)/account_github.env" "$(DEVOPS_ACCOUNT_DIR)/account_npm.env")"; set +a; fi
.DEFAULT_GOAL := help

########################################################
#       ONDEWO Standard Make Targets
########################################################

setup_developer_environment_locally: install_packages install_precommit_hooks ## Installs all needed packages and precommit hooks

install_packages: ## Install npm packages
	npm ci

install_precommit_hooks: ## Install precommit hooks
	npx husky install
	uv tool install pre-commit || pipx install pre-commit || pip install --user pre-commit

run_precommit_hooks: ## Runs all precommit hooks
	.husky/pre-commit

prettier: ensure_node_toolchain ## Checks formatting with Prettier - Use PRETTIER_WRITE=-w to also automatically apply corrections where needed
	$(NODE_EXEC) node_modules/.bin/prettier --config .prettierrc --check --ignore-path .prettierignore $(PRETTIER_WRITE) ./

eslint: ensure_node_toolchain ## Checks Code Logic and Typing
	$(NODE_EXEC) ./node_modules/.bin/eslint --config eslint.config.mjs .

TEST: ## Prints some important variables
	@echo "Release Notes: \n \n$(CURRENT_RELEASE_NOTES)"
	@echo "GH Token: \t $(if $(GITHUB_GH_TOKEN),<set>,<unset>)"
	@echo "NPM Token: \t $(if $(NPM_AUTOMATION_TOKEN),<set>,<unset>)"

help: ## Print usage info about help targets
	# (first comment after target starting with double hashes ##)
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' Makefile | sort | awk 'BEGIN {FS = ":.*?## "}; {printf "\033[36m%-40s\033[0m %s\n", $$1, $$2}'

makefile_chapters: ## Shows all sections of Makefile
	@echo `cat Makefile| grep "########################################################" -A 1 | grep -v "########################################################"`

check_build: ## Checks if all built proto-code is there
	@rm -rf build_check.txt
	@for proto in `find src/ondewo-sip-api/ondewo -iname "*.proto*"`; \
	do \
		cat $${proto} | grep import | grep "google/" | cut -d "/" -f 3 | cut -d "." -f 1 >> build_check.txt; \
		perl -i -pe 's/import.*//g' build_check.txt; \
		echo $${proto} | cut -d "/" -f 5 | cut -d "." -f 1 >> build_check.txt; \
	done
	@echo "`sort build_check.txt | uniq`" > build_check.txt
	@for file in `cat build_check.txt`;\
	do \
		find api -iname "*pb*" | grep -q $${file}; \
		if test $$? != 0; then  echo "No Proto-Code for $${file}" & exit 1;fi \
	done
	@rm -rf build_check.txt

########################################################
#       Repo Specific Make Targets
########################################################

########################################################
#		Release

# The order is pinned by tests/releaseOrder.spec.ts: nothing is committed before the suite is green,
# nothing is pushed before npm serves the version, and a failed publish leaves origin untouched.
release: ## Create the npm and GitHub release (make ondewo_release loads the credentials)
	@echo "Start Release"
	$(MAKE) release_preflight
	$(WITHOUT_CREDENTIALS) $(MAKE) build
	$(WITHOUT_CREDENTIALS) $(MAKE) check_build
	$(WITHOUT_CREDENTIALS) $(MAKE) release_tests
	$(WITHOUT_CREDENTIALS) $(MAKE) run_precommit_hooks
	git status
	git add api
	git add Makefile
	git add src
# auth/ is the hand-written Keycloak provider and its spec, and README.md is a BUILD OUTPUT
# (`make build` runs `cp src/README.md .`). Both are top-level, so `git add src` covers
# neither: leaving them out publishes a change to npm while the git tag of that same version
# does not contain it, and destroys anything written only in the root README on the next build.
	git add auth
# tests/ and .ci-package.json are NOT packaged, but a regression test written alongside a fix
# must reach the repository or CI never runs it.
	git add tests .ci-package.json
	git add README.md
	git add RELEASE.md
	git add package.json
	git add package-lock.json
# public-api.d.ts / public-api.js are BUILD OUTPUTS: the codegen rewrites the entry point (and its auth/
# re-exports) on every build, and npm/ ships that copy, so the tag must hold the same files.
	git add public-api.d.ts public-api.js
	git add ${ONDEWO_PROTO_COMPILER_DIR}
	git add ${SIP_APIS_DIR}
	git status
# An empty commit is skipped (a re-run after the content was committed by hand), but a FAILING
# commit stops the release: `-git commit` used to swallow it and publish anyway.
	$(WITHOUT_CREDENTIALS) git diff --cached --quiet || $(WITHOUT_CREDENTIALS) git commit --no-verify -m "Preparing for Release ${ONDEWO_SIP_VERSION}"
	$(WITHOUT_CREDENTIALS) $(MAKE) check_tag_matches_package
	$(MAKE) publish_npm_via_docker
	$(MAKE) check_npm_published
	$(WITHOUT_CREDENTIALS) git push
	$(WITHOUT_CREDENTIALS) $(MAKE) create_release_branch
	$(WITHOUT_CREDENTIALS) $(MAKE) create_release_tag
	$(MAKE) release_to_github_via_docker_image
	$(MAKE) release_verify
	@echo "Finished Release"

# Read-only. Everything the release will need is checked BEFORE anything is built, committed, pushed or
# published, so a bad token or an already-released version costs nothing.
#  (1) credentials present and VALID: npm whoami (throw-away userconfig, npm reads the token from the
#      environment), and the GitHub token can push to this repository; git can push over SSH;
#  (2) the version is not a tag / release branch here or on origin (spc) and npm does not serve it;
#  (3) src/RELEASE.md has a non-empty section headed exactly `Release ONDEWO SIP Typescript Client <V>`;
#  (4) the host tools the release needs exist (node/npm fall back to the tools image).
release_preflight: spc build_tools_docker_image ## Read-only: credentials valid, version unreleased, notes present, host tools present
	@echo "START release_preflight ${ONDEWO_SIP_VERSION}"
	@for tool in docker make git perl curl; do \
		command -v $$tool >/dev/null 2>&1 || { echo "ERROR: the release needs '$$tool' on the host"; exit 1; }; \
	done; echo "-- host tools: docker make git perl curl present; node/npm: $(if $(HOST_HAS_NODE),host,tools image)"
	@$(LOAD_CREDENTIALS); test -n "$$GITHUB_GH_TOKEN" || { echo "ERROR: GITHUB_GH_TOKEN is not set"; exit 1; }
	@$(LOAD_CREDENTIALS); test -n "$$NPM_AUTOMATION_TOKEN" || { echo "ERROR: NPM_AUTOMATION_TOKEN is not set"; exit 1; }
	@$(LOAD_CREDENTIALS); user=$$(docker run --rm -e NPM_AUTOMATION_TOKEN $(IMAGE_TOOLS_NAME) sh -c 'umask 077 && c=$$(mktemp) && printf "%s\n" "//registry.npmjs.org/:_authToken=\$${NPM_AUTOMATION_TOKEN}" > "$$c" && npm whoami --userconfig "$$c" --registry $(NPM_REGISTRY) 2>/dev/null') \
		&& test -n "$$user" \
		|| { echo "ERROR: npm rejects NPM_AUTOMATION_TOKEN (npm whoami failed)"; exit 1; }; \
		echo "-- npm: the token authenticates as $$user"
	@$(LOAD_CREDENTIALS); push=$$(docker run --rm -e GITHUB_GH_TOKEN $(IMAGE_TOOLS_NAME) sh -c 'GH_TOKEN="$$GITHUB_GH_TOKEN" gh api repos/$(GH_REPO_SLUG) --jq .permissions.push 2>/dev/null'); \
		test "$$push" = "true" || { echo "ERROR: GITHUB_GH_TOKEN cannot push to $(GH_REPO_SLUG) (gh answered: '$$(printf '%s' "$$push" | tr -s '[:space:]' ' ')')"; exit 1; }; \
		echo "-- GitHub: the token can push to $(GH_REPO_SLUG)"
	@$(WITHOUT_CREDENTIALS) git push --dry-run --quiet origin HEAD || { echo "ERROR: git cannot push to origin"; exit 1; }; \
		echo "-- git: push to origin works"
	@out=$$(docker run --rm $(IMAGE_TOOLS_NAME) sh -c 'npm view "$(NPM_PACKAGE)@${ONDEWO_SIP_VERSION}" version --registry $(NPM_REGISTRY) 2>&1'); rc=$$?; \
		if [ $$rc -eq 0 ]; then echo "ERROR: npm already serves $(NPM_PACKAGE)@${ONDEWO_SIP_VERSION}"; exit 1; fi; \
		printf '%s\n' "$$out" | grep -q E404 || { echo "ERROR: cannot query npm for $(NPM_PACKAGE)@${ONDEWO_SIP_VERSION}:"; printf '%s\n' "$$out"; exit 1; }; \
		echo "-- npm: ${ONDEWO_SIP_VERSION} is not published yet"
	@$(RELEASE_NOTES_SLICE) src/RELEASE.md | sed 1d | grep -v '^\*\{5\}' | grep -q '[^[:space:]]' \
		|| { echo "ERROR: src/RELEASE.md has no non-empty '## Release ONDEWO SIP Typescript Client ${ONDEWO_SIP_VERSION}' section"; exit 1; }; \
		echo "-- release notes: src/RELEASE.md has a non-empty ${ONDEWO_SIP_VERSION} section"
	@echo "DONE release_preflight: nothing was built, committed, pushed or published"

# npm ci (not npm install): the lockfile the release commits is the one that is tested. No credential
# reaches the third-party install scripts or the tests.
release_tests: ensure_node_toolchain ## npm ci + the full test suite (auth, examples, protos, release notes/order/credentials)
	$(WITHOUT_CREDENTIALS) $(NODE_EXEC) npm ci --no-audit --no-fund
	$(WITHOUT_CREDENTIALS) $(NODE_EXEC) npm test

# Every file `npm pack` ships must be committed and byte-equal at HEAD, so the git tag holds exactly
# what npm serves. Exempt, with the reason:
#   package.json, README.md -- create_npm_package derives them (scripts stripped, GitHub-only part cut);
#   auth/{offlineTokenProvider,grpcWebEndpoint}.{js,d.ts} -- compiled from the committed auth/*.ts by
#     create_npm_package (tsc pinned by package-lock.json); their SOURCES must be committed and equal.
check_tag_matches_package: ensure_node_toolchain ## Every file npm/ ships is committed and byte-equal at HEAD
	@files=$$($(NODE_EXEC) npm pack ./npm --dry-run --json --ignore-scripts 2>/dev/null \
		| perl -MJSON::PP -0777 -ne 'print map { "$$_->{path}\n" } map { @{$$_->{files}} } @{decode_json($$_)}'); \
	test -n "$$files" || { echo "ERROR: npm pack --dry-run listed no files"; exit 1; }; \
	bad=0; count=0; \
	for f in $$files; do \
		case "$$f" in \
			package.json|README.md) continue ;; \
			auth/offlineTokenProvider.js|auth/offlineTokenProvider.d.ts|auth/grpcWebEndpoint.js|auth/grpcWebEndpoint.d.ts) \
				src="$${f%.d.ts}"; src="$${src%.js}.ts" ;; \
			*) src="$$f" ;; \
		esac; \
		count=$$((count+1)); \
		if ! git ls-files --error-unmatch -- "$$src" >/dev/null 2>&1; then echo "NOT COMMITTED: $$src (ships as $$f)"; bad=1; \
		elif [ "$$src" = "$$f" ] && ! git show "HEAD:$$f" | cmp -s - "npm/$$f"; then echo "DIFFERS FROM HEAD: $$f"; bad=1; \
		elif [ "$$src" != "$$f" ] && ! git show "HEAD:$$src" | cmp -s - "$$src"; then echo "SOURCE DIFFERS FROM HEAD: $$src"; bad=1; fi; \
	done; \
	test $$bad -eq 0 || { echo "ERROR: the npm package does not match HEAD"; exit 1; }; \
	echo "check_tag_matches_package: $$count shipped files match HEAD"

# Read-only: npm serves the version (polled, the registry is eventually consistent).
check_npm_published: build_tools_docker_image ## Polls npm until it serves ONDEWO_SIP_VERSION
	@docker run --rm $(IMAGE_TOOLS_NAME) sh -c 'i=1; while [ $$i -le $(NPM_VERIFY_ATTEMPTS) ]; do \
		v=$$(npm view "$(NPM_PACKAGE)@${ONDEWO_SIP_VERSION}" version --registry $(NPM_REGISTRY) 2>/dev/null); \
		if [ "$$v" = "${ONDEWO_SIP_VERSION}" ]; then echo "npm serves $(NPM_PACKAGE)@$$v"; exit 0; fi; \
		echo "npm does not serve $(NPM_PACKAGE)@${ONDEWO_SIP_VERSION} yet ($$i/$(NPM_VERIFY_ATTEMPTS))"; \
		i=$$((i+1)); sleep $(NPM_VERIFY_INTERVAL_S); done; \
		echo "ERROR: npm never served $(NPM_PACKAGE)@${ONDEWO_SIP_VERSION}"; exit 1'

# Read-only, after the release: the tag is on origin, the GitHub release has a non-empty body, npm serves
# the version.
release_verify: build_tools_docker_image ## Read-only: tag on origin, GitHub release body non-empty, npm serves the version
	@git ls-remote --exit-code --tags origin "refs/tags/${ONDEWO_SIP_VERSION}" >/dev/null \
		|| { echo "ERROR: tag ${ONDEWO_SIP_VERSION} is not on origin"; exit 1; }; echo "-- tag ${ONDEWO_SIP_VERSION} is on origin"
	@$(LOAD_CREDENTIALS); docker run --rm -e GITHUB_GH_TOKEN $(IMAGE_TOOLS_NAME) sh -c 'GH_TOKEN="$$GITHUB_GH_TOKEN" gh release view "${ONDEWO_SIP_VERSION}" --repo $(GH_REPO_SLUG) --json body --jq .body' \
		| grep -q '[^[:space:]]' || { echo "ERROR: GitHub release ${ONDEWO_SIP_VERSION} is missing or has an empty body"; exit 1; }; \
		echo "-- GitHub release ${ONDEWO_SIP_VERSION} has notes"
	$(MAKE) check_npm_published

gh_release: release_to_github_via_docker_image ## Builds Utils Image and Releases to Github

npm_release: ## Releases to NPM
	@echo "Start NPM Release"
	npm publish ./npm --access public
	@echo "Finished NPM Release"

create_release_branch: ## Create Release Branch and push it to origin
	git checkout -b "release/${ONDEWO_SIP_VERSION}"
	git push -u origin "release/${ONDEWO_SIP_VERSION}"

create_release_tag: ## Create Release Tag and push it to origin
	git tag -a ${ONDEWO_SIP_VERSION} -m "release/${ONDEWO_SIP_VERSION}"
	git push origin ${ONDEWO_SIP_VERSION}

# "$${GITHUB_GH_TOKEN}" is expanded by the shell from the environment. $(GITHUB_GH_TOKEN) would be
# expanded by make INTO the recipe line, i.e. onto the argv of `/bin/sh -c`. gh reads GH_TOKEN per call;
# nothing is written to a gh config.
build_gh_release: ## Generate Github Release with CLI (refuses empty notes)
	@test -n "$(CURRENT_RELEASE_NOTES)" || { echo "ERROR: no 'Release ONDEWO SIP Typescript Client $(ONDEWO_SIP_VERSION)' section in RELEASE.md"; exit 1; }
	GH_TOKEN="$${GITHUB_GH_TOKEN}" gh release create --repo $(GH_REPO) "$(ONDEWO_SIP_VERSION)" -n "$(CURRENT_RELEASE_NOTES)" -t "Release ${ONDEWO_SIP_VERSION}"

########################################################
#		Docker

push_to_gh: build_gh_release ## Releases to Github
	@echo 'Released to Github'

build_compiler: ## Builds Ondewo-Proto-Compiler, tagged with its version
	docker build --no-cache -t $(PROTO_COMPILER_IMAGE) ondewo-proto-compiler/typescript

release_to_github_via_docker_image: build_utils_docker_image ## Release to Github via docker
	@docker run --rm \
		-e GITHUB_GH_TOKEN \
		${IMAGE_UTILS_NAME} make push_to_gh

build_utils_docker_image: ## Build utils docker image (needs npm/ from make build)
	docker build --target release -f Dockerfile.utils -t ${IMAGE_UTILS_NAME} .

build_tools_docker_image: ## Build the tools-only image (node/npm, make, gh) used by preflight, verify and the node fallback
	docker build --quiet --target tools -f Dockerfile.utils -t ${IMAGE_TOOLS_NAME} . >/dev/null

ensure_node_toolchain: ## Builds the tools image when the host has no node/npm
	$(if $(HOST_HAS_NODE),@true,$(MAKE) build_tools_docker_image)

publish_npm_via_docker: build_utils_docker_image ## Builds Code, Docker-Image and Releases to NPM
	@docker run --rm \
		-e NPM_AUTOMATION_TOKEN \
		${IMAGE_UTILS_NAME} make docker_npm_release

# npm reads the literal `${NPM_AUTOMATION_TOKEN}` from .npmrc and substitutes the environment value,
# so the token itself never appears on npm's argv.
docker_npm_release: ## Release to npm with docker image
	node --version
	npm --version
	@npm config set '//registry.npmjs.org/:_authToken' '$${NPM_AUTOMATION_TOKEN}'
	npm whoami
	make npm_release

########################################################
#		DEVOPS-ACCOUNTS

# The credentials are exported into the sub-make's ENVIRONMENT (anchored `^NAME=` lines only, so a
# comment mentioning a name cannot break a value). `make release NAME=<value>` would put every value
# on make's argv, which /proc/<pid>/cmdline shows to every user on the host.
# The clone lives in a temporary directory OUTSIDE the repository (so no build step can mount it) and is
# deleted as soon as the values are loaded, before `$(MAKE) release`; the trap deletes it on a failure.
# DEVOPS_ACCOUNT_DIR (set by the ondewo-sip-api driver to its own clone) is used as is and left alone.
ondewo_release: spc ## Release with credentials from devops-accounts repo
	@set -e; \
	if [ -n "$(DRY_RUN)" ]; then echo "dry run: devops-accounts not cloned, no credentials loaded"; $(MAKE) release; exit 0; fi; \
	if [ -n "$(DEVOPS_ACCOUNT_DIR)" ] && [ -d "$(DEVOPS_ACCOUNT_DIR)" ]; then \
		accounts="$(DEVOPS_ACCOUNT_DIR)"; clone_dir=; \
	else \
		clone_dir=$$(mktemp -d); trap 'rm -rf "$$clone_dir"' EXIT INT TERM; \
		accounts="$$clone_dir/$(DEVOPS_ACCOUNT_GIT)"; \
		git clone --quiet --depth 1 git@bitbucket.org:ondewo/$(DEVOPS_ACCOUNT_GIT).git "$$accounts"; \
	fi; \
	set -a; \
	eval "$$(grep -h -E '^(GITHUB_GH_TOKEN|NPM_AUTOMATION_TOKEN)=' "$$accounts/account_github.env" "$$accounts/account_npm.env")"; \
	set +a; \
	if [ -n "$$clone_dir" ]; then rm -rf "$$clone_dir"; fi; \
	$(MAKE) release

# Read-only, anchored: an existing `15.5.0` tag or `release/5.5.0x` branch does not block 5.5.0.
spc: ## Checks that the release branch and tag do not exist yet (locally and on origin)
	@if git rev-parse -q --verify "refs/tags/${ONDEWO_SIP_VERSION}" >/dev/null; then echo "-- Test 1: Tag ${ONDEWO_SIP_VERSION} exists locally!!"; exit 1; fi
	@if git rev-parse -q --verify "refs/heads/release/${ONDEWO_SIP_VERSION}" >/dev/null; then echo "-- Test 2: Branch release/${ONDEWO_SIP_VERSION} exists locally!!"; exit 1; fi
	@rc=0; git ls-remote --exit-code --heads origin "refs/heads/release/${ONDEWO_SIP_VERSION}" >/dev/null || rc=$$?; \
	case $$rc in \
		0) echo "-- Test 3: Branch release/${ONDEWO_SIP_VERSION} exists on origin!!"; exit 1 ;; \
		2) echo "-- Test 3: Branch is fine" ;; \
		*) echo "ERROR: cannot query origin (git ls-remote exit $$rc)"; exit 1 ;; \
	esac
	@rc=0; git ls-remote --exit-code --tags origin "refs/tags/${ONDEWO_SIP_VERSION}" >/dev/null || rc=$$?; \
	case $$rc in \
		0) echo "-- Test 4: Tag ${ONDEWO_SIP_VERSION} exists on origin!!"; exit 1 ;; \
		2) echo "-- Test 4: Tag is fine" ;; \
		*) echo "ERROR: cannot query origin (git ls-remote exit $$rc)"; exit 1 ;; \
	esac

########################################################
# Build

update_package: ## Updates Package Version in src/package.json
	@perl -i -pe "s/\"version\": \"[0-9]+\.[0-9]+\.[0-9]+\"/\"version\": \"${ONDEWO_SIP_VERSION}\"/g" src/package.json

build: check_out_correct_submodule_versions build_compiler update_package npm_run_build ## Build Code with Proto-Compiler
	-cd src/ondewo-sip-api && git checkout -- '**/*.proto' && cd ../..
	cp src/README.md .
	cp src/RELEASE.md .
	make restore_ci_test_setup
# Before create_npm_package: it compiles auth/ with `npx tsc`, and in a fresh clone (the release driver's)
# with no node_modules npx fetches the unrelated `tsc` package instead of the pinned typescript.
	make install_dependencies
	make create_npm_package
	make remove_npm_script
	@$(eval README_CUT_LINES:=$(shell cat -n src/README.md | perl -ne 'print if /START OF GITHUB README/../END OF GITHUB README/' | grep -o -E '[0-9]+' | perl -pe 's/^0+//' | awk 'NR==1; END{print}'))
	@$(eval DELETE_LINES:=$(shell echo ${README_CUT_LINES}| perl -pe "s/[[:space:]]/,/"))
	@perl -i -ne 'BEGIN{($$s,$$e)=split/,/,"${DELETE_LINES}"} print unless $$. >= $$s && $$. <= $$e' npm/README.md
	# rm -rf ${SIP_APIS_DIR}/google

remove_npm_script: ## Removes the scripts section from the npm/ package.json copy (root package.json is left intact)
	@test -f npm/package.json || make create_npm_package
	$(eval script_lines:= $(shell cat npm/package.json 2>/dev/null | perl -ne 'print "$$.\n" if /\"scripts\"/../\}\,/'))
	$(eval start:= $(shell echo "$(script_lines)" | awk '{print $$1}'))
	$(eval end:= $(shell echo "$(script_lines)" | awk '{print $$NF}'))
	@if [ -n "$(start)" ] && [ -n "$(end)" ]; then perl -i -ne 'print unless $$. >= $(start) && $$. <= $(end)' npm/package.json; fi

create_npm_package: ensure_node_toolchain ## Create NPM Package for Release
	rm -rf npm
	mkdir npm
	cp -R api npm
	cp public-api.d.ts npm
	cp public-api.js npm
	cp package.json npm
	cp LICENSE npm
	cp README.md npm
	mkdir -p npm/auth
	$(NODE_EXEC) npx tsc auth/offlineTokenProvider.ts --ignoreConfig --declaration --module commonjs --target es2020 --strict --lib es2020,dom --skipLibCheck --types node --typeRoots ./node_modules/@types --rootDir auth --outDir npm/auth

# src/package.json (the codegen's source) carries the dev dependencies, so the regenerated root
# package.json keeps them and this only syncs node_modules with the lockfile. It used to
# `npm i --save-dev <names>`, which re-resolved them to the newest release at every build.
install_dependencies: ensure_node_toolchain ## Installs the dependencies the lockfile pins
	$(NODE_EXEC) npm install --no-audit --no-fund

# Only the api submodule's committed tag is used: `make -C src/ondewo-sip-api build` is NOT called,
# because that target commits and pushes ondewo-sip-api whenever it is checked out on a branch.
check_out_correct_submodule_versions: ## Fetches all Submodules and checks out specified branch
	@echo "START checking out correct submodule versions ..."
	git submodule update --init --recursive
	git -C ${SIP_APIS_DIR} fetch --all
	git -C ${SIP_APIS_DIR} checkout ${SIP_API_GIT_BRANCH}
	git -C ${ONDEWO_PROTO_COMPILER_DIR} fetch --all
	git -C ${ONDEWO_PROTO_COMPILER_DIR} checkout ${ONDEWO_PROTO_COMPILER_GIT_BRANCH}
	@echo "DONE checking out correct submodule versions."

# The compiler reads src/ (read-only) and writes into $(CODEGEN_OUTPUT_DIR), which it hands back to the
# invoking user before it exits, so no file in the checkout ends up owned by root and no `sudo` is needed.
# The repository root is never mounted, so nothing else in it (e.g. a devops-accounts clone) is exposed.
npm_run_build: ## Runs the proto compiler and copies its output into the repository
	@echo "START proto compilation ..."
	rm -rf $(CODEGEN_OUTPUT_DIR) && mkdir -p $(CODEGEN_OUTPUT_DIR)/auth
# The compiler appends `export * from './auth/<module>'` to public-api.* for every module it finds in
# <output>/auth, so the hand-written providers (not their specs) are seeded into the scratch output.
	find auth -maxdepth 1 -type f -name '*.ts' ! -name '*.spec.ts' -exec cp {} $(CODEGEN_OUTPUT_DIR)/auth/ \;
	docker run --rm \
		-v "$(CURDIR)/src":/input-volume:ro \
		-v "$(CURDIR)/$(CODEGEN_OUTPUT_DIR)":/output-volume \
		--entrypoint bash $(PROTO_COMPILER_IMAGE) \
		-c 'bash compile-proto-2-typescript.sh ondewo-sip-api ondewo; rc=$$?; chown -R "$(shell id -u):$(shell id -g)" /output-volume; exit $$rc'
# The compiler also runs its own `npm install` in its output: that node_modules/ and freshly resolved
# package-lock.json are dropped, so the committed lockfile stays the one the release tests and commits.
	rm -rf $(CODEGEN_OUTPUT_DIR)/node_modules $(CODEGEN_OUTPUT_DIR)/package-lock.json
	rm -rf api
	cp -R $(CODEGEN_OUTPUT_DIR)/. .
	rm -rf $(CODEGEN_OUTPUT_DIR)
	@echo "DONE proto compilation."

restore_ci_test_setup: ensure_node_toolchain ## Re-add CI test scripts + devDeps (from .ci-package.json) stripped by the proto-compiler root regen
	@$(NODE_EXEC) node -e 'const fs=require("fs");if(!fs.existsSync(".ci-package.json")){console.log("no .ci-package.json, skipping");process.exit(0)}const p=JSON.parse(fs.readFileSync("package.json","utf8"));const c=JSON.parse(fs.readFileSync(".ci-package.json","utf8"));p.scripts=Object.assign({},p.scripts||{},c.scripts||{});p.dependencies=Object.assign({},p.dependencies||{},c.dependencies||{});p.devDependencies=Object.assign({},p.devDependencies||{},c.devDependencies||{});if(c.description)p.description=c.description;fs.writeFileSync("package.json",JSON.stringify(p,null,2)+"\n");console.log("restore-ci-package: merged CI test setup; scripts=["+Object.keys(p.scripts).join(",")+"]")'
