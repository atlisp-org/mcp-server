// Re-export shim — all logic migrated to lisp-security.js
export {
  THREAT_BLOCK, THREAT_WARN, THREAT_ALLOW,
  RULES, SECURITY_RULES,
  getSessionAllowlist, addToAllowlist, removeFromAllowlist, clearSessionAllowlist,
  validateLispCode,
} from './lisp-security.js';
