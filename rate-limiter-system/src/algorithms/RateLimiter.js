/**
 * base class — defines the interface every algorithm must implement
 * all algorithms extend this and override allowRequest()
 */
class RateLimiter {
  constructor(options = {}) {
    if (new.target === RateLimiter) {
      throw new Error('RateLimiter is abstract — extend it, don\'t instantiate it directly');
    }
    this.options = options;
  }

  // decide whether to allow a request for the given key
  allowRequest(key) { 
    throw new Error(`${this.constructor.name} must implement allowRequest(key)`);
  }
}

module.exports = RateLimiter;
