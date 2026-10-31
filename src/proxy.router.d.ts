// SPDX-License-Identifier: GPL-3.0-or-later
/** Type declarations for the CommonJS dev-proxy router (src/proxy.router.js). */
interface ProxyRouterRequest {
  headers: Record<string, string | undefined>;
}

interface ProxyRouter {
  (req: ProxyRouterRequest): string | undefined;
  /** Exported for unit tests: true when `target` is a safe https proxy destination. */
  isAllowedProxyTarget(target: string): boolean;
}

declare const proxyRouter: ProxyRouter;
export default proxyRouter;
