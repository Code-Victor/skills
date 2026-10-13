import path from "node:path";
import { Config } from "@remotion/cli/config";
import { enableTailwind } from "@remotion/tailwind-v4";

Config.setRspack(true);
// PNG frames: JPEG smears thin UI lines and text before the encoder even starts.
Config.setVideoImageFormat("png");
Config.setOverwriteOutput(true);
// The bundler doesn't read tsconfig `paths`; mirror "@/*" -> src/* for the
// remocn components.
Config.overrideBundlerConfig((config) => {
  const withTailwind = enableTailwind(config);
  return {
    ...withTailwind,
    resolve: {
      ...withTailwind.resolve,
      alias: { ...(withTailwind.resolve?.alias ?? {}), "@": path.join(process.cwd(), "src") },
    },
  };
});
