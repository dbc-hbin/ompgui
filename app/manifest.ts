import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "ompgui",
    short_name: "ompgui",
    description: "Web UI for the oh-my-pi (omp) coding agent",
    start_url: "/",
    display: "standalone",
    background_color: "#0f0a14",
    theme_color: "#0f0a14",
    icons: [
      {
        src: "/icon.svg",
        sizes: "any",
        type: "image/svg+xml",
        purpose: "any",
      },
      {
        src: "/apple-icon.png",
        sizes: "180x180",
        type: "image/png",
      },
    ],
  };
}
