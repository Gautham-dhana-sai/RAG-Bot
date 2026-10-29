import dns from 'dns';
import net from 'net';
import ipaddr from 'ipaddr.js';

export class SsrfValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SsrfValidationError';
  }
}

/**
 * Validates whether an IP address is private, loopback, link-local, reserved,
 * multicast, or internal cloud metadata.
 */
export function isBlockedIp(ipString: string): boolean {
  try {
    let addr = ipaddr.parse(ipString);

    // If it's an IPv4-mapped IPv6 address (e.g. ::ffff:192.168.1.1), unmap to IPv4
    if (addr.kind() === 'ipv6') {
      const ipv6 = addr as ipaddr.IPv6;
      if (ipv6.isIPv4MappedAddress()) {
        addr = ipv6.toIPv4Address();
      }
    }

    if (addr.kind() === 'ipv4') {
      const range = (addr as ipaddr.IPv4).range();
      // ipaddr.js identifies: 'unicast', 'unspecified', 'broadcast', 'linkLocal',
      // 'loopback', 'carrierGradeNat', 'private', 'reserved'
      const blockedRanges = [
        'unspecified',
        'broadcast',
        'linkLocal',
        'loopback',
        'carrierGradeNat',
        'private',
        'reserved',
      ];
      if (blockedRanges.includes(range)) {
        return true;
      }

      // Explicit check for AWS/cloud metadata IP: 169.254.169.254
      const octets = (addr as ipaddr.IPv4).toByteArray();
      if (octets[0] === 169 && octets[1] === 254) {
        return true;
      }
      if (octets[0] === 127 || octets[0] === 10 || octets[0] === 0) {
        return true;
      }
      if (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31) {
        return true;
      }
      if (octets[0] === 192 && octets[1] === 168) {
        return true;
      }
      return false;
    }

    if (addr.kind() === 'ipv6') {
      const range = (addr as ipaddr.IPv6).range();
      const blockedRanges = [
        'unspecified',
        'linkLocal',
        'multicast',
        'loopback',
        'uniqueLocal',
        'reserved',
      ];
      if (blockedRanges.includes(range)) {
        return true;
      }

      // Explicit AWS IPv6 metadata check: fd00:ec2::254
      const addrStr = addr.toString().toLowerCase();
      if (addrStr === '::1' || addrStr === '::' || addrStr.startsWith('fe80:') || addrStr.startsWith('fd00:ec2:')) {
        return true;
      }
      return false;
    }

    return true;
  } catch {
    // If it cannot be parsed as a valid IP, block it
    return true;
  }
}

/**
 * Validates a target URL against SSRF criteria:
 * - Scheme must be http: or https:
 * - No user credentials in URL (e.g. user:pass@host)
 * - Host must not resolve to blocked / internal / private / metadata IP addresses
 */
export async function validateUrlForSsrf(urlString: string): Promise<{
  validatedUrl: URL;
  resolvedIps: string[];
}> {
  let parsed: URL;
  try {
    parsed = new URL(urlString);
  } catch (err: any) {
    throw new SsrfValidationError(`Invalid URL format: ${err?.message || 'malformed'}`);
  }

  // 1. Strict protocol validation
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new SsrfValidationError(
      `Unsupported URL scheme "${parsed.protocol}". Only HTTP and HTTPS are permitted.`
    );
  }

  // 2. Reject credentials in URL
  if (parsed.username || parsed.password) {
    throw new SsrfValidationError('URLs containing user credentials are not permitted.');
  }

  const hostname = parsed.hostname.toLowerCase();
  if (!hostname) {
    throw new SsrfValidationError('URL has an empty hostname.');
  }

  // 3. Reject localhost strings directly
  if (
    hostname === 'localhost' ||
    hostname === 'localhost.localdomain' ||
    hostname.endsWith('.localhost') ||
    hostname.endsWith('.internal') ||
    hostname.endsWith('.local')
  ) {
    throw new SsrfValidationError(`Access to internal or local hostname "${hostname}" is blocked.`);
  }

  // 4. If hostname is already an IP address, validate immediately
  if (net.isIP(hostname)) {
    if (isBlockedIp(hostname)) {
      throw new SsrfValidationError(
        `Destination IP "${hostname}" is restricted (private, loopback, or cloud metadata).`
      );
    }
    return { validatedUrl: parsed, resolvedIps: [hostname] };
  }

  // 5. Perform DNS lookup to validate all resolved IP addresses (DNS rebinding / SSRF check)
  let lookupResults: dns.LookupAddress[];
  try {
    lookupResults = await dns.promises.lookup(hostname, { all: true, verbatim: true });
  } catch (dnsErr: any) {
    throw new SsrfValidationError(`DNS resolution failed for host "${hostname}": ${dnsErr.message}`);
  }

  if (!lookupResults || lookupResults.length === 0) {
    throw new SsrfValidationError(`No DNS records found for host "${hostname}".`);
  }

  const resolvedIps = lookupResults.map(r => r.address);
  for (const ip of resolvedIps) {
    if (isBlockedIp(ip)) {
      throw new SsrfValidationError(
        `Host "${hostname}" resolved to restricted IP address "${ip}". Access blocked.`
      );
    }
  }

  return { validatedUrl: parsed, resolvedIps };
}

/**
 * Redacts query parameters and sensitive tokens from URLs for safe logging.
 */
export function redactUrlForLogging(urlString: string): string {
  try {
    const url = new URL(urlString);
    if (url.search) {
      url.search = '?REDACTED';
    }
    url.username = '';
    url.password = '';
    return url.toString();
  } catch {
    return urlString.split('?')[0];
  }
}

