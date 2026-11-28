"""Synthetic service with direct, delegated and unused provider calls."""

from openai import OpenAI

from transport import forward_request


def direct_request(text, model):
    return OpenAI().responses.create(model=model, input=text)


def via_adapter(text, model):
    return forward_request(text, model)


def cloud_request(text, model):
    return direct_request(text, model)


def normalize(text):
    return text.strip()


def unused_provider(text):
    return OpenAI().responses.create(model="unused", input=text)
