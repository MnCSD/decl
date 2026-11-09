import net from 'node:net';

/**
 * True for loopback, LAN (RFC 1918), link-local and IPv6 unique-local addresses.
 * Anything else (a public internet address) is rejected by the server.
 */
export function isPrivateAddress(address: string | undefined): boolean {
  if (!address) return false;

  // Node reports IPv4 clients on a dual-stack socket as "::ffff:192.168.2.20".
  const addr = address.startsWith('::ffff:') ? address.slice(7) : address;

  if (net.isIPv4(addr)) {
    const [a = -1, b = -1] = addr.split('.').map(Number);
    return (
      a === 10 || // 10.0.0.0/8
      a === 127 || // loopback
      (a === 172 && b >= 16 && b <= 31) || // 172.16.0.0/12
      (a === 192 && b === 168) || // 192.168.0.0/16
      (a === 169 && b === 254) // link-local
    );
  }

  if (net.isIPv6(addr)) {
    const lower = addr.toLowerCase();
    return (
      lower === '::1' || // loopback
      /^f[cd]/.test(lower) || // fc00::/7 unique local
      /^fe[89ab]/.test(lower) // fe80::/10 link-local
    );
  }

  return false;
}
