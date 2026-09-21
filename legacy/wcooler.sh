#!/usr/bin/env bash

set -euo pipefail

VERSION="0.1.0"
DEFAULT_LEASE_SEC=900
DEFAULT_POLL_SEC=2
LOCK_TIMEOUT_SEC=10
LOCK_SPIN_SEC="0.1"

usage() {
  cat <<'EOF'
Water Cooler Protocol (v0.1)

Usage:
  wcooler.sh enter  --file <path> --agent <id> --intent <text> [--scope <ranges>|all] [--structural] [--lease-sec <seconds>]
  wcooler.sh wait   --file <path> --agent <id> [--poll-sec <seconds>] [--timeout-sec <seconds>]
  wcooler.sh status [--file <path>]
  wcooler.sh apply  --file <path> --agent <id> --patch <patch.diff> [--check-only]
  wcooler.sh leave  --file <path> --agent <id>

Scope format:
  all
  10:20
  10:20,30:45

Notes:
  - Conflicts are detected on overlapping scopes or any structural claim.
  - Claims are lease-based and expire automatically if heartbeat stops.
  - apply enforces write-time checks against base file hash + active claims.
EOF
}

die() {
  echo "wcooler: $*" >&2
  exit 1
}

warn() {
  echo "wcooler: $*" >&2
}

now_epoch() {
  date +%s
}

project_root() {
  if command -v git >/dev/null 2>&1 && git rev-parse --show-toplevel >/dev/null 2>&1; then
    git rev-parse --show-toplevel
  else
    pwd -P
  fi
}

PROJECT_ROOT="$(project_root)"
STATE_DIR="${WATERCOOLER_STATE_DIR:-$PROJECT_ROOT/.watercool}"
CLAIMS_DIR="$STATE_DIR/claims"
LOCKS_DIR="$STATE_DIR/locks"
EVENTS_DIR="$STATE_DIR/events"

ensure_state_dirs() {
  mkdir -p "$CLAIMS_DIR" "$LOCKS_DIR" "$EVENTS_DIR"
}

