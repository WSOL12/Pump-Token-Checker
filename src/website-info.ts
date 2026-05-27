export interface WebsiteDetails {
  domain: string;
  hostingIp: string | null;
  registrar: string | null;
  phone: string | null;
  mailingAddress: string | null;
  registeredOn: string | null;
  expiresOn: string | null;
  updatedOn: string | null;
}

interface HostingCheckerResponse {
  web?: {
    lookups?: Array<{ address?: string; isIPv6?: boolean }>;
  };
}

interface NamerdapEntity {
  roles?: string[];
  vcardArray?: unknown[];
  entities?: NamerdapEntity[];
}

interface NamerdapResponse {
  entities?: NamerdapEntity[];
  events?: Array<{
    eventAction?: string;
    eventDate?: string;
  }>;
}

/**
 * Extract registrable domain from a website URL.
 */
export function extractDomainFromWebsite(website: string | null | undefined): string | null {
  if (!website || !website.trim()) {
    return null;
  }

  try {
    const url = website.trim().startsWith("http") ? website.trim() : `https://${website.trim()}`;
    const hostname = new URL(url).hostname.toLowerCase();
    if (!hostname || hostname === "localhost") {
      return null;
    }
    const domain = hostname.replace(/^www\./, "");

    // Many tokens put social links in the "website" field. We explicitly skip those hosts
    // to avoid meaningless WHOIS/hosting lookups and wasted API requests.
    const blockedHosts = new Set<string>([
      // Social / chat
      "x.com",
      "twitter.com",
      "t.co",
      "telegram.me",
      "t.me",
      "discord.com",
      "discord.gg",
      "instagram.com",
      "facebook.com",
      "fb.com",
      "reddit.com",
      "medium.com",
      "tiktok.com",
      "youtube.com",
      "youtu.be",
      // Code / docs
      "github.com",
      "gist.github.com",
      "gitlab.com",
      "bitbucket.org",
      "notion.so",
      "docs.google.com",
      // Link aggregators / shorteners
      "linktr.ee",
      "linktree.com",
      "beacons.ai",
      "taplink.cc",
      "bio.site",
      "carrd.co",
      "bit.ly",
      "tinyurl.com",
      "shorturl.at",
      // App stores / forms
      "play.google.com",
      "apps.apple.com",
      "forms.gle",
    ]);

    if (blockedHosts.has(domain)) {
      return null;
    }

    // Block any subdomain of a blocked host (e.g. mobile.twitter.com)
    for (const blocked of blockedHosts) {
      if (domain.endsWith(`.${blocked}`)) {
        return null;
      }
    }

    return domain;
  } catch {
    return null;
  }
}

function getVcardProperty(vcardArray: unknown[] | undefined, property: string): string | null {
  if (!Array.isArray(vcardArray) || vcardArray[0] !== "vcard" || !Array.isArray(vcardArray[1])) {
    return null;
  }

  for (const entry of vcardArray[1]) {
    if (!Array.isArray(entry) || entry[0] !== property) {
      continue;
    }

    const value = entry[3];
    if (property === "adr" && Array.isArray(value)) {
      const parts = [value[2], value[3], value[4], value[5], value[6]]
        .map((part) => (part == null ? "" : String(part).trim()))
        .filter(Boolean);
      return parts.length > 0 ? parts.join(", ") : null;
    }

    if (property === "tel" && typeof value === "string") {
      return value.replace(/^tel:/i, "").trim() || null;
    }

    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }

  return null;
}

function findEntityByRole(entities: NamerdapEntity[] | undefined, role: string): NamerdapEntity | null {
  if (!entities) {
    return null;
  }

  for (const entity of entities) {
    if (entity.roles?.includes(role)) {
      return entity;
    }
    const nested = findEntityByRole(entity.entities, role);
    if (nested) {
      return nested;
    }
  }

  return null;
}

