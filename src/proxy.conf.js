// SPDX-License-Identifier: GPL-3.0-or-later
const router = require('./proxy.router.js');

module.exports = {
  '/nextcloud-proxy': {
    target: 'http://localhost',
    // Dev proxy only: upstream may be Caddy with an internal IP; skip TLS verify.
    secure: false,
    changeOrigin: true,
    logLevel: 'debug',
    pathRewrite: { '^/nextcloud-proxy': '' },
    router,
  },
};
