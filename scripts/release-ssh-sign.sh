#!/bin/bash
# gpg.ssh.program wrapper: git SSH signing with the Vault-cached release key.
#
# The release key (`scripts/release-signing.pub`) exists ONLY in cove's Vault
# (`op://Private/Focus Board Release Signing/private key`) — never on disk,
# never in 1Password. This wrapper intercepts git's sign invocation,
# materializes the private key in a 0600 temp file for the duration of one
# signature, calls stock ssh-keygen, and deletes it. Every other invocation
# (verify, check-novalidate) passes through untouched.
#
# Wired per-repo:
#   git config gpg.format ssh
#   git config gpg.ssh.program "<repo>/scripts/release-ssh-sign.sh"
#   git config user.signingkey "<repo>/scripts/release-signing.pub"
#   git config tag.gpgSign true
set -euo pipefail

REAL_SSH_KEYGEN=/usr/bin/ssh-keygen
VAULT_REF="op://Private/Focus Board Release Signing/private key"

if [ "${1:-}" = "-Y" ] && [ "${2:-}" = "sign" ]; then
  priv="$(cove creds vault-get "$VAULT_REF")"
  case "$priv" in
    "-----BEGIN OPENSSH PRIVATE KEY-----"*) : ;;  # expected shape
    *) echo "release-ssh-sign: Vault returned no private key for $VAULT_REF" >&2; exit 1 ;;
  esac
  tmpdir="$(mktemp -d "${TMPDIR:-/tmp}/vault-sign.XXXXXX")"
  trap 'rm -rf "$tmpdir"' EXIT
  printf '%s\n' "$priv" > "$tmpdir/key.op"
  chmod 600 "$tmpdir/key.op"
  # Swap git's -f <key> (our public key file) for the Vault private key.
  args=()
  swap=0
  for arg in "$@"; do
    if [ "$swap" = 1 ]; then
      args+=("$tmpdir/key.op")
      swap=0
    elif [ "$arg" = "-f" ]; then
      args+=("$arg")
      swap=1
    else
      args+=("$arg")
    fi
  done
  "$REAL_SSH_KEYGEN" "${args[@]}"
  exit $?
fi

exec "$REAL_SSH_KEYGEN" "$@"