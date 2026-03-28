/**
 * Provider Index
 * 
 * Re-exports all providers and ensures they're registered.
 */

// Export types
export * from "./base";

// Import providers to trigger registration
import "./vercel";
import "./render";
import "./githubPages";

// Re-export provider classes for direct use
export { VercelDeploymentProvider } from "./vercel";
export { RenderDeploymentProvider } from "./render";
export { GitHubPagesDeploymentProvider } from "./githubPages";
