"""Privacy-safe execution signals, never model text or tool arguments."""
from contextvars import ContextVar
from langchain_core.callbacks import BaseCallbackHandler

active_progress = ContextVar("interview_progress", default=None)


class InterviewProgressCallback(BaseCallbackHandler):
    def __init__(self, emit):
        self.emit = emit

    def on_tool_start(self, serialized, input_str, **kwargs):
        self.emit("TOOL_RUNNING")

    def on_tool_end(self, output, **kwargs):
        self.emit("RUNNING")

    def on_tool_error(self, error, **kwargs):
        self.emit("RUNNING")
