export function nextGenerationEventOffset(offset: string): string {
  if (!/^(0|[1-9][0-9]*)$/.test(offset)) {
    throw new Error("GENERATION_WORKFLOW_EVENT_OFFSET_INVALID");
  }
  const digits = [...offset];
  let carry = 1;
  for (let index = digits.length - 1; index >= 0 && carry === 1; index -= 1) {
    const digit = Number(digits[index]) + carry;
    digits[index] = String(digit % 10);
    carry = digit >= 10 ? 1 : 0;
  }
  if (carry === 1) digits.unshift("1");
  return digits.join("");
}
