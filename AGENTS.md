# Repository guidance

- Keep independent streaming projects under `projects/<name>` with their own README, configuration examples, source and tests.
- Use `packages/` only after multiple projects actually share code. Do not pre-create empty packages.
- Keep credentials, machine-specific configuration and generated binaries out of Git. Preserve existing ignored local settings.
- JavaScript currently uses CommonJS and Node.js built-ins with Node.js 22.15+.
- Run `node scripts/check.js` and `node scripts/test.js` for JavaScript changes.
- For native probe changes, run `powershell.exe -NoProfile -File projects/obs-watchdog/native-probe/build.ps1 -Test` on Windows with Zig 0.14.0.
- Automated tests must use fake OBS clients or local native harnesses. Loading plugins into OBS or changing live streaming inputs requires a specific user request.
- Update project documentation when changing commands, configuration or supported environments.
