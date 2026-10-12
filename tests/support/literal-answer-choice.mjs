export function findLiteralAnswerChoice(options, answer) {
  const escaped = answer.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(escaped, "i");
  return options.find((text) => pattern.test(text));
}
