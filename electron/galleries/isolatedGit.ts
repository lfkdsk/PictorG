// Builds a `simple-git` instance whose child `git` processes ignore
// the user's global / system git configuration. Everything the
// desktop app needs to talk to GitHub is fed in explicitly:
//
//   * authentication = OAuth token embedded in the URL on push/pull
//     (see GalleryRegistry.tokenizedUrl)
//   * commit identity = OAuth-derived `<login>` + GitHub noreply email
//     (see ensureGitIdentity in ../ipc/auth)
//   * transport tweaks for big binary push (postBuffer, HTTP/1.1)
//
// The motivation is a single class of bug: when the user's
// `~/.gitconfig` contains things like
//
//     [url "git@github.com:"]
//         insteadOf = https://github.com/
//     [credential]
//         helper = osxkeychain
//     [commit]
//         gpgsign = true
//
// our carefully-built `https://oauth2:<token>@github.com/...` URL gets
// silently rewritten into a `git@github.com:` SSH URL, the token gets
// dropped on the floor, and the push fails because the user's SSH
// keys belong to a different GitHub account (or aren't there at all).
// Same for credential helpers volunteering stale keychain tokens, and
// for SSH-format signing keys the user no longer has.
//
// Fix: tell git to forget about the user's environment for these
// invocations. We do that with three knobs:
//
//   1. `GIT_CONFIG_GLOBAL=/dev/null` (Git 2.32+) — skip ~/.gitconfig
//      entirely. No insteadOf, no helpers, no signing.
//   2. `GIT_CONFIG_NOSYSTEM=1` — same for /etc/gitconfig.
//   3. `GIT_SSH_COMMAND=<no-op>` — even if some other path reintroduces
//      an SSH URL, the SSH transport itself can't run, so it fails
//      loudly instead of silently auth'ing as the wrong user.
//
// Because we wiped the user's gitconfig, we have to re-supply
// everything we actually want, via simple-git's `config: string[]`
// (those become per-command `-c key=value` flags):
//
//   * `credential.helper=`            — defensive; nothing should ask
//                                       for credentials anyway because
//                                       the URL is tokenized, but if
//                                       something does, we don't want
//                                       a stale keychain entry.
//   * `core.askPass=`                 — never prompt interactively.
//   * `commit.gpgsign=false`          — defensive; we wiped the user
//                                       config but a future global
//                                       env knob might re-enable it.
//   * `tag.gpgsign=false`             — same.
//   * `http.postBuffer=524288000`     — 500 MB; default 1 MB is too
//                                       small for photo galleries.
//                                       Was previously injected only
//                                       at push time — now everywhere.
//   * `http.version=HTTP/1.1`         — dodge GitHub's HTTP/2
//                                       sideband-disconnect on big
//                                       chunked uploads.
//   * `user.name=…` / `user.email=…`  — only when `forCommits: true`,
//                                       because we just nuked the
//                                       global config that normally
//                                       supplies them. Identity comes
//                                       from the OAuth token (login +
//                                       noreply email).
//
// Usage:
//
//     const git = await buildIsolatedGit(localPath);
//     await git.pull(tokenizedUrl, branch);
//
//     const git = await buildIsolatedGit(localPath, { forCommits: true });
//     await git.add([...]); await git.commit(msg);
//
//     const git = await buildIsolatedGit(localPath, {
//       abort: ac.signal,
//       progress: (e) => { ... },
//     });
//     await git.clone(tokenizedUrl, dest, ['--progress']);

import simpleGit, { SimpleGit, SimpleGitProgressEvent } from 'simple-git';

import { ensureGitIdentity } from '../ipc/auth';

export type IsolatedGitOptions = {
  // If true, fetches the OAuth-derived identity and injects it as
  // `-c user.name=… -c user.email=…` so `git commit` works under the
  // wiped global config. Defaults to false to skip the network round
  // trip on read-only / push-only paths.
  forCommits?: boolean;
  // Forwarded to simple-git's abort plugin. Used by clone() so
  // cancelClone() can kill the in-flight child process.
  abort?: AbortSignal;
  // Forwarded to simple-git's progress plugin. Used by clone() to
  // stream progress events to the renderer.
  progress?: (event: SimpleGitProgressEvent) => void;
};

