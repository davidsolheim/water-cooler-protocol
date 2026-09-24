#!/usr/bin/env bash
# Two-agent smoke: conflict, then overtake after TTL.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
CLI=(bun "$ROOT/src/cli.ts")
WORKDIR="$(mktemp -d)"
TTL=5
cleanup() {
  (cd "$WORKDIR" && "${CLI[@]}" stop >/dev/null 2>&1) || true
  rm -rf "$WORKDIR"
}
trap cleanup EXIT

git init "$WORKDIR" >/dev/null
git -C "$WORKDIR" config user.email wcp@test
git -C "$WORKDIR" config user.name wcp
git -C "$WORKDIR" checkout -b dev
mkdir -p "$WORKDIR/src"
echo 'one' > "$WORKDIR/src/a.ts"
git -C "$WORKDIR" add src/a.ts
git -C "$WORKDIR" commit -m init >/dev/null

cd "$WORKDIR"
"${CLI[@]}" init --arch demo --ttl-sec "$TTL" --json >/dev/null
cat > "$WORKDIR/src/a.test.ts" <<'EOF'
// WCP auth-1: src/a.ts rotate cookie (demo)
// WCP ui-2: src/a.ts finish rotate (demo)
EOF
A_OUT="$(WCP_AGENT=auth-1 "${CLI[@]}" acquire --path src/a.ts --test src/a.test.ts --doing "rotate cookie" --json || true)"
echo "$A_OUT" | grep -q '"ok":true'
B_OUT="$(WCP_AGENT=ui-2 "${CLI[@]}" acquire --path src/a.ts --test src/a.test.ts --doing "empty state" --json || true)"
if ! echo "$B_OUT" | grep -q '"error":"conflict"'; then
  echo "expected conflict, got: $B_OUT" >&2
  exit 1
fi
sleep $((TTL + 1))
O_OUT="$(WCP_AGENT=ui-2 "${CLI[@]}" overtake --path src/a.ts --test src/a.test.ts --json || true)"
if ! echo "$O_OUT" | grep -q '"from_agent":"auth-1"'; then
  echo "expected overtake inherit, got: $O_OUT" >&2
  exit 1
fi
echo "smoke ok"
