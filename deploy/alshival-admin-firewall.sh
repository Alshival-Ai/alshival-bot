#!/usr/bin/env bash
set -euo pipefail

CHAIN="ALSHIVAL_ADMIN"
PORT="3004"
ALLOW_SOURCES=(
  "127.0.0.0/8"
  "10.8.0.0/24"
  "192.168.10.0/24"
  "192.168.20.0/24"
  "192.168.41.0/24"
)

iptables -N "$CHAIN" 2>/dev/null || true
iptables -F "$CHAIN"

for source in "${ALLOW_SOURCES[@]}"; do
  iptables -A "$CHAIN" -s "$source" -p tcp --dport "$PORT" -j ACCEPT
done
iptables -A "$CHAIN" -p tcp --dport "$PORT" -j DROP

while iptables -D INPUT -p tcp --dport "$PORT" -j "$CHAIN" 2>/dev/null; do
  true
done
iptables -I INPUT 1 -p tcp --dport "$PORT" -j "$CHAIN"

ip6tables -N "$CHAIN" 2>/dev/null || true
ip6tables -F "$CHAIN"
ip6tables -A "$CHAIN" -p tcp --dport "$PORT" -j DROP
while ip6tables -D INPUT -p tcp --dport "$PORT" -j "$CHAIN" 2>/dev/null; do
  true
done
ip6tables -I INPUT 1 -p tcp --dport "$PORT" -j "$CHAIN"
