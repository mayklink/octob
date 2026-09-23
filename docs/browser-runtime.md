# Octob Browser + Local Runtime

The browser build keeps the existing React UI and moves privileged desktop work into a local runtime bound to loopback.

## Development

```bash
yarn web:local
```

This builds the runtime and browser UI, starts the local runtime on `127.0.0.1:47821`, serves the UI from the same process, and opens the browser.

`web:local` reuses a runtime already listening on that port. To test a fresh
build without sharing an older in-memory runtime, start an isolated instance:

```powershell
$env:OCTOB_RUNTIME_PORT=47822; yarn web:local
```

The UI is served from the same port and therefore connects to the matching
runtime automatically.

For HMR during UI development:

```bash
yarn runtime:dev
yarn web:dev
```

## Standalone runtime

```bash
yarn build:runtime:exe
```

On Windows the distributable runtime is generated at:

```text
out/runtime-package/octob-runtime.exe
```

Running the executable starts the API and browser UI. Pass `--no-open` to start it without opening the browser.

The package contains the browser assets, the runtime bundle, isolated native Node modules, and the Whisper sidecar. Node and Electron are not required on the target machine.

## Runtime boundary

The browser communicates with the runtime over HTTP and streaming NDJSON. The runtime owns filesystem access, Git/worktrees, SQLite, PTY terminals, scripts, agent SDKs, MCP, connections, attachments, watchers, voice transcription, and the global assistant.

The runtime listens on loopback by default. Sensitive routes require a runtime Bearer session. Filesystem and execution routes are restricted to registered projects, active worktrees, connections, and the internal assistant workspace. Database RPC uses an explicit method allowlist.

The allowed browser origins can be extended with `OCTOB_ALLOWED_ORIGINS`. Private Network Access preflight is supported for a future hosted browser frontend.
