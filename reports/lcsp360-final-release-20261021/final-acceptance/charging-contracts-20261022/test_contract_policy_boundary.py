"""Financial evidence checks with synthetic policies only; never provider billing proof."""
from itertools import product
import time

import pytest
from pydantic import ValidationError

from test_paid_admission import offline, native, policy_for, state_for, req
from middleware.failure_policy import PaidAdmissionError
from middleware.paid_admission import ChargePolicy
from middleware.usage_metering import UsageMeteringMiddleware, activate_agent_run_state


@pytest.mark.parametrize("missing", ["input_rate", "cache_read_rate", "cache_write_rate",
    "output_rate", "reasoning_rate", "fixed_charge", "minimum_charge", "rounding_quantum",
    "coverage", "input_upper_bound", "output_upper_bound", "evidence_sha256"])
def test_missing_contract_evidence_cannot_become_a_policy(missing):
    fields = policy_for(native()).model_dump()
    fields.pop(missing)
    with pytest.raises(ValidationError):
        ChargePolicy(**fields)


def test_future_dated_contract_denies_before_handler(tmp_path):
    model = native()
    policy = policy_for(model).model_copy(update={"valid_from": int(time.time()) + 3600})
    state = state_for(tmp_path, model, policies=(policy,))
    calls = []
    with activate_agent_run_state(state), pytest.raises(PaidAdmissionError, match="UNVERIFIED_POLICY"):
        UsageMeteringMiddleware().wrap_model_call(req(model), lambda _: calls.append(1))
    assert calls == []


def test_independent_worst_case_minimum_and_rounding_arithmetic():
    original = policy_for(native()).model_dump()
    checked = 0
    for fixed, minimum, quantum in product([0, 7], [0, 1001], [1, 10, 100]):
        policy = ChargePolicy(**{**original, "input_upper_bound": 30, "output_upper_bound": 20,
            "fixed_charge": fixed, "minimum_charge": minimum, "rounding_quantum": quantum})
        charges = []
        # Corners cover every token assigned to each input/cache/output/reasoning bucket.
        for input_bucket, output_bucket in product(range(3), range(2)):
            counts = [0, 0, 0, 0, 0]
            counts[input_bucket] = 30
            counts[3 + output_bucket] = 20
            raw = fixed + sum(n * r for n, r in zip(counts, [10, 2, 15, 30, 40]))
            floor = max(raw, minimum)
            expected = floor + (-floor % quantum)
            actual = policy.charge(*counts[:3], counts[3] + counts[4], counts[4])
            assert actual == expected
            charges.append(expected)
            checked += 1
        assert policy.exposure() == max(charges)
        zero_floor = max(fixed, minimum)
        assert policy.charge(0, 0, 0, 0, 0) == zero_floor + (-zero_floor % quantum)
    assert checked == 72
