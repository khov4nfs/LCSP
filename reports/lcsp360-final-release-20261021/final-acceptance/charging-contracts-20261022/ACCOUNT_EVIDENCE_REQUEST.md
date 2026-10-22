# Required account-owner evidence — LCSP-360

Status: **BLOCKED_EXTERNAL_CONTRACT_EVIDENCE**. No billing records, authorized portal sessions or verified account-owner contacts were provided. This request is prepared only; it has **not** been sent to anyone. No credentials or payment details are requested.

Start with the LCSP owner of the Mirai credential used by `primary` and `semantic-primary`. The local binding matrix identifies slots with salted PBKDF2 fingerprints; it does not identify or prove ownership of a billing account. Other providers' slots may share accounts or have different contracts.

| Owner / authoritative source | Required account-specific proof |
|---|---|
| LCSP Mirai credential owner + Mirai operator; [public portal](https://miraiapi.com/usage/) | Map the single configured credential to an account/entitlement; confirm the exact model and account ratio, whether prepaid/subscription/promotion/postpay, accepted quota-to-USD or maximum incremental-charge contract, remaining entitlement and dates; establish top-up/overage/renewal/tax/fee behavior. Public ratio 0.5 is insufficient. Do not submit a key to the portal on this agent's behalf. |
| LCSP Inception owner(s) + provider billing/API support; [platform](https://platform.inceptionlabs.ai/) | Map all 14 slots to accounts; supply the accepted standard, promotional or enterprise tariff and dates, including cached input, writes, reasoning, failed requests and fees. Confirm whether the launch discount applies; it cannot be inferred from the older announcement. |
| LCSP Google project owner(s) + Cloud Billing administrator(s); [AI Studio billing](https://aistudio.google.com/billing) | Map all 6 slots to project and billing-account aliases; show actual free/paid tier, prepay/postpay/enterprise contract, currency/FX/taxes, auto-reload, promotion and overage conditions. Confirm which paid cache/tool features can be invoked. Prepaid balances/project caps permit delayed overages. |
| LCSP APX account owner(s) + [official APMIX support](https://apmix.ai/pricing) | Map all 9 slots to accepted account plans and exact `claude-sonnet-4-6-free` entitlement; provide remaining free/prepaid allowance, multiplier, renewal, top-up, exhaustion, overage and tax terms. If relying on zero incremental USD exposure, obtain an explicit guarantee rather than amortizing subscription prices or assuming the free name is sufficient. |

Every account/provider statement must also cover:

1. The exact endpoint, protocol and model, matching `charging-evidence-matrix.json`; account aliases must be linked to the configured credential fingerprints by an authorized administrator.
2. A strict maximum **charged** input/cache bound per physical request that covers system messages, the entire conversation, tool messages and schemas, structured-output definitions, cache reads/writes, provider-added overhead and other units. Context-window marketing labels and local estimators are insufficient.
3. A combined output/reasoning bound imposed by the actual native SDK parameters. Include failed, cancelled, timed-out and ambiguous requests and any minimum/fixed charges. Unknown outcomes must remain reserved.
4. Complete rates after multipliers/FX, rounding quantum, minimum and fixed fees, taxes, storage/time-based costs and separately charged operations. State explicit non-applicability where a bucket is guaranteed absent; silence is not zero.
5. Effective/expiry dates, price-change policy and stable terms for the bounded run window. Explain any prepaid/subscription renewal or external charge that cannot be expressed by the existing per-request policy. Do not invent a USD quota conversion.
6. An authorized owner attestation and an independent reviewer who can inspect the original evidence, recompute conservative exposure and approve the immutable schema-2 policy fingerprint. This agent has reviewed public/local evidence only.

## Secure submission procedure

1. The owner designates an existing approved access-controlled evidence location; none has been supplied. Keep original account documents there. Do not attach secrets, keys, bearer tokens, full billing identifiers, personal/payment details or private documents to the PR or chat.
2. Match the configured slots locally using the matrix's salt and the existing `request_identity` function. Never transmit raw keys. Preserve the original document bytes and compute their SHA-256 locally.
3. Prepare a sanitized extract using pseudonymous account/project aliases, relevant accepted terms/settings, dates, issuer and reviewer. Publish only that shareable extract's digest, the restricted original's digest and a redacted reference authorized for disclosure.
4. The independent reviewer verifies the restricted original against its digest and the slot/account mapping, then signs off the exact charge buckets and hard-bound proof. Validate the resulting policy against current endpoint/model/SDK identities; any change requires a new review.
5. Only complete representable contracts can become production `ChargePolicy` entries. All current routes remain denied. Route reduction or a revised financial envelope requires explicit approval; policy verification itself grants no paid authorization.

**Concrete owner action:** provide the Mirai account-to-slot mapping and dated provider-confirmed complete charging/token-bound statement through the designated restricted evidence location, with a sanitized digest-linked extract for independent review.
