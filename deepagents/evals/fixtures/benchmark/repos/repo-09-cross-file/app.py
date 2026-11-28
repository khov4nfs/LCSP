"""Synthetic entrypoints. The benchmark parses these files as data."""

from config import CLOUD_MODEL, ENABLE_CLOUD
from service import cloud_request, direct_request, normalize, via_adapter


def summarize_document(text):
    return direct_request(text, CLOUD_MODEL)


def translate_document(text):
    return via_adapter(text, CLOUD_MODEL)


def review_document(text):
    if not ENABLE_CLOUD:
        return normalize(text)
    return cloud_request(text, CLOUD_MODEL)


def normalize_document(text):
    return normalize(text)


def preview_document(text):
    # The earlier return makes the provider call unreachable on this path.
    return normalize(text)
    return cloud_request(text, CLOUD_MODEL)
