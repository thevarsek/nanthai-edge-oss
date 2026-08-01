const TEST_IV = "AQEBAQEBAQEBAQEB";
const TEST_CIPHERTEXTS = {
  2: "AgICAgICAgICAgICAgICAgI",
  3: "AwMDAwMDAwMDAwMDAwMDAwM",
} as const;

export function testCredentialEnvelope(seed: keyof typeof TEST_CIPHERTEXTS = 2): string {
  const ciphertextAndTag = TEST_CIPHERTEXTS[seed];
  return `enc:v2:k1:${TEST_IV}:${ciphertextAndTag}`;
}

export function testEncryptedOAuthArgs(): {
  encryptedAccessToken: string;
  encryptedRefreshToken: string;
  secretEnvelopeVersion: 2;
  secretKeyId: "k1";
} {
  return {
    encryptedAccessToken: testCredentialEnvelope(2),
    encryptedRefreshToken: testCredentialEnvelope(3),
    secretEnvelopeVersion: 2,
    secretKeyId: "k1",
  };
}
