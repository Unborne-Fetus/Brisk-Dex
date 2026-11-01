#!/usr/bin/env bash
# Reproduce a Windows checkout of the WSL native build entrypoint.
set -euo pipefail
scratch="$(mktemp -d)"
trap 'rm -rf "$scratch"' EXIT
mkdir "$scratch/path with spaces"
# $BASH_SOURCE is no longer a filename when a script is piped to bash.
# The explicit root must therefore survive CRLF normalization.
printf '#!/usr/bin/env bash\r\nset -euo pipefail\r\nroot="${BRISK_NATIVE_ROOT:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"\r\nprintf "target:%%s root:%%s\\n" "$1" "$root"\r\n' > "$scratch/native-crlf.sh"
expected="target:windows root:$scratch/path with spaces"
result="$(sed 's/\r$//' "$scratch/native-crlf.sh" | BRISK_NATIVE_ROOT="$scratch/path with spaces" bash -s -- windows)"
if [ "$result" != "$expected" ]; then
  printf 'CRLF handling/root propagation failed: %s\n' "$result" >&2
  exit 1
fi
printf '#!/usr/bin/env bash\nset -euo pipefail\nprintf "args:%%s\\n" "$1"\n' > "$scratch/native-lf.sh"
result="$(sed 's/\r$//' "$scratch/native-lf.sh" | bash -s -- linux)"
test "$result" = 'args:linux'
echo 'CRLF and LF Bash entrypoints and paths with spaces work.'
