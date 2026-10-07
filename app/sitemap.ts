import type { MetadataRoute } from "next";

export default function sitemap(): MetadataRoute.Sitemap {
  return [
    {
      url: "https://mockagent.online/",
      changeFrequency: "weekly",
      priority: 1,
    },
  ];
}
