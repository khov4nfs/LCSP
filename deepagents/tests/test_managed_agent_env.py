import os

from tools.common.capabilities.platform.env import load_runtime_env


def test_runtime_env_loads_dotenv_by_default(monkeypatch, tmp_path):
    env_file = tmp_path / ".env"
    env_file.write_text("WORKER_API_KEY=dotenv-key\n", encoding="utf-8")
    monkeypatch.chdir(tmp_path)
    monkeypatch.delenv("WORKER_API_KEY", raising=False)

    loaded = load_runtime_env()

    assert loaded == str(env_file)
    assert os.environ["WORKER_API_KEY"] == "dotenv-key"


def test_runtime_env_does_not_override_process_env(monkeypatch, tmp_path):
    env_file = tmp_path / ".env"
    env_file.write_text(
        "NESTJS_API_BASE_URL=http://dotenv-api.test\n"
        "WORKER_API_KEY=dotenv-key\n",
        encoding="utf-8",
    )
    monkeypatch.chdir(tmp_path)
    monkeypatch.setenv("WORKER_API_KEY", "process-key")
    monkeypatch.delenv("NESTJS_API_BASE_URL", raising=False)

    loaded = load_runtime_env()

    assert loaded == str(env_file)
    assert os.environ["NESTJS_API_BASE_URL"] == "http://dotenv-api.test"
    assert os.environ["WORKER_API_KEY"] == "process-key"


def test_runtime_env_returns_none_when_no_dotenv_exists(monkeypatch, tmp_path):
    monkeypatch.chdir(tmp_path)

    loaded = load_runtime_env()

    assert loaded is None