canonical_path() {
  local input="$1"
  local abs dir base
  if [[ "$input" = /* ]]; then
    abs="$input"
  else
    abs="$PWD/$input"
  fi
  dir="$(dirname "$abs")"
  base="$(basename "$abs")"
  [[ -d "$dir" ]] || die "directory does not exist: $dir"
  dir="$(cd "$dir" && pwd -P)"
  printf '%s/%s\n' "$dir" "$base"
}

sha256_text() {
  local text="$1"
  if command -v shasum >/dev/null 2>&1; then
    printf '%s' "$text" | shasum -a 256 | awk '{print $1}'
  elif command -v sha256sum >/dev/null 2>&1; then
    printf '%s' "$text" | sha256sum | awk '{print $1}'
  else
    printf '%s' "$text" | openssl dgst -sha256 | awk '{print $NF}'
  fi
}

sha256_file() {
  local path="$1"
  if [[ ! -f "$path" ]]; then
    printf 'MISSING\n'
    return 0
  fi
  if command -v shasum >/dev/null 2>&1; then
    shasum -a 256 "$path" | awk '{print $1}'
  elif command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$path" | awk '{print $1}'
  else
    openssl dgst -sha256 "$path" | awk '{print $NF}'
  fi
}

sanitize_text() {
  local raw="$1"
  raw="${raw//$'\n'/ }"
  raw="${raw//$'\r'/ }"
  raw="${raw//$'\t'/ }"
  printf '%s\n' "$raw"
}

normalize_scope() {
  local raw="${1:-all}"
  local part start end tmp normalized
  local -a ranges parts

  raw="${raw// /}"
  if [[ -z "$raw" || "$raw" == "all" || "$raw" == "*" ]]; then
    printf 'all\n'
    return 0
  fi

  IFS=',' read -r -a parts <<< "$raw"
  for part in "${parts[@]}"; do
    [[ -z "$part" ]] && continue
    if [[ "$part" =~ ^([0-9]+):([0-9]+)$ ]]; then
      start="${BASH_REMATCH[1]}"
      end="${BASH_REMATCH[2]}"
    elif [[ "$part" =~ ^([0-9]+)-([0-9]+)$ ]]; then
      start="${BASH_REMATCH[1]}"
      end="${BASH_REMATCH[2]}"
    elif [[ "$part" =~ ^([0-9]+)$ ]]; then
      start="${BASH_REMATCH[1]}"
      end="${BASH_REMATCH[1]}"
    else
      die "invalid scope segment: $part"
    fi
    if (( start > end )); then
      tmp="$start"
      start="$end"
      end="$tmp"
    fi
    ranges+=("$start:$end")
  done

  (( ${#ranges[@]} > 0 )) || die "scope resolved to an empty set"
  normalized="$(printf '%s\n' "${ranges[@]}" | sort -t: -k1,1n -k2,2n | paste -sd';' -)"
  printf '%s\n' "$normalized"
}

scope_overlap() {
  local a="$1"
  local b="$2"
  local ra rb a_start a_end b_start b_end
  local -a a_ranges b_ranges

  [[ "$a" == "all" || "$b" == "all" ]] && return 0
  IFS=';' read -r -a a_ranges <<< "$a"
  IFS=';' read -r -a b_ranges <<< "$b"

  for ra in "${a_ranges[@]}"; do
    a_start="${ra%%:*}"
    a_end="${ra##*:}"
    for rb in "${b_ranges[@]}"; do
      b_start="${rb%%:*}"
      b_end="${rb##*:}"
      if (( a_start <= b_end && b_start <= a_end )); then
        return 0
      fi
    done
  done
  return 1
}

claims_conflict() {
  local structural_a="$1"
  local scope_a="$2"
  local structural_b="$3"
  local scope_b="$4"

  if [[ "$structural_a" == "1" || "$structural_b" == "1" ]]; then
    return 0
  fi
  scope_overlap "$scope_a" "$scope_b"
}

claim_precedes() {
  local other_created="$1"
  local other_agent="$2"
  local mine_created="$3"
  local mine_agent="$4"

  if (( other_created < mine_created )); then
    return 0
  fi
  if (( other_created > mine_created )); then
    return 1
  fi
  [[ "$other_agent" < "$mine_agent" ]]
}

validate_agent_id() {
  local agent_id="$1"
  [[ "$agent_id" =~ ^[A-Za-z0-9._:-]+$ ]] || die "agent id must match [A-Za-z0-9._:-]+"
}

claim_file_path() {
  local file_hash="$1"
  local agent_id="$2"
  printf '%s/%s/%s.claim\n' "$CLAIMS_DIR" "$file_hash" "$agent_id"
}

append_event() {
  local file_hash="$1"
  local agent_id="$2"
  local action="$3"
  local details
  details="$(sanitize_text "${4:-}")"
  printf '%s\t%s\t%s\t%s\n' "$(now_epoch)" "$agent_id" "$action" "$details" >> "$EVENTS_DIR/$file_hash.log"
}

with_file_lock() {
  local file_hash="$1"
  shift
  (
    local lock_dir="$LOCKS_DIR/$file_hash.lock"
    local start now
    start="$(now_epoch)"
    while ! mkdir "$lock_dir" 2>/dev/null; do
      now="$(now_epoch)"
      if (( now - start >= LOCK_TIMEOUT_SEC )); then
        die "timed out acquiring lock for $file_hash"
      fi
      sleep "$LOCK_SPIN_SEC"
    done
    trap 'rmdir "$lock_dir" >/dev/null 2>&1 || true' EXIT
    "$@"
  )
}

reset_claim_vars() {
  C_VERSION=""
  C_AGENT_ID=""
  C_FILE_PATH=""
  C_FILE_HASH=""
  C_INTENT=""
  C_SCOPE=""
  C_STRUCTURAL="0"
  C_STATE=""
  C_CREATED_AT="0"
  C_UPDATED_AT="0"
  C_LEASE_SEC="$DEFAULT_LEASE_SEC"
  C_EXPIRES_AT="0"
  C_BASE_HASH=""
  C_CLAIM_PATH=""
}

load_claim() {
  local claim_path="$1"
  reset_claim_vars
  C_CLAIM_PATH="$claim_path"
  while IFS='=' read -r key value; do
    case "$key" in
      version) C_VERSION="$value" ;;
      agent_id) C_AGENT_ID="$value" ;;
      file_path) C_FILE_PATH="$value" ;;
      file_hash) C_FILE_HASH="$value" ;;
      intent) C_INTENT="$value" ;;
      scope) C_SCOPE="$value" ;;
      structural) C_STRUCTURAL="$value" ;;
      state) C_STATE="$value" ;;
      created_at) C_CREATED_AT="$value" ;;
      updated_at) C_UPDATED_AT="$value" ;;
      lease_sec) C_LEASE_SEC="$value" ;;
      expires_at) C_EXPIRES_AT="$value" ;;
      base_hash) C_BASE_HASH="$value" ;;
    esac
  done < "$claim_path"
}

save_loaded_claim() {
  local tmp="${C_CLAIM_PATH}.tmp.$$"
  cat > "$tmp" <<EOF
version=$VERSION
agent_id=$C_AGENT_ID
file_path=$C_FILE_PATH
file_hash=$C_FILE_HASH
intent=$C_INTENT
scope=$C_SCOPE
structural=$C_STRUCTURAL
state=$C_STATE
created_at=$C_CREATED_AT
updated_at=$C_UPDATED_AT
lease_sec=$C_LEASE_SEC
expires_at=$C_EXPIRES_AT
base_hash=$C_BASE_HASH
EOF
  mv "$tmp" "$C_CLAIM_PATH"
}

write_new_claim() {
  local claim_path="$1"
  local agent_id="$2"
  local file_path="$3"
  local file_hash="$4"
  local intent="$5"
  local scope="$6"
  local structural="$7"
  local lease_sec="$8"
  local now="$9"
  local expires_at base_hash
  expires_at=$(( now + lease_sec ))
  base_hash="$(sha256_file "$file_path")"
  cat > "$claim_path" <<EOF
version=$VERSION
agent_id=$agent_id
file_path=$file_path
file_hash=$file_hash
intent=$intent
scope=$scope
structural=$structural
state=WAITING
created_at=$now
updated_at=$now
lease_sec=$lease_sec
expires_at=$expires_at
base_hash=$base_hash
EOF
}

cleanup_stale_locked() {
  local file_hash="$1"
  local dir="$CLAIMS_DIR/$file_hash"
  local now claim expires
  now="$(now_epoch)"
  [[ -d "$dir" ]] || return 0

  shopt -s nullglob
  for claim in "$dir"/*.claim; do
    load_claim "$claim"
    expires="${C_EXPIRES_AT:-0}"
    [[ "$expires" =~ ^[0-9]+$ ]] || expires=0
    if (( expires > 0 && expires < now )); then
      rm -f "$claim"
      append_event "$file_hash" "${C_AGENT_ID:-unknown}" "expire" "lease timed out"
    fi
  done
  shopt -u nullglob
}

compute_blockers_locked() {
  local file_hash="$1"
  local my_agent="$2"
  local my_created="$3"
  local my_scope="$4"
  local my_structural="$5"
  local dir="$CLAIMS_DIR/$file_hash"
  local claim
  local other_agent other_created other_scope other_structural
  local -a blockers

  shopt -s nullglob
  for claim in "$dir"/*.claim; do
    load_claim "$claim"
    other_agent="$C_AGENT_ID"
    [[ "$other_agent" == "$my_agent" ]] && continue
    other_created="${C_CREATED_AT:-0}"
    other_scope="$C_SCOPE"
    other_structural="$C_STRUCTURAL"

    if ! claims_conflict "$my_structural" "$my_scope" "$other_structural" "$other_scope"; then
      continue
    fi
    if claim_precedes "$other_created" "$other_agent" "$my_created" "$my_agent"; then
      blockers+=("$other_agent")
    fi
  done
  shopt -u nullglob

  if (( ${#blockers[@]} == 0 )); then
    printf '\n'
  else
    printf '%s\n' "$(IFS=','; echo "${blockers[*]}")"
  fi
}

attempt_activate_locked() {
  local file_hash="$1"
  local agent_id="$2"
  local claim_path now blockers

  claim_path="$(claim_file_path "$file_hash" "$agent_id")"
  [[ -f "$claim_path" ]] || die "claim not found for agent $agent_id"

  cleanup_stale_locked "$file_hash"
  [[ -f "$claim_path" ]] || die "claim expired while waiting; re-enter required"
  load_claim "$claim_path"

  now="$(now_epoch)"
  C_UPDATED_AT="$now"
  C_EXPIRES_AT=$(( now + C_LEASE_SEC ))
  blockers="$(compute_blockers_locked "$file_hash" "$C_AGENT_ID" "$C_CREATED_AT" "$C_SCOPE" "$C_STRUCTURAL")"

  if [[ -z "$blockers" ]]; then
    if [[ "$C_STATE" != "ACTIVE" ]]; then
      append_event "$file_hash" "$C_AGENT_ID" "activate" "scope=$C_SCOPE"
    fi
    C_STATE="ACTIVE"
    C_BASE_HASH="$(sha256_file "$C_FILE_PATH")"
  else
    C_STATE="WAITING"
  fi
  save_loaded_claim
  printf '%s|%s\n' "$C_STATE" "$blockers"
}

enter_locked() {
  local file_hash="$1"
  local file_path="$2"
  local agent_id="$3"
  local intent="$4"
  local scope="$5"
  local structural="$6"
  local lease_sec="$7"
  local dir claim_path now result state blockers

  dir="$CLAIMS_DIR/$file_hash"
  mkdir -p "$dir"
  cleanup_stale_locked "$file_hash"

  claim_path="$(claim_file_path "$file_hash" "$agent_id")"
  if [[ -f "$claim_path" ]]; then
    warn "claim already exists for $agent_id on this file; refreshing intent/scope"
  fi

  now="$(now_epoch)"
  write_new_claim "$claim_path" "$agent_id" "$file_path" "$file_hash" "$intent" "$scope" "$structural" "$lease_sec" "$now"
  append_event "$file_hash" "$agent_id" "enter" "scope=$scope structural=$structural intent=$intent"

  result="$(attempt_activate_locked "$file_hash" "$agent_id")"
  state="${result%%|*}"
  blockers="${result#*|}"
  if [[ "$state" == "ACTIVE" ]]; then
    printf 'ACTIVE||%s\n' "$claim_path"
  else
    printf 'WAITING|%s|%s\n' "$blockers" "$claim_path"
  fi
}

wait_locked() {
  local file_hash="$1"
  local agent_id="$2"
  attempt_activate_locked "$file_hash" "$agent_id"
}

leave_locked() {
  local file_hash="$1"
  local agent_id="$2"
  local claim_path

  cleanup_stale_locked "$file_hash"
  claim_path="$(claim_file_path "$file_hash" "$agent_id")"
  if [[ ! -f "$claim_path" ]]; then
    die "no active claim for agent $agent_id"
  fi
  rm -f "$claim_path"
  append_event "$file_hash" "$agent_id" "leave" "released claim"
}

patch_target_from_diff() {
  local patch_path="$1"
  local line first=""
  local count=0

  while IFS= read -r line; do
    [[ -z "$line" ]] && continue
    if (( count == 0 )); then
      first="$line"
    fi
    count=$((count + 1))
    if (( count > 1 )); then
      break
    fi
  done < <(awk '/^\+\+\+ /{print $2}' "$patch_path" | sed -E 's#^[ab]/##' | grep -v '^/dev/null$' | sort -u)

  (( count > 0 )) || die "patch contains no target file entries"
  (( count == 1 )) || die "v0.1 apply supports patching exactly one file; found $count or more"
  printf '%s\n' "$first"
}

patch_scope_from_diff() {
  local patch_path="$1"
  local line start count end
  local -a ranges
  while IFS= read -r line; do
    if [[ "$line" =~ ^@@[[:space:]]-[^[:space:]]+[[:space:]]\+([0-9]+)(,([0-9]+))?[[:space:]]@@ ]]; then
      start="${BASH_REMATCH[1]}"
      count="${BASH_REMATCH[3]:-1}"
      if (( count == 0 )); then
        end="$start"
      else
        end=$(( start + count - 1 ))
      fi
      ranges+=("$start:$end")
    fi
  done < "$patch_path"

  (( ${#ranges[@]} > 0 )) || die "patch contains no text hunks"
  printf '%s\n' "$(printf '%s\n' "${ranges[@]}" | sort -t: -k1,1n -k2,2n | paste -sd';' -)"
}

canonical_patch_target() {
  local patch_target="$1"
  if [[ "$patch_target" = /* ]]; then
    canonical_path "$patch_target"
  else
    canonical_path "$PROJECT_ROOT/$patch_target"
  fi
}

apply_locked() {
  local file_hash="$1"
  local file_path="$2"
  local agent_id="$3"
  local patch_path="$4"
  local check_only="$5"
  local claim_path current_hash patch_target patch_target_abs patch_scope claim other_agent other_scope other_structural

  cleanup_stale_locked "$file_hash"
  claim_path="$(claim_file_path "$file_hash" "$agent_id")"
  [[ -f "$claim_path" ]] || die "claim not found for agent $agent_id"
  load_claim "$claim_path"
  [[ "$C_STATE" == "ACTIVE" ]] || die "claim is not ACTIVE for $agent_id"

  C_UPDATED_AT="$(now_epoch)"
  C_EXPIRES_AT=$(( C_UPDATED_AT + C_LEASE_SEC ))
  save_loaded_claim

  current_hash="$(sha256_file "$file_path")"
  [[ "$current_hash" == "$C_BASE_HASH" ]] || die "base hash mismatch; file changed since claim activation"

  patch_target="$(patch_target_from_diff "$patch_path")"
  patch_target_abs="$(canonical_patch_target "$patch_target")"
  [[ "$patch_target_abs" == "$file_path" ]] || die "patch target $patch_target_abs does not match claim file $file_path"
  patch_scope="$(patch_scope_from_diff "$patch_path")"

  shopt -s nullglob
  for claim in "$CLAIMS_DIR/$file_hash"/*.claim; do
    load_claim "$claim"
    other_agent="$C_AGENT_ID"
    [[ "$other_agent" == "$agent_id" ]] && continue
    [[ "$C_STATE" == "ACTIVE" ]] || continue
    other_scope="$C_SCOPE"
    other_structural="$C_STRUCTURAL"
    if [[ "$other_structural" == "1" ]]; then
      die "apply blocked by structural claim held by $other_agent"
    fi
    if scope_overlap "$patch_scope" "$other_scope"; then
      die "apply blocked; patch scope overlaps ACTIVE claim of $other_agent ($other_scope)"
    fi
  done
  shopt -u nullglob

  if command -v git >/dev/null 2>&1 && git -C "$PROJECT_ROOT" rev-parse --is-inside-work-tree >/dev/null 2>&1; then
    git -C "$PROJECT_ROOT" apply --check "$patch_path"
    if [[ "$check_only" == "1" ]]; then
      append_event "$file_hash" "$agent_id" "apply-check" "scope=$patch_scope patch=$patch_path"
      return 0
    fi
    git -C "$PROJECT_ROOT" apply "$patch_path"
  else
    command -v patch >/dev/null 2>&1 || die "neither git nor patch command available for apply"
    if [[ "$check_only" == "1" ]]; then
      patch --dry-run -p0 < "$patch_path" >/dev/null
      append_event "$file_hash" "$agent_id" "apply-check" "scope=$patch_scope patch=$patch_path"
      return 0
    fi
    patch -p0 < "$patch_path" >/dev/null
  fi

  load_claim "$claim_path"
  C_UPDATED_AT="$(now_epoch)"
  C_EXPIRES_AT=$(( C_UPDATED_AT + C_LEASE_SEC ))
  C_BASE_HASH="$(sha256_file "$file_path")"
  save_loaded_claim
  append_event "$file_hash" "$agent_id" "apply" "scope=$patch_scope patch=$patch_path"
}

status_for_hash_locked() {
  local file_hash="$1"
  local dir="$CLAIMS_DIR/$file_hash"
  local claim structural

  cleanup_stale_locked "$file_hash"
  [[ -d "$dir" ]] || return 0

  shopt -s nullglob
  if ! compgen -G "$dir/*.claim" >/dev/null; then
    shopt -u nullglob
    return 0
  fi

  printf 'file_hash=%s\n' "$file_hash"
  printf 'agent\tstate\tscope\tstructural\tcreated_at\texpires_at\tfile\n'
  for claim in "$dir"/*.claim; do
    load_claim "$claim"
    if [[ "$C_STRUCTURAL" == "1" ]]; then
      structural="yes"
    else
      structural="no"
    fi
    printf '%s\t%s\t%s\t%s\t%s\t%s\t%s\n' \
      "$C_AGENT_ID" "$C_STATE" "$C_SCOPE" "$structural" "$C_CREATED_AT" "$C_EXPIRES_AT" "$C_FILE_PATH"
  done | sort -t$'\t' -k5,5n -k1,1
  printf '\n'
  shopt -u nullglob
}

cmd_enter() {
  local file="" agent="" intent="" scope="all" lease_sec="$DEFAULT_LEASE_SEC" structural="0"
  while (( $# > 0 )); do
    case "$1" in
      --file) file="${2:-}"; shift 2 ;;
      --agent) agent="${2:-}"; shift 2 ;;
      --intent) intent="${2:-}"; shift 2 ;;
      --scope) scope="${2:-}"; shift 2 ;;
      --lease-sec) lease_sec="${2:-}"; shift 2 ;;
      --structural) structural="1"; shift ;;
      *) die "unknown enter option: $1" ;;
    esac
  done
  [[ -n "$file" && -n "$agent" ]] || die "enter requires --file and --agent"
  [[ -n "$intent" ]] || intent="editing"
  [[ "$lease_sec" =~ ^[0-9]+$ ]] || die "--lease-sec must be an integer"
  validate_agent_id "$agent"
  file="$(canonical_path "$file")"
  intent="$(sanitize_text "$intent")"
  scope="$(normalize_scope "$scope")"

  local file_hash result state blockers claim_path
  file_hash="$(sha256_text "$file")"
  ensure_state_dirs

  result="$(with_file_lock "$file_hash" enter_locked "$file_hash" "$file" "$agent" "$intent" "$scope" "$structural" "$lease_sec")"
  state="${result%%|*}"
  blockers=""
  claim_path=""
  if [[ "$state" == "WAITING" ]]; then
    blockers="$(echo "$result" | awk -F'|' '{print $2}')"
    claim_path="$(echo "$result" | awk -F'|' '{print $3}')"
  else
    claim_path="$(echo "$result" | awk -F'|' '{print $3}')"
  fi

  printf 'entered file=%s agent=%s scope=%s structural=%s claim=%s\n' "$file" "$agent" "$scope" "$structural" "$claim_path"
  if [[ "$state" == "ACTIVE" ]]; then
    printf 'state=ACTIVE\n'
  else
    printf 'state=WAITING blockers=%s\n' "$blockers"
  fi
}

cmd_wait() {
  local file="" agent="" poll_sec="$DEFAULT_POLL_SEC" timeout_sec=0
  while (( $# > 0 )); do
    case "$1" in
      --file) file="${2:-}"; shift 2 ;;
      --agent) agent="${2:-}"; shift 2 ;;
      --poll-sec) poll_sec="${2:-}"; shift 2 ;;
      --timeout-sec) timeout_sec="${2:-}"; shift 2 ;;
      *) die "unknown wait option: $1" ;;
    esac
  done
  [[ -n "$file" && -n "$agent" ]] || die "wait requires --file and --agent"
  [[ "$poll_sec" =~ ^[0-9]+$ ]] || die "--poll-sec must be an integer"
  [[ "$timeout_sec" =~ ^[0-9]+$ ]] || die "--timeout-sec must be an integer"
  validate_agent_id "$agent"
  file="$(canonical_path "$file")"

  local file_hash start now result state blockers
  file_hash="$(sha256_text "$file")"
  ensure_state_dirs
  start="$(now_epoch)"

  while true; do
    result="$(with_file_lock "$file_hash" wait_locked "$file_hash" "$agent")"
    state="${result%%|*}"
    blockers="${result#*|}"
    if [[ "$state" == "ACTIVE" ]]; then
      printf 'state=ACTIVE agent=%s file=%s\n' "$agent" "$file"
      return 0
    fi
    printf 'state=WAITING blockers=%s\n' "$blockers"
    if (( timeout_sec > 0 )); then
      now="$(now_epoch)"
      if (( now - start >= timeout_sec )); then
        die "wait timeout reached"
      fi
    fi
    sleep "$poll_sec"
  done
}

cmd_leave() {
  local file="" agent=""
  while (( $# > 0 )); do
    case "$1" in
      --file) file="${2:-}"; shift 2 ;;
      --agent) agent="${2:-}"; shift 2 ;;
      *) die "unknown leave option: $1" ;;
    esac
  done
  [[ -n "$file" && -n "$agent" ]] || die "leave requires --file and --agent"
  validate_agent_id "$agent"
  file="$(canonical_path "$file")"

  local file_hash
  file_hash="$(sha256_text "$file")"
  ensure_state_dirs
  with_file_lock "$file_hash" leave_locked "$file_hash" "$agent"
  printf 'left file=%s agent=%s\n' "$file" "$agent"
}

cmd_apply() {
  local file="" agent="" patch_path="" check_only="0"
  while (( $# > 0 )); do
    case "$1" in
      --file) file="${2:-}"; shift 2 ;;
      --agent) agent="${2:-}"; shift 2 ;;
      --patch) patch_path="${2:-}"; shift 2 ;;
      --check-only) check_only="1"; shift ;;
      *) die "unknown apply option: $1" ;;
    esac
  done
  [[ -n "$file" && -n "$agent" && -n "$patch_path" ]] || die "apply requires --file, --agent, and --patch"
  validate_agent_id "$agent"
  file="$(canonical_path "$file")"
  patch_path="$(canonical_path "$patch_path")"
  [[ -f "$patch_path" ]] || die "patch file not found: $patch_path"

  local file_hash
  file_hash="$(sha256_text "$file")"
  ensure_state_dirs
  with_file_lock "$file_hash" apply_locked "$file_hash" "$file" "$agent" "$patch_path" "$check_only"
  if [[ "$check_only" == "1" ]]; then
    printf 'apply-check=ok file=%s agent=%s patch=%s\n' "$file" "$agent" "$patch_path"
  else
    printf 'apply=ok file=%s agent=%s patch=%s\n' "$file" "$agent" "$patch_path"
  fi
}

cmd_status() {
  local file=""
  while (( $# > 0 )); do
    case "$1" in
      --file) file="${2:-}"; shift 2 ;;
      *) die "unknown status option: $1" ;;
    esac
  done
  ensure_state_dirs

  if [[ -n "$file" ]]; then
    file="$(canonical_path "$file")"
    local file_hash
    file_hash="$(sha256_text "$file")"
    with_file_lock "$file_hash" status_for_hash_locked "$file_hash"
    return 0
  fi

  local dir file_hash
  shopt -s nullglob
  for dir in "$CLAIMS_DIR"/*; do
    [[ -d "$dir" ]] || continue
    file_hash="$(basename "$dir")"
    with_file_lock "$file_hash" status_for_hash_locked "$file_hash"
  done
  shopt -u nullglob
}

main() {
  ensure_state_dirs
  [[ $# -ge 1 ]] || { usage; exit 1; }
  case "$1" in
    enter) shift; cmd_enter "$@" ;;
    wait) shift; cmd_wait "$@" ;;
    status) shift; cmd_status "$@" ;;
    apply) shift; cmd_apply "$@" ;;
    leave) shift; cmd_leave "$@" ;;
    --help|-h|help) usage ;;
    --version|-v) printf '%s\n' "$VERSION" ;;
    *) usage; die "unknown command: $1" ;;
  esac
}

main "$@"
