"""Worker-local capability envelope encryption and keyring management.

Business purpose:
Protect in-flight capability tokens and admission recovery snapshots stored in worker local
storage against offline extraction from disk sectors, WAL files, or crash dumps.

Business rules:
- Uses AES-256-GCM authenticated encryption with a random 12-byte nonce per envelope.
- Binds Authenticated Associated Data (AAD) containing record kind, admission ID, invocation ID,
  and run ID so ciphertexts cannot be swapped between rows or runs.
- Startup validation: requires exactly 32-byte active key; fails closed on missing, empty, or short key.
- Key rotation: supports active key for encryption, and a retired keyring for decrypting older envelopes.
- Decrypting tampered or corrupt envelope fails closed with CorruptedEnvelopeError.

Execution flow:
1. Initialize keyring with active key ID, 32-byte active key, and optional retired keys dict.
2. Self-test validates encrypt/decrypt round-trip at startup.
3. Encrypt generates 12-byte random IV, computes ciphertext and tag over plaintext and AAD.
4. Decrypt looks up key by key ID (active or retired), validates tag against AAD, and returns plaintext.
5. Re-encrypt decrypts using historical key and re-encrypts using active key.

Failure cases:
- Missing, short, or invalid key format raises EnvelopeCryptoStartupError.
- Ciphertext corruption or tag mismatch raises CorruptedEnvelopeError.
- Unknown key ID raises UnknownKeyIdError.

Side effects:
- Executes cryptographic self-test at worker initialization.
"""
from __future__ import annotations

import base64
import json
import os
from typing import Any
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from cryptography.exceptions import InvalidTag


class EnvelopeCryptoStartupError(Exception):
    """Raised when worker startup key validation fails."""
    pass


class CorruptedEnvelopeError(Exception):
    """Raised when envelope tag mismatch, AAD mismatch, or ciphertext is corrupted."""
    pass


class UnknownKeyIdError(Exception):
    """Raised when an envelope was encrypted with a key not in active or retired keyring."""
    pass


def compute_recovery_aad(record_kind: str, admission_id: str, invocation_id: str, run_id: str) -> bytes:
    """Business purpose: Construct canonical Authenticated Associated Data (AAD) binding for recovery envelope.

    Business rules:
    - Must bind record kind, admission ID, invocation ID, and run ID as utf-8 bytes.
    - Ensures ciphertext cannot be transplanted or swapped across database rows or execution runs.

    Execution flow:
    1. Format composite string with delimiter.
    2. Encode string into UTF-8 byte array.

    Failure cases:
    - Deterministic string formatting; does not raise.

    Side effects:
    - Pure computation; no external or persistence side effects.
    """
    # Why: Cryptographically bind ciphertext to specific admission, invocation, and run identities.
    # How: Compute colon-delimited UTF-8 byte representation passed to AES-256-GCM AEAD tag calculation.
    # Invariants: Prevents row-swapping and replay attacks between distinct admissions or runs.
    return f"{record_kind}:{admission_id}:{invocation_id}:{run_id}".encode("utf-8")


