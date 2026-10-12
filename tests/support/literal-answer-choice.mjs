export function findLiteralAnswerChoice(options, answer) {
  const needle = answer.toLowerCase();
  return options.find((text) => text.toLowerCase().includes(needle));
}
