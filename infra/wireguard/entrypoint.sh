#!/bin/sh
set -e

# Take ownership of wg0: down any existing instance, then apply config
wg-quick down wg0 2>/dev/null || true

if [ -f /etc/wireguard/wg0.conf ]; then
  wg-quick up wg0
fi

# Route replies from the WAN public IP via its own interface so the
# source address is preserved (carrier NAT on mobile peers rejects
# replies coming from a different public IP).
if [ -n "$WG_WAN_IP" ] && [ -n "$WG_WAN_IF" ] && [ -n "$WG_WAN_GW" ]; then
  ip rule add from "$WG_WAN_IP" lookup 100 2>/dev/null || true
  ip route replace default via "$WG_WAN_GW" dev "$WG_WAN_IF" table 100 2>/dev/null || true
fi

trap 'wg-quick down wg0 2>/dev/null || true; exit 0' TERM INT

echo "WireGuard container active on wg0"
while true; do
  sleep 3600 &
  wait $!
done