const contexts = new Map();

export function setContext(sessionId, key, value) {
  if (!contexts.has(sessionId)) contexts.set(sessionId, new Map());
  contexts.get(sessionId).set(key, value);
}

export function getContext(sessionId, key) {
  if (!contexts.has(sessionId)) return undefined;
  return contexts.get(sessionId).get(key);
}

export function listContext(sessionId) {
  if (!contexts.has(sessionId)) return [];
  return Array.from(contexts.get(sessionId).keys());
}

export function deleteContext(sessionId, key) {
  if (!contexts.has(sessionId)) return false;
  return contexts.get(sessionId).delete(key);
}

export function clearContext(sessionId) {
  if (contexts.has(sessionId)) contexts.get(sessionId).clear();
}
