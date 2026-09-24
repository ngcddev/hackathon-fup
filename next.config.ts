import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // El validador de SQL del agente usa el parser de Postgres compilado a WASM: debe cargarse
  // desde node_modules (en Vercel, el rastreo de archivos incluye el .wasm) y no empaquetarse.
  serverExternalPackages: ["@libpg-query/parser"],
};

export default nextConfig;
