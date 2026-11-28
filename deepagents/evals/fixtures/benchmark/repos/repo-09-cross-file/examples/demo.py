"""Example-only use of the production service."""

from service import direct_request


def demo_document(text):
    return direct_request(text, "demo-model")
