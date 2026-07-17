function requireEncryptionKey(): Uint8Array<ArrayBuffer> {
  const encoded = process.env.INTEGRATION_ENCRYPTION_KEY;
  if (!encoded) throw new Error("Integration encryption is not configured.");
  const key = Buffer.from(encoded, "base64");
  if (key.byteLength !== 32) throw new Error("Integration encryption key must be 32 bytes.");
  const bytes = new Uint8Array(key.byteLength);
  bytes.set(key);
  return bytes;
}

export async function encryptIntegrationSecret(value: string): Promise<{ ciphertext: string; iv: string }> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await crypto.subtle.importKey("raw", requireEncryptionKey(), "AES-GCM", false, ["encrypt"]);
  const encrypted = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, new TextEncoder().encode(value));
  return {
    ciphertext: Buffer.from(encrypted).toString("base64"),
    iv: Buffer.from(iv).toString("base64"),
  };
}

export async function decryptIntegrationSecret(ciphertext: string, iv: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", requireEncryptionKey(), "AES-GCM", false, ["decrypt"]);
  const decrypted = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: Buffer.from(iv, "base64") },
    key,
    Buffer.from(ciphertext, "base64"),
  );
  return new TextDecoder().decode(decrypted);
}
