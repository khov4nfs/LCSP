"""Synthetic transport boundary for an indirect AI invocation."""

from openai import OpenAI


def forward_request(text, model):
    client = OpenAI()
    return client.responses.create(model=model, input=text)
