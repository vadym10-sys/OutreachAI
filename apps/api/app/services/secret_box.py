from __future__ import annotations

import base64
import hashlib

from cryptography.fernet import Fernet, InvalidToken


class SecretBoxError(RuntimeError):
    pass


def _fernet_key(raw_key: str) -> bytes:
    if not raw_key or raw_key == "replace-with-32-byte-url-safe-key":
        raise SecretBoxError("A custom encryption key is required before storing mailbox credentials.")
    digest = hashlib.sha256(raw_key.encode("utf-8")).digest()
    return base64.urlsafe_b64encode(digest)


def encrypt_secret(value: str, raw_key: str) -> str:
    clean = value.strip()
    if not clean:
        return ""
    return Fernet(_fernet_key(raw_key)).encrypt(clean.encode("utf-8")).decode("utf-8")


def decrypt_secret(value: str, raw_key: str) -> str:
    clean = value.strip()
    if not clean:
        return ""
    try:
        return Fernet(_fernet_key(raw_key)).decrypt(clean.encode("utf-8")).decode("utf-8")
    except InvalidToken as exc:
        raise SecretBoxError("Stored mailbox credential could not be decrypted.") from exc
