export interface WebsiteDetails {
  domain: string;
  hostingIp: string | null;
  hostedBy: string | null;
  registrar: string | null;
  phone: string | null;
  mailingAddress: string | null;
  registrarContactPhone: string | null;
  registrarContactEmail: string | null;
  registeredOn: string | null;
  expiresOn: string | null;
  updatedOn: string | null;
}

interface HostingCheckerLookup {
  address?: string;
  isIPv6?: boolean;
  provider?: {
    organization?: string;
  };
}

interface HostingCheckerResponse {
  web?: {
    lookups?: HostingCheckerLookup[];
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

    const blockedHosts = new Set<string>([
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
      "github.com",
      "gist.github.com",
      "gitlab.com",
      "bitbucket.org",
      "notion.so",
      "docs.google.com",
      "linktr.ee",
      "linktree.com",
      "beacons.ai",
      "taplink.cc",
      "bio.site",
      "carrd.co",
      "bit.ly",
      "tinyurl.com",
      "shorturl.at",
      "play.google.com",
      "apps.apple.com",
      "forms.gle",
    ]);

    if (blockedHosts.has(domain)) {
      return null;
    }

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

function flattenAdrPart(part: unknown): string {
  if (part == null) {
    return "";
  }
  if (Array.isArray(part)) {
    return part
      .map((piece) => (piece == null ? "" : String(piece).trim()))
      .filter(Boolean)
      .join(" ");
  }
  return String(part).trim();
}

function isVoiceTelEntry(entry: unknown[]): boolean {
  const params = entry[1];
  if (!params || typeof params !== "object") {
    return true;
  }
  const type = (params as { type?: string | string[] }).type;
  if (!type) {
    return true;
  }
  if (Array.isArray(type)) {
    return type.includes("voice");
  }
  return type === "voice";
}

function formatTelValue(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const normalized = value.replace(/^tel:/i, "").trim();
  if (!normalized || !/^\+?[\d\s().-]{7,}$/.test(normalized)) {
    return null;
  }
  return normalized;
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
        .map(flattenAdrPart)
        .filter(Boolean);
      return parts.length > 0 ? parts.join(", ") : null;
    }

    if (property === "tel" && typeof value === "string") {
      return formatTelValue(value);
    }

    if (property === "email" && typeof value === "string" && value.trim()) {
      return value.trim();
    }

    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }

  return null;
}

