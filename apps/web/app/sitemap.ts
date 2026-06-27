import type { MetadataRoute } from "next";
import { appUrl } from "@/lib/env";

export default function sitemap(): MetadataRoute.Sitemap {
  return ["", "/sign-in", "/sign-up", "/forgot-password"].map((path) => ({
    url: `${appUrl}${path}`,
    lastModified: new Date(),
    changeFrequency: "weekly",
    priority: path === "" ? 1 : 0.6
  }));
}