function parseNamerdapResponse(data: NamerdapResponse): {
  registrar: string | null;
  phone: string | null;
  mailingAddress: string | null;
  registeredOn: string | null;
  expiresOn: string | null;
  updatedOn: string | null;
} {
  const registrarEntity = findEntityByRole(data.entities, "registrar");
  const registrantEntity = findEntityByRole(data.entities, "registrant");

  const registrar =
    getVcardProperty(registrarEntity?.vcardArray as unknown[] | undefined, "fn") ??
    getVcardProperty(registrarEntity?.vcardArray as unknown[] | undefined, "org");

  const phone =
    getVcardProperty(registrantEntity?.vcardArray as unknown[] | undefined, "tel") ??
    getVcardProperty(registrarEntity?.vcardArray as unknown[] | undefined, "tel");

  const mailingAddress =
    getVcardProperty(registrantEntity?.vcardArray as unknown[] | undefined, "adr") ??
    getVcardProperty(registrarEntity?.vcardArray as unknown[] | undefined, "adr");

  const getEventDate = (actions: string[]): string | null => {
    for (const event of data.events ?? []) {
      const action = event.eventAction?.toLowerCase();
      if (action && actions.includes(action) && event.eventDate) {
        return event.eventDate;
      }
    }
    return null;
  };

  const registeredOn = getEventDate(["registration"]);
  const expiresOn = getEventDate(["expiration", "registrar expiration"]);
  const updatedOn = getEventDate(["last changed", "last update of rdap database"]);

  return { registrar, phone, mailingAddress, registeredOn, expiresOn, updatedOn };
}

function namerdapHeaders(): Record<string, string> {
  const headers: Record<string, string> = {
    Accept: "application/json",
  };

  const apiKey = process.env.NAMERDAP_API_KEY?.trim();
  if (apiKey) {
    headers.Authorization = `Bearer ${apiKey}`;
    headers["X-API-Key"] = apiKey;
  }

  return headers;
}

/**
 * Fetch web hosting IP from hosting-checker.net
 */
export async function fetchHostingIp(domain: string): Promise<string | null> {
  try {
    const response = await fetch(`https://hosting-checker.net/api/hosting/${encodeURIComponent(domain)}`);
    if (!response.ok) {
      return null;
    }

    const data = (await response.json()) as HostingCheckerResponse;
    const lookups = data.web?.lookups ?? [];
    const ipv4 = lookups
      .filter((lookup) => lookup.address && !lookup.isIPv6 && !lookup.address.includes(":"))
      .map((lookup) => lookup.address as string);
    if (ipv4.length > 0) {
      return ipv4.join(", ");
    }

    const anyIp = lookups.map((lookup) => lookup.address).filter(Boolean) as string[];
    return anyIp.length > 0 ? anyIp.join(", ") : null;
  } catch {
    return null;
  }
}

/**
 * Fetch registrar, phone, and mailing address from namerdap.systems (RDAP)
 */
export async function fetchDomainWhois(domain: string): Promise<{
  registrar: string | null;
  phone: string | null;
  mailingAddress: string | null;
  registeredOn: string | null;
  expiresOn: string | null;
  updatedOn: string | null;
}> {
  try {
    const response = await fetch(`https://namerdap.systems/domain/${encodeURIComponent(domain)}`, {
      headers: namerdapHeaders(),
    });

    if (!response.ok) {
      return {
        registrar: null,
        phone: null,
        mailingAddress: null,
        registeredOn: null,
        expiresOn: null,
        updatedOn: null,
      };
    }

    const data = (await response.json()) as NamerdapResponse;
    return parseNamerdapResponse(data);
  } catch {
    return {
      registrar: null,
      phone: null,
      mailingAddress: null,
      registeredOn: null,
      expiresOn: null,
      updatedOn: null,
    };
  }
}

/**
 * Fetch hosting IP and WHOIS details for a domain.
 */
export async function fetchWebsiteDetails(domain: string): Promise<WebsiteDetails> {
  const [hostingIp, whois] = await Promise.all([
    fetchHostingIp(domain),
    fetchDomainWhois(domain),
  ]);

  return {
    domain,
    hostingIp,
    registrar: whois.registrar,
    phone: whois.phone,
    mailingAddress: whois.mailingAddress,
    registeredOn: whois.registeredOn,
    expiresOn: whois.expiresOn,
    updatedOn: whois.updatedOn,
  };
}
