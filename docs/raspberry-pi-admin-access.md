# Raspberry Pi admin access

The Raspberry Pi deployment exposes the admin portal on the private LAN/VPN
address only:

```text
http://192.168.41.106:3004
```

The admin app should keep this runtime binding:

```env
ADMIN_HOST=0.0.0.0
ADMIN_PORT=3004
```

Do not add a public/static-IP destination NAT rule for port `3004`. OPNSense
should route VPN clients to the private address instead.

The Pi also runs `alshival-admin-firewall.service`, which installs an
`ALSHIVAL_ADMIN` iptables chain. Port `3004` is accepted only from:

- `127.0.0.0/8`
- `10.8.0.0/24`
- `192.168.10.0/24`
- `192.168.20.0/24`
- `192.168.41.0/24`

All other IPv4 sources are dropped for port `3004`, and IPv6 access to port
`3004` is dropped.

Install or refresh the Pi-side firewall files with:

```bash
sudo install -m 0755 deploy/alshival-admin-firewall.sh /usr/local/sbin/alshival-admin-firewall.sh
sudo install -m 0644 deploy/alshival-admin-firewall.service /etc/systemd/system/alshival-admin-firewall.service
sudo systemctl daemon-reload
sudo systemctl enable --now alshival-admin-firewall.service
sudo /usr/local/sbin/alshival-admin-firewall.sh
```
