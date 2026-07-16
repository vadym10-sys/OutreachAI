import type { MetadataRoute } from "next";
import { appUrl } from "@/lib/env";

export default function sitemap(): MetadataRoute.Sitemap {
  return ["", "/pricing", "/security", "/privacy", "/terms", "/sign-in", "/sign-up", "/forgot-password"].map((path) => ({
    url: `${appUrl}${path}`,
    lastModified: new Date(),
    changeFrequency: "weekly",
    priority: path === "" ? 1 : path === "/pricing" ? 0.8 : 0.6
  }));
}
