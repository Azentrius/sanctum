// SPDX-License-Identifier: GPL-3.0-or-later
const router = require('./proxy.router.js');

module.exports = {
  '/nextcloud-proxy': {
    target: 'http://localhost',
    // Dev proxy only: upstream may be Caddy with an internal IP; skip TLS verify.
    secure: false,
    changeOrigin: true,
    pathRewrite: { '^/nextcloud-proxy': '' },
    // The Vite dev server has no `router` option, so the target of each request is set here.
    // Without an accepted target the request goes to the default target above.
    configure(proxy) {
      const web = proxy.web;
      proxy.web = (req, res, options, ...rest) => {
        const target = router(req);
        return web.call(proxy, req, res, target ? { ...options, target } : options, ...rest);
      };
    },
  },
};