// Always-on `-c` config — applied to every git command this helper
// spawns. Order doesn't matter; later entries don't override earlier
// ones because each becomes its own `-c` flag.
const CORE_CONFIG: readonly string[] = Object.freeze([
  'credential.helper=',
  'core.askPass=',
  'commit.gpgsign=false',
  'tag.gpgsign=false',
  'http.postBuffer=524288000',
  'http.version=HTTP/1.1',
]);

// Always-on env overlay. Merged onto process.env so PATH, HOME, etc.
// stay intact — we only override the gitconfig/SSH/prompt knobs and
// strip a small set of inherited vars that simple-git's argv-parser
// refuses to forward (it treats GIT_EDITOR / GIT_PAGER as injection
// vectors regardless of value).
//
// `/dev/null` works on macOS + Linux; on Windows we'd need `NUL`.
// Desktop is macOS-first today (per dev doc §0); revisit when we
// ship a Windows build.
function isolationEnv(): NodeJS.ProcessEnv {
  // Start from a copy of process.env, then prune env vars that are
  // either irrelevant to non-interactive git or would trip simple-git's
  // unsafe-env plugin without us explicitly opting them in. The user
  // having `GIT_EDITOR=nvim` in their shell shouldn't break our push.
  const base: NodeJS.ProcessEnv = { ...process.env };
  delete base.GIT_EDITOR;
  delete base.GIT_PAGER;
  delete base.GIT_EXTERNAL_DIFF;
  delete base.GIT_PROXY_COMMAND;

  return {
    ...base,
    GIT_CONFIG_GLOBAL: '/dev/null',
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_SSH_COMMAND: '/usr/bin/false',
    GIT_TERMINAL_PROMPT: '0',
    // Defensive: some macOS dev environments set GIT_ASKPASS to a
    // GUI helper that pops a dialog. Force it to a no-op too.
    GIT_ASKPASS: '/usr/bin/false',
    SSH_ASKPASS: '/usr/bin/false',
  };
}

// Build a SimpleGit instance with the env + config above.
// Returns a Promise because identity resolution may need a one-shot
// network call. Cheap on subsequent invocations (cached).
export async function buildIsolatedGit(
  baseDir: string,
  options: IsolatedGitOptions = {}
): Promise<SimpleGit> {
  const config = [...CORE_CONFIG];

  if (options.forCommits) {
    const { name, email } = await ensureGitIdentity();
    // Shell-quoting isn't needed — simple-git passes each entry as
    // its own argv to git, so spaces in `name` are safe.
    config.push(`user.name=${name}`);
    config.push(`user.email=${email}`);
  }

  const git = simpleGit({
    baseDir,
    config,
    abort: options.abort,
    progress: options.progress,
    // simple-git's argv-parser refuses to forward `-c credential.helper=…`,
    // `-c core.askPass=…`, or env GIT_SSH_COMMAND unless we opt in
    // here, treating them as a class of injection vulnerability. Our
    // use is the opposite — we're *clearing* helpers and pinning SSH
    // to /usr/bin/false to neutralize host-installed defaults — but
    // the parser doesn't distinguish set-vs-clear, so we have to
    // explicitly allow each category we touch.
    unsafe: {
      allowUnsafeCredentialHelper: true,
      allowUnsafeAskPass: true,
      allowUnsafeSshCommand: true,
      // GIT_CONFIG_GLOBAL=/dev/null is the load-bearing knob of the
      // entire isolation strategy (skips ~/.gitconfig). Without this
      // flag simple-git refuses to forward it.
      allowUnsafeConfigPaths: true,
    },
  });
  // .env({...}) replaces the child env wholesale — we hand it the
  // already-merged overlay so PATH/HOME/etc. survive.
  git.env(isolationEnv());
  return git;
}
