import type { MetadataRoute } from "next";

/** private team tool: well-behaved crawlers (search engines, AI scrapers) stay out entirely */
export default function robots(): MetadataRoute.Robots {
  return { rules: { userAgent: "*", disallow: "/" } };
}
