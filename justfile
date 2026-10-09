set windows-shell := ["powershell.exe", "-NoLogo", "-NoProfile", "-Command"]

default:
    just --list

check:
    node scripts/check.js

test:
    node scripts/test.js

verify: check test

watchdog:
    node --env-file-if-exists=projects/obs-watchdog/.env projects/obs-watchdog/src/cli.js watch

recover name:
    node --env-file-if-exists=projects/obs-watchdog/.env projects/obs-watchdog/src/cli.js recover "{{name}}"

build-probe:
    powershell.exe -NoLogo -NoProfile -File projects/obs-watchdog/native-probe/build.ps1 -Test
