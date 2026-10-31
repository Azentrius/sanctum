// SPDX-License-Identifier: GPL-3.0-or-later
export interface LoginFlowInitResponse {
  poll: {
    token: string;
    endpoint: string;
  };
  login: string;
}

export interface LoginFlowPollResponse {
  server: string;
  loginName: string;
  appPassword: string;
}

export interface NextcloudCredentials {
  serverUrl: string;
  loginName: string;
  appPassword: string;
}
