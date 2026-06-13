/**
 * Vercel serverless function entry point.
 * Wraps the React Router SSR server so Vercel routes all non-static
 * requests through the app instead of returning 404.
 */
import pkg from "@react-router/node";

export default pkg.createRequestListener({
  build: () => import("../build/server/index.js"),
  mode: process.env.NODE_ENV,
});
