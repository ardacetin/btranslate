'use strict';

/**
 * Wrap an async Express 4 handler so a rejected promise reaches the app-level
 * error handler via next(err). Express 4 ignores the promise an async handler
 * returns, so without this a DB error leaves the request hanging until the
 * client times out.
 *
 *   router.get('/x', wrap(async (req, res) => { ... }));
 */
function wrap(fn) {
  return function wrapped(req, res, next) {
    Promise.resolve()
      .then(() => fn(req, res, next))
      .catch(next);
  };
}

module.exports = { wrap, asyncHandler: wrap };
