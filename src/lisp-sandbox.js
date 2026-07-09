import { log, error as logError } from './logger.js';
import config from './config.js';
import { SECURITY_RULES, THREAT_BLOCK, THREAT_WARN, THREAT_ALLOW, stripStringsAndComments, getEffectiveSeverity } from './lisp-security.js';

export { THREAT_BLOCK, THREAT_WARN, THREAT_ALLOW };

export const RULES = SECURITY_RULES;

const sessionAllowlist = new Map();

export function getSessionAllowlist(sessionId) {
  if (!sessionAllowlist.has(sessionId)) {
    sessionAllowlist.set(sessionId, new Set());
  }
  return sessionAllowlist.get(sessionId);
}

export function addToAllowlist(sessionId, ruleIndex) {
  const list = getSessionAllowlist(sessionId);
  list.add(ruleIndex);
}

export function removeFromAllowlist(sessionId, ruleIndex) {
  const list = getSessionAllowlist(sessionId);
  list.delete(ruleIndex);
}

export function clearSessionAllowlist(sessionId) {
  sessionAllowlist.delete(sessionId);
}

export function validateLispCode(code, sessionId = null) {
  const withoutComments = stripStringsAndComments(code);
  const effectiveSeverity = getEffectiveSeverity();

  const results = [];
  let blocked = false;

  for (let i = 0; i < RULES.length; i++) {
    const rule = RULES[i];
    if (rule.re.test(withoutComments)) {
      const isAllowed = sessionId && getSessionAllowlist(sessionId).has(i);

      const severity = effectiveSeverity === THREAT_ALLOW ? THREAT_ALLOW
        : isAllowed ? THREAT_ALLOW
        : effectiveSeverity;

      results.push({
        ruleIndex: i,
        severity,
        message: rule.msg,
        blocked: severity === THREAT_BLOCK,
        warned: severity === THREAT_WARN,
        allowed: severity === THREAT_ALLOW,
      });
      if (severity === THREAT_BLOCK) {
        blocked = true;
      }
    }
  }

  return {
    valid: !blocked,
    blocked,
    results,
    summary: blocked ? `安全限制: ${results.filter(r => r.blocked).map(r => r.message).join('; ')}` : '通过',
  };
}
