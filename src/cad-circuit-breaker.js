const CB_CLOSED = 0;
const CB_OPEN = 1;
const CB_HALF_OPEN = 2;
const CB_FAILURE_THRESHOLD = 5;
const CB_RESET_TIMEOUT = 10000;

export class CircuitBreaker {
  constructor(connectionId, onOpen, onHalfOpen) {
    this._connId = connectionId;
    this._state = CB_CLOSED;
    this._failureCount = 0;
    this._lastFailureTime = 0;
    this._timer = null;
    this._onOpen = onOpen;
    this._onHalfOpen = onHalfOpen;
  }

  get state() { return this._state; }
  get failureCount() { return this._failureCount; }

  allowRequest() {
    if (this._state === CB_OPEN) {
      const elapsed = Date.now() - this._lastFailureTime;
      if (elapsed >= CB_RESET_TIMEOUT) {
        this._state = CB_HALF_OPEN;
        if (this._onHalfOpen) this._onHalfOpen(this._connId);
      } else {
        return false;
      }
    }
    return true;
  }

  recordSuccess() {
    this._state = CB_CLOSED;
    this._failureCount = 0;
    if (this._timer) { clearTimeout(this._timer); this._timer = null; }
  }

  recordFailure() {
    this._failureCount++;
    this._lastFailureTime = Date.now();
    if (this._failureCount >= CB_FAILURE_THRESHOLD && this._state !== CB_OPEN) {
      this._state = CB_OPEN;
      if (this._onOpen) this._onOpen(this._connId);
      this._timer = setTimeout(() => {
        this._state = CB_HALF_OPEN;
        if (this._onHalfOpen) this._onHalfOpen(this._connId);
      }, CB_RESET_TIMEOUT);
    }
  }

  reset() {
    this._state = CB_CLOSED;
    this._failureCount = 0;
    this._lastFailureTime = 0;
    if (this._timer) { clearTimeout(this._timer); this._timer = null; }
  }
}
