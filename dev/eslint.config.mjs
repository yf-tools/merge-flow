/**
 * SonarJS audit config for gitlab-mr-review.
 *
 * Committed on purpose, while its dependencies deliberately are not. A lint config *is*
 * the shared standard: kept only on one machine, one person's hand-picked rules and the
 * next contributor's choices drift apart and the linter stops meaning anything. The
 * packages are the part that must never land in the repo, and `.gitignore` already
 * excludes `node_modules/`. Size is the reason to care: this power ships as 41 files and
 * about 3 MB, while eslint plus this plugin is 16,472 files and 79.9 MB.
 *
 * ## This is an audit, not a gate
 *
 * `node dev/test.mjs` is the gate. It runs in seconds, needs no network, and every check
 * in it exists because something broke. This config is for an occasional deeper look.
 *
 * Three reasons it is not wired into the commit path:
 *
 *   1. It is already overridden. `testWorkflowPolicyContracts` in test.mjs sits at
 *      cognitive complexity 32 against the 15 below. A limit you routinely exceed is
 *      documentation, not enforcement, and pretending otherwise trains people to ignore
 *      a red result.
 *   2. It has proven unreliable to invoke. Across one working session the CLI returned
 *      empty output four or five times and one 300-second run was killed rather than
 *      finishing. A check you cannot reliably run is worse than no check, because you
 *      stop trusting the green.
 *   3. What it catches here is mostly advisory. Measured over a real session it found one
 *      cosmetic nesting issue, two over-complex functions worth splitting, and one regex
 *      it judged unsafe. The bugs that actually shipped were caught by test.mjs.
 *
 * ## When a rule earns its keep, move it into the suite
 *
 * `slow-regex` did. It flagged a fenced-block pattern, and chasing that produced
 * something better than the rule: `testInputRobustness` in dev/test.mjs now times every
 * function that parses untrusted input against adversarial inputs, and asserts a real
 * time budget. That is direct evidence rather than a heuristic, it runs with the suite,
 * and it needs no packages. Prefer that path over adding a rule here.
 *
 * ## Running it
 *
 *   1. mkdir a scratch directory OUTSIDE this repo
 *   2. npm init -y && npm i -D eslint@9 eslint-plugin-sonarjs@2
 *   3. copy this file and the sources you want checked into it
 *   4. npx eslint --format json --output-file result.json <files>
 *
 * Step 3 is a copy rather than pointing eslint at this repo on purpose: the packages live
 * in the scratch directory, and flat config resolves a plugin relative to the config file,
 * so a config sitting here could not find them.
 *
 * Step 4 uses `--output-file` on purpose: reading the report from disk is the only form
 * that worked reliably. If the CLI comes back empty, drive it through eslint's Node API
 * instead of retrying the command.
 */
import sonarjs from "eslint-plugin-sonarjs";

export default [
  {
    files: ["**/*.mjs", "**/*.js"],
    languageOptions: { ecmaVersion: 2023, sourceType: "module" },
    plugins: { sonarjs },
    rules: {
      // Caught a real backtracking risk in a fenced-block pattern. The lasting fix was
      // `testInputRobustness` in test.mjs, which measures instead of guessing; this stays
      // because it points at candidates that measurement should then settle.
      "sonarjs/slow-regex": "error",

      // Advisory. Splitting two functions on its say-so genuinely improved them, but
      // test.mjs itself is at 32, so this cannot be an error without a grandfather clause
      // that would hollow it out.
      "sonarjs/cognitive-complexity": ["warn", 15],

      // Style, and the reason it is here is that a human asked for exactly this refactor
      // once. Cheap to keep honest.
      "sonarjs/no-nested-template-literals": "warn",
      "sonarjs/no-nested-conditional": "warn",

      // Duplication is handled better by the explicit drift assertions in test.mjs, which
      // name *which* copies must agree and why. This only hints.
      "sonarjs/no-identical-functions": "warn",

      // Both scripts spawn `git`/`glab`. They resolve to an absolute path in-process and
      // never pass a shell string, and test.mjs asserts both properties, so this is a
      // second opinion rather than the control.
      "sonarjs/os-command": "warn",
    },
  },
];