class WorkerEnvelopeKeyring:
    """Manages worker-local encryption keys and AEAD operations."""

    def __init__(
        self,
        active_key_id: str | None = None,
        active_key_bytes: bytes | None = None,
        retired_keys: dict[str, bytes] | None = None,
    ) -> None:
        if not active_key_id or not isinstance(active_key_id, str):
            raise EnvelopeCryptoStartupError("Active key ID must be a non-empty string")
        if active_key_bytes is None or not isinstance(active_key_bytes, (bytes, bytearray)):
            raise EnvelopeCryptoStartupError("Active key bytes must be provided as bytes")
        if len(active_key_bytes) != 32:
            raise EnvelopeCryptoStartupError(f"Active key must be exactly 32 bytes (256 bits), got {len(active_key_bytes)}")

        self.active_key_id = active_key_id
        self._active_key = bytes(active_key_bytes)
        self._retired_keys: dict[str, bytes] = {}

        if retired_keys:
            for kid, kbytes in retired_keys.items():
                if len(kbytes) != 32:
                    raise EnvelopeCryptoStartupError(f"Retired key '{kid}' must be exactly 32 bytes")
                self._retired_keys[kid] = bytes(kbytes)

        # Startup self-test to fail closed before any worker model work
        self._self_test()

    @classmethod
    def from_env(cls) -> WorkerEnvelopeKeyring:
        """Business purpose: Initialize keyring securely from environment variables.

        Business rules:
        - WORKER_ENVELOPE_ENCRYPTION_KEY is mandatory; fails closed if unset or empty.
        - Accepts 64-hex character string or 32-byte raw string.
        - Parses optional WORKER_ENVELOPE_RETIRED_KEYS JSON map.

        Execution flow:
        1. Resolve active key ID from WORKER_ENVELOPE_ACTIVE_KEY_ID (default: 'v1').
        2. Resolve and decode 32-byte active key from WORKER_ENVELOPE_ENCRYPTION_KEY.
        3. Parse retired keys map from WORKER_ENVELOPE_RETIRED_KEYS if configured.
        4. Instantiate keyring and execute startup self-test.

        Failure cases:
        - Missing, short, or invalid hex key raises EnvelopeCryptoStartupError.

        Side effects:
        - Reads process environment variables and validates cryptographic subsystem.
        """
        # Why: Worker requires encryption keys configured via 12-factor environment variables.
        # How: Parse hex or raw string into 32-byte binary key, load retired keys if present.
        # Invariants: Must fail closed if key is missing, short, or invalid hex.
        active_kid = os.environ.get("WORKER_ENVELOPE_ACTIVE_KEY_ID", "v1").strip()
        raw_key = os.environ.get("WORKER_ENVELOPE_ENCRYPTION_KEY")
        if not raw_key or not raw_key.strip():
            raise EnvelopeCryptoStartupError("WORKER_ENVELOPE_ENCRYPTION_KEY environment variable is required")

        raw_key = raw_key.strip()
        if len(raw_key) == 64:
            try:
                active_key_bytes = bytes.fromhex(raw_key)
            except ValueError as e:
                raise EnvelopeCryptoStartupError(f"WORKER_ENVELOPE_ENCRYPTION_KEY hex decoding failed: {e}") from e
        else:
            active_key_bytes = raw_key.encode("utf-8")

        retired_keys: dict[str, bytes] = {}
        retired_env = os.environ.get("WORKER_ENVELOPE_RETIRED_KEYS")
        if retired_env and retired_env.strip():
            try:
                retired_map = json.loads(retired_env)
                for kid, val in retired_map.items():
                    val = str(val).strip()
                    if len(val) == 64:
                        retired_keys[kid] = bytes.fromhex(val)
                    else:
                        retired_keys[kid] = val.encode("utf-8")
            except Exception as e:
                raise EnvelopeCryptoStartupError(f"Failed to parse WORKER_ENVELOPE_RETIRED_KEYS: {e}") from e

        return cls(active_key_id=active_kid, active_key_bytes=active_key_bytes, retired_keys=retired_keys)

    def _self_test(self) -> None:
        """Business purpose: Execute internal encryption round-trip to verify crypto subsystem health.

        Business rules:
        - Must encrypt and decrypt probe payload using active key and self-test AAD.
        - Fails closed immediately if probe decryption does not match original plaintext.

        Execution flow:
        1. Create synthetic probe and AAD bytes.
        2. Encrypt with active key using AESGCM.
        3. Decrypt with active key.
        4. Assert decrypted payload matches probe.

        Failure cases:
        - Tag failure or plaintext mismatch raises EnvelopeCryptoStartupError.

        Side effects:
        - Generates 12 bytes of system entropy; no external state persisted.
        """
        # Why: Ensure AES-256-GCM hardware or software implementation is operational before worker accepts jobs.
        # How: Execute round-trip encrypt and decrypt of a constant probe.
        # Invariants: Fails closed on any cryptographic error.
        try:
            probe = b"lcsp-startup-self-test-probe"
            probe_aad = b"SELF_TEST:probe:probe:probe"
            aesgcm = AESGCM(self._active_key)
            nonce = os.urandom(12)
            ct = aesgcm.encrypt(nonce, probe, probe_aad)
            dt = aesgcm.decrypt(nonce, ct, probe_aad)
            if dt != probe:
                raise ValueError("Self-test decrypted payload mismatch")
        except Exception as error:
            raise EnvelopeCryptoStartupError(f"Worker encryption startup self-test failed: {error}") from error

    def encrypt_payload(self, plaintext: str | bytes, aad: bytes) -> str:
        """Business purpose: Encrypt payload with active key and return canonical JSON envelope.

        Business rules:
        - Generates fresh 12-byte random nonce per encryption.
        - Computes ciphertext and authentication tag over plaintext and provided AAD.
        - Serializes result into versioned JSON envelope containing key ID (kid), nonce, and ciphertext.

        Execution flow:
        1. Normalize plaintext to bytes.
        2. Generate 12-byte cryptographically secure random nonce.
        3. Encrypt payload with active AESGCM key and AAD.
        4. Encode nonce and ciphertext to base64.
        5. Return compact, key-sorted JSON envelope string.

        Failure cases:
        - Cryptographic encryption errors propagate to caller.

        Side effects:
        - Consumes 12 bytes of secure system randomness.
        """
        # Why: Protect sensitive recovery token data before storing on worker disk.
        # How: Uses AES-256-GCM with unique 96-bit nonce and AAD binding.
        # Invariants: Plaintext tokens are never persisted directly.
        data = plaintext.encode("utf-8") if isinstance(plaintext, str) else bytes(plaintext)
        nonce = os.urandom(12)
        aesgcm = AESGCM(self._active_key)
        ciphertext = aesgcm.encrypt(nonce, data, aad)

        envelope = {
            "version": 1,
            "kid": self.active_key_id,
            "nonce": base64.b64encode(nonce).decode("ascii"),
            "ct": base64.b64encode(ciphertext).decode("ascii"),
        }
        return json.dumps(envelope, separators=(",", ":"), sort_keys=True)

    def decrypt_payload(self, envelope_json: str, aad: bytes) -> str:
        """Business purpose: Decrypt canonical JSON envelope looking up key by key ID.

        Business rules:
        - Parses envelope JSON and extracts key identifier.
        - Supports active key or retired keys for decryption.
        - Authenticates AAD against GCM tag; fails closed if tag or AAD does not match.

        Execution flow:
        1. Parse JSON envelope and validate presence of kid, nonce, and ct.
        2. Resolve key bytes from active key or retired keyring.
        3. Decode base64 nonce and ciphertext.
        4. Decrypt and authenticate using AESGCM.
        5. Decode plaintext bytes to UTF-8 string and return.

        Failure cases:
        - Malformed JSON raises CorruptedEnvelopeError.
        - Missing or unknown key ID raises UnknownKeyIdError.
        - Tampered ciphertext, bad tag, or AAD mismatch raises CorruptedEnvelopeError.

        Side effects:
        - Read-only decryption; no persistence side effects.
        """
        # Why: Recover previously encrypted capability tokens and envelopes.
        # How: Verify tag against AAD using designated key from active or retired keyring.
        # Invariants: Fails closed on any tampering, tag mismatch, or unrecognized key.
        try:
            envelope = json.loads(envelope_json)
        except Exception as error:
            raise CorruptedEnvelopeError("Envelope is not valid JSON") from error

        kid = envelope.get("kid")
        if not kid:
            raise CorruptedEnvelopeError("Envelope missing key ID ('kid')")

        key: bytes | None = None
        if kid == self.active_key_id:
            key = self._active_key
        elif kid in self._retired_keys:
            key = self._retired_keys[kid]
        else:
            raise UnknownKeyIdError(f"Unknown key ID '{kid}' - cannot decrypt historical envelope")

        try:
            nonce = base64.b64decode(envelope["nonce"])
            ciphertext = base64.b64decode(envelope["ct"])
            aesgcm = AESGCM(key)
            decrypted = aesgcm.decrypt(nonce, ciphertext, aad)
            return decrypted.decode("utf-8")
        except InvalidTag as error:
            raise CorruptedEnvelopeError("Ciphertext or AAD mismatch; tag verification failed") from error
        except Exception as error:
            raise CorruptedEnvelopeError(f"Decryption failed: {error}") from error
