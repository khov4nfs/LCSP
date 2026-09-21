export function redactSecrets<T>(value: T): T {
  if (value == null) {
    return value;
  }

  if (Array.isArray(value)) {
    return value.map((item) => redactSecrets(item)) as T;
  }

  if (typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, child]) => {
        if (/(password|token|secret)/i.test(key)) {
          return [key, "[REDACTED]"];
        }

        return [key, redactSecrets(child)];
      }),
    ) as T;
  }

  return value;
}
