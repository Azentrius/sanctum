#!/usr/bin/env bash
# SPDX-License-Identifier: GPL-3.0-or-later
#
# Starts a Nextcloud for the sync tests of the CI job `sync`: Nextcloud with SQLite, behind an nginx
# proxy that speaks TLS with a certificate made for this run. The emulator reaches the host as
# 10.0.2.2, so the certificate is made for that address. Writes NC_URL, NC_USER, NC_PASSWORD and
# NC_CERT (base64 DER) to $GITHUB_ENV. Fails when the server is not ready within five minutes.
set -euo pipefail

NEXTCLOUD_IMAGE='nextcloud:34.0.5-apache@sha256:515c072ea1cf82ece3503f301fdf75dd5a7148abcc8fa10aaefd5ec56643b703'
NGINX_IMAGE='nginx:1.30.6-alpine@sha256:0e52bd054126cdc040b1276c0af347aeb02a41b9cfe305d6094767ac30e97949'

dir="$(mktemp -d)"
password="$(openssl rand -hex 16)"
echo "::add-mask::$password"

openssl req -x509 -newkey ec -pkeyopt ec_paramgen_curve:prime256v1 -nodes -days 2 \
  -subj '/CN=sanctum-ci' -addext 'subjectAltName=IP:10.0.2.2,DNS:localhost' \
  -keyout "$dir/key.pem" -out "$dir/cert.pem" 2> /dev/null

cat > "$dir/nginx.conf" << 'EOF'
server {
  listen 8443 ssl;
  ssl_certificate /etc/nginx/tls/cert.pem;
  ssl_certificate_key /etc/nginx/tls/key.pem;
  client_max_body_size 16m;
  location / {
    proxy_pass http://nextcloud:80;
    proxy_set_header Host $http_host;
    proxy_set_header X-Forwarded-Proto https;
  }
}
EOF

docker network create sanctum-ci > /dev/null
docker run -d --name nextcloud --network sanctum-ci \
  -e SQLITE_DATABASE=nextcloud \
  -e NEXTCLOUD_ADMIN_USER=admin \
  -e NEXTCLOUD_ADMIN_PASSWORD="$password" \
  -e NEXTCLOUD_TRUSTED_DOMAINS='10.0.2.2 localhost' \
  -e OVERWRITEPROTOCOL=https \
  "$NEXTCLOUD_IMAGE" > /dev/null
docker run -d --name nextcloud-proxy --network sanctum-ci -p 8443:8443 \
  -v "$dir/nginx.conf:/etc/nginx/conf.d/default.conf:ro" \
  -v "$dir:/etc/nginx/tls:ro" \
  "$NGINX_IMAGE" > /dev/null

# Ready means CalDAV answers the admin through the proxy
status=''
for _ in $(seq 1 60); do
  status="$(curl -s -o /dev/null -w '%{http_code}' --cacert "$dir/cert.pem" -u "admin:$password" \
    -X PROPFIND -H 'Depth: 0' https://localhost:8443/remote.php/dav/ || true)"
  [ "$status" = 207 ] && break
  sleep 5
done
if [ "$status" != 207 ]; then
  echo "Nextcloud did not answer CalDAV within five minutes (last HTTP status: ${status:-none})" >&2
  docker logs nextcloud 2>&1 | tail -50 >&2
  exit 1
fi

{
  echo 'NC_URL=https://10.0.2.2:8443'
  echo 'NC_USER=admin'
  echo "NC_PASSWORD=$password"
  echo "NC_CERT=$(openssl x509 -in "$dir/cert.pem" -outform der | base64 -w0)"
} >> "$GITHUB_ENV"
echo "Nextcloud is ready at https://10.0.2.2:8443 (https://localhost:8443 on the runner)"
