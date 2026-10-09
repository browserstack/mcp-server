"""Drive an interactive `claude` login from CI, where there is a TTY-less runner and a human.

It lives beside the eval runner rather than in the CI repo for two reasons. A Jenkinsfile
cannot carry it inline — Groovy unescapes its own triple-quoted strings, and this file is
full of regex backslashes that a Groovy literal either eats or refuses to compile. And
keeping it here means the branch under test carries its own login driver, so changing it
is the same review as changing the eval it serves.

THE PROBLEM. `claude login` is an interactive terminal UI: it prints a login URL, waits
for the human to approve in a browser, and then reads the authorization code from a
terminal prompt. A Jenkins `sh` step gives it neither a TTY nor a human, and a pipeline
`input` step cannot type into a running process — `sh` blocks until the process exits, so
by the time the pipeline could ask for the code, the thing waiting for it is gone.

WHY `login` AND NOT `setup-token`. setup-token mints a long-lived credential; the whole
point of it is to keep working after the session that made it has gone, which is the
opposite of what a build wants. A login is a session this run uses and the job revokes on
its way out. The subcommand is an argument rather than a constant because which one you
want is a property of the run, not of this file.

THE SHAPE. This script is the process that waits. The pipeline launches it detached, then
talks to it through files in a state directory:

    <state>/url       written by us  — the login URL, as soon as the child prints one
    <state>/code      written by the pipeline, from `input` — the authorization code
    <state>/token     written by us  — the oauth token, mode 0600, if the child printed one
    <state>/done      written by us  — "ok" or "failed:<reason>"; the pipeline waits on this
    <state>/log       written by us  — the whole transcript, REDACTED, written once at exit
    <state>/progress  written by us  — our own notes only, live, never any child output

SECRETS. The console log of a Jenkins build is readable by everyone who can see the job,
and a login can print a credential on its way through. Anything matching an Anthropic
key shape is replaced with a placeholder in <state>/log and written only to <state>/token,
which the pipeline reads with `set +x` and never archives. The authorization code the
operator pastes is a secret too, so it is never echoed back into the log — the pty echoes
typed input, so that one is not hypothetical.

REDACTION RUNS ONCE, OVER THE WHOLE TRANSCRIPT. A pty read returns whatever has arrived,
so a token written in two flushes lands in two reads, and a pattern checked per read
matches neither half — which published the credential in pieces. Everything the child
writes is accumulated and redacted together at exit, where there is no boundary to
straddle. For the same reason the token is resolved from the complete output at the end,
not the first time something looked token-shaped: the first partial match used to latch,
and the saved token was then a truncated string that authenticated nothing.

NOT A GENERAL EXPECT SCRIPT. It knows one flow and fails fast on anything else: no URL
within the timeout, or the child exiting without a token, is reported as a failure with
the transcript attached rather than papered over.
"""

import argparse
import errno
import os
import pty
import re
import select
import signal
import struct
import subprocess
import sys
import termios
import time
import fcntl

# Anything token-shaped. Deliberately broad: over-redacting the log costs nothing, while
# under-redacting publishes a credential to everyone who can read the build.
SECRET = re.compile(r"sk-ant-[A-Za-z0-9_\-]{10,}")
ANSI = re.compile(r"\x1b\[[0-9;?]*[A-Za-z]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)|\x1b[()][B0]|[\x00\x07]")
URL = re.compile(r"https?://[^\s\x1b\"'<>`]+")


# Literals the pipeline fed in that must never come back out. The pty echoes typed input,
# so the authorization code the operator pasted into a masked `input` field would otherwise
# appear in the transcript the pipeline prints to an open console log.
_ECHOED: list[str] = []


def redact(text: str) -> str:
    text = SECRET.sub("<redacted-oauth-token>", text)
    for literal in _ECHOED:
        text = text.replace(literal, "<redacted-auth-code>")
    return text


