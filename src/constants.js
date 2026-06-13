export const DEFAULT_SETTINGS = {
  enabled: "1",
  copy_mode: "black",
  target_channel_id: "",
};

export const DEFAULT_PROTOCOLS = [
  ["vmess://", "VMess"],
  ["vless://", "VLESS"],
  ["trojan://", "Trojan"],
  ["ss://", "Shadowsocks"],
  ["ss2022://", "Shadowsocks 2022"],
  ["socks://", "SOCKS"],
  ["socks5://", "SOCKS5"],
  ["http://", "HTTP"],
  ["https://", "HTTPS"],
  ["mtproto://", "MTProto"],
  ["hy2://", "Hysteria2"],
  ["hysteria2://", "Hysteria2"],
  ["wireguard://", "WireGuard"],
  ["wg://", "WireGuard"],

  ["tcp://", "TCP"],
  ["ws://", "WebSocket"],
  ["wss://", "WebSocket TLS"],
  ["grpc://", "gRPC"],
  ["kcp://", "mKCP"],
  ["mkcp://", "mKCP"],
  ["quic://", "QUIC"],
  ["h2://", "HTTP/2"],
  ["httpupgrade://", "HTTPUpgrade"],
  ["meek://", "meek"],
  ["domainsocket://", "DomainSocket"],
  ["unix://", "Unix Domain Socket"],
  ["gdocs://", "Google Docs Viewer"],

  ["freedom://", "Freedom"],
  ["blackhole://", "Blackhole"],
  ["dokodemo-door://", "Dokodemo-door"],
  ["dokodemo://", "Dokodemo"],
  ["dns://", "DNS"],
  ["loopback://", "Loopback"],
  ["vlite://", "vLite"],

  ["dnst://", "DNS Tunnel Unified"],

  ["dnstt://", "DNSTT"],
  ["vaydns://", "VayDNS"],
  ["slipstream://", "Slipstream"],
  ["stormdns://", "StormDNS"],
  ["masterdns://", "MasterDNS"],
  ["masterdnsvpn://", "MasterDnsVPN"],
  ["noizdns://", "NoizDNS"],

  ["slowdns://", "SlowDNS"],
  ["ssh-dns://", "SSH over DNS"],
  ["dns-ssh://", "SSH over DNS"],
  ["ssh-over-dns://", "SSH over DNS"],

  ["iodine://", "Iodine"],
  ["iodined://", "Iodine"],
  ["dns2tcp://", "DNS2TCP"],
  ["tcp-over-dns://", "TCP over DNS"],
  ["udp-over-dns://", "UDP over DNS"],
  ["ip-over-dns://", "IP over DNS"],

  ["nstx://", "NSTX"],
  ["ozymandns://", "OzymanDNS"],
  ["dnscat://", "DNScat"],
  ["dnscat2://", "DNScat2"],
  ["heyoka://", "Heyoka"],
  ["element53://", "Element53"],
  ["magic-tunnel://", "MagicTunnel"],
  ["vpn-over-dns://", "VPN over DNS"],

  ["dns-tunnel://", "Generic DNS Tunnel"],
  ["dnstunnel://", "Generic DNS Tunnel"],
  ["dnsudp://", "DNS over UDP Tunnel"],
  ["dnstcp://", "DNS over TCP Tunnel"],

  ["doh://", "DNS over HTTPS"],
  ["dns-over-https://", "DNS over HTTPS"],
  ["dot://", "DNS over TLS"],
  ["dns-over-tls://", "DNS over TLS"],
  ["doq://", "DNS over QUIC"],
  ["dns-over-quic://", "DNS over QUIC"],
  ["do53://", "Plain DNS over UDP/TCP 53"],
  ["dnscrypt://", "DNSCrypt"]
];

export const PERMISSIONS = [
  ["can_toggle_bot", "فعال/غیرفعال کردن ربات"],
  ["can_manage_whitelist", "مدیریت لیست سفید"],
  ["can_manage_blacklist", "مدیریت لیست سیاه"],
  ["can_manage_mode", "تغییر حالت Black/White"],
  ["can_manage_target_channel", "تغییر کانال مقصد"],
  ["can_manage_protocol_add", "افزودن پروتکل"],
  ["can_manage_protocol_edit", "ویرایش پروتکل"],
  ["can_manage_protocol_delete", "حذف پروتکل"],
];

export const SESSION_TTL_MINUTES = 30;