function getVcardVoicePhone(vcardArray: unknown[] | undefined): string | null {
  if (!Array.isArray(vcardArray) || vcardArray[0] !== "vcard" || !Array.isArray(vcardArray[1])) {
    return null;
  }

  for (const entry of vcardArray[1]) {
    if (!Array.isArray(entry) || entry[0] !== "tel" || !isVoiceTelEntry(entry)) {
      continue;
    }
    const phone = formatTelValue(entry[3]);
    if (phone) {
      return phone;
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

/** Nested contact under registrar only (e.g. abuse@registrar). */
function findRegistrarChildByRole(
  registrarEntity: NamerdapEntity | null,
  role: string
): NamerdapEntity | null {
  if (!registrarEntity?.entities) {
    return null;
  }

  for (const entity of registrarEntity.entities) {
    if (entity.roles?.includes(role)) {
      return entity;
    }
  }

  return null;
}

function getRegistrarContactInfo(registrarEntity: NamerdapEntity | null): {
  phone: string | null;
  email: string | null;
} {
  if (!registrarEntity) {
    return { phone: null, email: null };
  }

  const registrarVcard = registrarEntity.vcardArray as unknown[] | undefined;
  let phone = getVcardVoicePhone(registrarVcard);
  let email = getVcardProperty(registrarVcard, "email");

  for (const role of ["abuse", "administrative", "technical"] as const) {
    const child = findRegistrarChildByRole(registrarEntity, role);
    if (!child) {
      continue;
    }
    const childVcard = child.vcardArray as unknown[] | undefined;
    phone ??= getVcardVoicePhone(childVcard);
    email ??= getVcardProperty(childVcard, "email");
  }

  return { phone, email };
}

function parseNamerdapResponse(data: NamerdapResponse): {
  registrar: string | null;
  phone: string | null;
  mailingAddress: string | null;
  registrarContactPhone: string | null;
  registrarContactEmail: string | null;
  registeredOn: string | null;
  expiresOn: string | null;
  updatedOn: string | null;
} {
  const registrarEntity = findEntityByRole(data.entities, "registrar");
  const registrantEntity = findEntityByRole(data.entities, "registrant");

  const registrar =
    getVcardProperty(registrarEntity?.vcardArray as unknown[] | undefined, "fn") ??
    getVcardProperty(registrarEntity?.vcardArray as unknown[] | undefined, "org");

  // Registrant only — do not fall back to registrar (often privacy/redacted).
  const phone = getVcardVoicePhone(registrantEntity?.vcardArray as unknown[] | undefined);
  const mailingAddress = getVcardProperty(
    registrantEntity?.vcardArray as unknown[] | undefined,
    "adr"
  );

  const registrarContact = getRegistrarContactInfo(registrarEntity);
  const registrarContactPhone = registrarContact.phone;
  const registrarContactEmail = registrarContact.email;

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

  return {
    registrar,
    phone,
    mailingAddress,
    registrarContactPhone,
    registrarContactEmail,
    registeredOn,
    expiresOn,
    updatedOn,
  };
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

async function fetchRdapJson(url: string): Promise<NamerdapResponse | null> {
  try {
    const response = await fetch(url, {
      headers: {
        Accept: "application/rdap+json, application/json",
      },
      redirect: "follow",
    });
    if (!response.ok) {
      return null;
    }
    return (await response.json()) as NamerdapResponse;
  } catch {
    return null;
  }
}

function getRdapFallbackUrls(domain: string): string[] {
  const parts = domain.toLowerCase().split(".");
  const tld = parts.length > 1 ? parts[parts.length - 1] : "";
  const encoded = encodeURIComponent(domain);

  const urls: string[] = [];

  if (tld === "fun" || tld === "space") {
    urls.push(`https://rdap.radix.host/rdap/domain/${encoded}?jcard=1`);
    urls.push(`https://rdap.radix.host/rdap/domain/${encoded}`);
  }

  if (tld === "tech") {
    urls.push(`https://rdap.namecheap.com/domain/${encoded}?jcard=1`);
    urls.push(`https://rdap.namecheap.com/domain/${encoded}`);
  }

  if (tld === "one") {
    urls.push(`https://rdap.nic.one/domain/${encoded}?jcard=1`);
    urls.push(`https://rdap.namesilo.com/domain/${encoded}`);
  }

  urls.push(`https://rdap.org/domain/${encoded}`);

  return urls;
}

function parseHostingCheckerWeb(lookups: HostingCheckerLookup[]): {
  hostingIp: string | null;
  hostedBy: string | null;
} {
  const ipv4 = lookups
    .filter((lookup) => lookup.address && !lookup.isIPv6 && !lookup.address.includes(":"))
    .map((lookup) => lookup.address as string);

  const anyIp = lookups.map((lookup) => lookup.address).filter(Boolean) as string[];

  const organizations = lookups
    .map((lookup) => lookup.provider?.organization?.trim())
    .filter((name): name is string => Boolean(name));

  return {
    hostingIp:
      ipv4.length > 0
        ? Array.from(new Set(ipv4)).join(", ")
        : anyIp.length > 0
          ? Array.from(new Set(anyIp)).join(", ")
          : null,
    hostedBy:
      organizations.length > 0 ? Array.from(new Set(organizations)).join(", ") : null,
  };
}

async function fetchHostingInfo(domain: string): Promise<{
  hostingIp: string | null;
  hostedBy: string | null;
}> {
  try {
    const response = await fetch(`https://hosting-checker.net/api/hosting/${encodeURIComponent(domain)}`);
    if (!response.ok) {
      return { hostingIp: null, hostedBy: null };
    }

    const data = (await response.json()) as HostingCheckerResponse;
    return parseHostingCheckerWeb(data.web?.lookups ?? []);
  } catch {
    return { hostingIp: null, hostedBy: null };
  }
}

export async function fetchHostingIp(domain: string): Promise<string | null> {
  const info = await fetchHostingInfo(domain);
  return info.hostingIp;
}

export async function fetchHostedBy(domain: string): Promise<string | null> {
  const info = await fetchHostingInfo(domain);
  return info.hostedBy;
}

/**
 * Fetch registrar, phone, and mailing   address from RDAP
 */
export async function fetchDomainWhois(domain: string): Promise<{
  registrar: string | null;
  phone: string | null;
  mailingAddress: string | null;
  registrarContactPhone: string | null;
  registrarContactEmail: string | null;
  registeredOn: string | null;
  expiresOn: string | null;
  updatedOn: string | null;
}> {
  try {
    const namerdapUrl = `https://namerdap.systems/domain/${encodeURIComponent(domain)}`;
    const response = await fetch(namerdapUrl, {
      headers: namerdapHeaders(),
    });

    if (response.ok) {
      const data = (await response.json()) as NamerdapResponse;
      return parseNamerdapResponse(data);
    }

    for (const url of getRdapFallbackUrls(domain)) {
      const rdapFallback = await fetchRdapJson(url);
      if (rdapFallback) {
        return parseNamerdapResponse(rdapFallback);
      }
    }

    return {
      registrar: null,
      phone: null,
      mailingAddress: null,
      registrarContactPhone: null,
      registrarContactEmail: null,
      registeredOn: null,
      expiresOn: null,
      updatedOn: null,
    };
  } catch {
    return {
      registrar: null,
      phone: null,
      mailingAddress: null,
      registrarContactPhone: null,
      registrarContactEmail: null,
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
  const [hosting, whois] = await Promise.all([
    fetchHostingInfo(domain),
    fetchDomainWhois(domain),
  ]);

  return {
    domain,
    hostingIp: hosting.hostingIp,
    hostedBy: hosting.hostedBy,
    registrar: whois.registrar,
    phone: whois.phone,
    mailingAddress: whois.mailingAddress,
    registrarContactPhone: whois.registrarContactPhone,
    registrarContactEmail: whois.registrarContactEmail,
    registeredOn: whois.registeredOn,
    expiresOn: whois.expiresOn,
    updatedOn: whois.updatedOn,
  };
}
