export function assertSameRequest(entry, fingerprint, message = "submissionId was already used for a different message") {
  if (entry.fingerprint !== fingerprint) throw Object.assign(new Error(message), { statusCode: 409 });
}