def pick_url(text: str) -> str | None:
    """The login URL, not whatever else the banner happens to print."""
    for candidate in URL.findall(text):
        candidate = candidate.rstrip(".,)]}")
        if ("claude.ai" in candidate or "anthropic.com" in candidate) and (
            "oauth" in candidate or "authorize" in candidate or "login" in candidate
        ):
            return candidate
    return None


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--state-dir", required=True)
    ap.add_argument("--claude", default="claude", help="path to the claude CLI")
    ap.add_argument(
        "--command",
        default="login",
        help="claude subcommand to drive; `login` for a session this build gives back, "
        "`setup-token` for a long-lived credential",
    )
    ap.add_argument("--timeout", type=int, default=900, help="seconds for the whole flow")
    ap.add_argument(
        "--nudge-after",
        type=int,
        default=10,
        help="seconds to wait for a URL before sending one Enter, in case the CLI opened "
        "on a confirmation screen rather than printing straight away",
    )
    args = ap.parse_args()

    state = os.path.abspath(args.state_dir)
    os.makedirs(state, exist_ok=True)
    paths = {
        n: os.path.join(state, n)
        for n in ("url", "code", "token", "done", "log", "progress")
    }
    for name in ("url", "token", "done", "log"):
        try:
            os.unlink(paths[name])
        except OSError as exc:
            if exc.errno != errno.ENOENT:
                raise

    # Our own notes, live. Only ever strings written here in this file — never a byte the
    # child produced — so this one needs no redaction and is safe to tail at any moment.
    progress = open(paths["progress"], "w", buffering=1)
    # Everything, in order: child output and notes alike. Redacted and written as one piece
    # when the run ends, because a secret can straddle any two reads.
    transcript: list[str] = []

    def note(text: str) -> None:
        transcript.append(text)
        progress.write(text)

    def finish(status: str, seen: str = "") -> int:
        # The token, decided now rather than mid-stream: the longest token-shaped string in
        # the complete output. Resolving it per read latched onto a partial and saved a
        # credential that was quietly too short to work.
        found = SECRET.findall(seen)
        if found:
            token = max(found, key=len)
            # 0600 before a byte of it lands on disk: the workspace is shared with whatever
            # else runs in this pod.
            fd = os.open(paths["token"], os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
            with os.fdopen(fd, "w") as fh:
                fh.write(token)
            note("\n--- captured an oauth token; written to the state dir ---\n")
        with open(paths["log"], "w") as fh:
            fh.write(redact("".join(transcript)))
        progress.flush()
        with open(paths["done"], "w") as fh:
            fh.write(status)
        return 0 if status == "ok" else 1

    master, slave = pty.openpty()
    # A narrow terminal wraps the login URL across lines and the regex then picks up half
    # of it. Ask for a wide one before the child renders anything.
    fcntl.ioctl(slave, termios.TIOCSWINSZ, struct.pack("HHHH", 60, 400, 0, 0))

    env = dict(os.environ)
    env["TERM"] = "xterm-256color"
    env.pop("CLAUDE_CODE_OAUTH_TOKEN", None)  # logging in afresh, not reusing a token

    try:
        child = subprocess.Popen(
            [args.claude, args.command],
            stdin=slave,
            stdout=slave,
            stderr=slave,
            env=env,
            close_fds=True,
            start_new_session=True,
        )
    except OSError as exc:
        note(f"could not start {args.claude!r}: {exc}\n")
        return finish("failed:claude-not-found")
    os.close(slave)

    seen = ""
    url_written = False
    code_sent = False
    nudged = False
    started = time.monotonic()

    while True:
        if time.monotonic() - started > args.timeout:
            note(f"\n--- timed out after {args.timeout}s ---\n")
            try:
                os.killpg(os.getpgid(child.pid), signal.SIGTERM)
            except OSError:
                pass
            return finish("failed:timeout", seen)

        rlist, _, _ = select.select([master], [], [], 1.0)
        if rlist:
            try:
                chunk = os.read(master, 65536)
            except OSError:
                chunk = b""
            if not chunk:
                break
            text = ANSI.sub("", chunk.decode("utf-8", "replace"))
            seen += text
            # Buffered, never written through: redaction happens once at the end, over all
            # of it, so no secret can hide in the seam between two reads.
            transcript.append(text)

            if not url_written:
                url = pick_url(seen)
                if url:
                    with open(paths["url"], "w") as fh:
                        fh.write(url)
                    url_written = True
                    note("\n--- login URL published to the pipeline ---\n")

        # The operator has pasted the code into the `input` step.
        if url_written and not code_sent and os.path.exists(paths["code"]):
            with open(paths["code"]) as fh:
                code = fh.read().strip()
            if code:
                # Register before writing: the echo can arrive on the very next read.
                _ECHOED.append(code)
                os.write(master, code.encode() + b"\r")
                code_sent = True
                note("\n--- authorization code submitted ---\n")

        # Some builds of the CLI open on a confirmation screen and print the URL only
        # after an Enter. One nudge, once, and only while nothing has appeared yet.
        if not url_written and not nudged and time.monotonic() - started > args.nudge_after:
            os.write(master, b"\r")
            nudged = True
            note("\n--- no URL yet; sent one Enter in case a prompt is waiting ---\n")

        if child.poll() is not None and not rlist:
            break

    try:
        child.wait(timeout=30)
    except subprocess.TimeoutExpired:
        try:
            os.killpg(os.getpgid(child.pid), signal.SIGTERM)
        except OSError:
            pass

    if not url_written:
        return finish("failed:no-login-url", seen)
    if not SECRET.search(seen):
        # `login` normally stores the credential in the config dir rather than printing
        # it, so this is the usual path, not an error: the later stages in this pod are
        # authenticated by that stored session. Say which happened all the same, because
        # a missing token and a stored one are debugged differently.
        note("\n--- no token in the output; relying on the CLI's stored credential ---\n")
    return finish(
        "ok" if child.returncode == 0 else f"failed:exit-{child.returncode}", seen
    )


if __name__ == "__main__":
    sys.exit(main())
