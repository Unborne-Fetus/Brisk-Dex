#!/usr/bin/env bash
# Reproduce Windows core.autocrlf=CRLF and prove the WSL entrypoint normalizes it.
set -euo pipefail
scratch="$(mktemp -d)"
trap 'rm -rf "$scratch"' EXIT
printf '#!/usr/bin/env bash\r\nset -euo pipefail\r\nprintf "args:%%s\\n" "$1"\r\n' > "$scratch/native-crlf.sh"
result="$(sed 's/\r$//' "$scratch/native-crlf.sh" | bash -s -- windows)"
if [ "$result" != 'args:windows' ]; then
  printf 'CRLF normalization failed: %s\n' "$result" >&2
  exit 1
fi
# The normal LF checkout must work through the same invocation.
printf '#!/usr/bin/env bash\nset -euo pipefail\nprintf "args:%%s\\n" "$1"\n' > "$scratch/native-lf.sh"
result="$(sed 's/\r$//' "$scratch/native-lf.sh" | bash -s -- windows)"
test "$result" = 'args:windows'
echo 'CRLF and LF WSL Bash entrypoints work.'
