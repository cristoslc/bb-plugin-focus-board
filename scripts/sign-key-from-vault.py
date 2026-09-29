#!/usr/bin/env python3
"""Compose an OpenSSH-format Ed25519 private key from a Vault-cached PKCS#8.

Focus Board release tags are SSH-signed (gpg.format=ssh). The signing key is a
1Password SSH item, which 1Password exports as PKCS#8 — a format `ssh-keygen`
cannot hand to git's signer, and cannot import (`-m PKCS8` rejects Ed25519).
This script deterministically derives the OpenSSH-format key file the signer
needs.

Inputs (paths):
  argv1 = file holding the PKCS#8 PEM  (vault-cached `private key` field)
  argv2 = file holding the public key  (vault-cached `public key` field)

Both fields are cached in cove's Vault, so this never needs 1Password unlocked.
Prints the OpenSSH-format OPENSSH PRIVATE KEY PEM on stdout.
"""
import base64
import os
import struct
import subprocess
import sys

PKCS8 = sys.argv[1]
PUB_FILE = sys.argv[2]

hexout = subprocess.run(
    ["openssl", "pkey", "-in", PKCS8, "-text", "-noout"],
    capture_output=True, text=True, check=True,
).stdout
lines = hexout.splitlines()
priv_ix = lines.index("priv:")
priv = bytes.fromhex(
    "".join(
        line.replace(" ", "").replace(":", "").strip()
        for line in lines[priv_ix + 1 : priv_ix + 3]
        if ":" in line
    )
)
if len(priv) != 32:
    sys.exit(f"expected a 32-byte Ed25519 private scalar, got {len(priv)}")
pub_ix = lines.index("pub:") if "pub:" in lines else None
if pub_ix is not None:
    pub_from_pem = bytes.fromhex(
        "".join(
            line.replace(" ", "").replace(":", "").strip()
            for line in lines[pub_ix + 1 : pub_ix + 3]
            if ":" in line
        )
    )
else:
    pub_from_pem = None

blob = base64.b64decode(open(PUB_FILE).read().strip().split(" ")[1])
# full blob = string "ssh-ed25519" (len 11) + string 32-byte public key
if blob[:4] != struct.pack(">I", 11) or blob[4:15] != b"ssh-ed25519" or blob[15:19] != struct.pack(">I", 32):
    sys.exit("public key file is not an ssh-ed25519 blob")
key32 = blob[19:]
if pub_from_pem is not None and pub_from_pem != key32:
    sys.exit("PKCS#8 key does not correspond to the cached public key")


def s(data: bytes) -> bytes:
    """OpenSSH 'string': 4-byte big-endian length + bytes."""
    return struct.pack(">I", len(data)) + data


comment = b"cove-vault-cached git signing"
out  = b"openssh-key-v1\x00"
out += s(b"none") + s(b"none") + s(b"")
out += struct.pack(">I", 1) + s(blob)
# No top-level comment string: OpenSSH's own writer goes straight from the
# public key blob to the length-prefixed private section.
section  = struct.pack(">II", 0x56656E75, 0x56656E75)   # paired checkints
section += s(b"ssh-ed25519") + s(key32) + s(priv + key32) + s(comment)
pad = 8 - (len(section) % 8)
if pad < 8:
    section += bytes(range(1, pad + 1))
out += s(section)

print(
    "-----BEGIN OPENSSH PRIVATE KEY-----\n"
    + base64.encodebytes(out).decode()
    + "-----END OPENSSH PRIVATE KEY-----\n",
    end="",
)