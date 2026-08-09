export type BuildEnvironment = "development-preview" | "production" | "test";

export interface BuildInfo {
  environment: BuildEnvironment;
  target: string;
  sha: string;
  builtAt: string;
}

export interface BuildEnvironmentValues {
  MODE?: string;
  VITE_BUILD_ENV?: string;
  VITE_BUILD_TARGET?: string;
  VITE_COMMIT_SHA?: string;
  VITE_BUILD_AT?: string;
}

const DEFAULT_ENVIRONMENT: BuildEnvironment = "development-preview";

function asEnvironment(value: string | undefined): BuildEnvironment {
  if (value === "production" || value === "test" || value === "development-preview") {
    return value;
  }
  return DEFAULT_ENVIRONMENT;
}

function present(value: string | undefined, fallback: string): string {
  const trimmed = value?.trim();
  return trimmed ? trimmed : fallback;
}

/**
 * Reads build metadata from Vite's injected environment values.
 * The fallback values keep the boot screen useful during `vite dev` and tests.
 */
export function getBuildInfo(values: BuildEnvironmentValues = import.meta.env): BuildInfo {
  const environment = asEnvironment(values.VITE_BUILD_ENV ?? values.MODE);
  const defaultTarget =
    environment === "development-preview"
      ? "GitHub Pages / development-preview"
      : environment === "test"
        ? "Vitest"
        : "GitHub Pages / production";

  return {
    environment,
    target: present(values.VITE_BUILD_TARGET, defaultTarget),
    sha: present(values.VITE_COMMIT_SHA, "unknown"),
    builtAt: present(values.VITE_BUILD_AT, "not available"),
  };
}

export const BUILD_INFO = getBuildInfo();

export function formatBuildInfoValue(value: string): string {
  return value === "unknown" || value === "not available" ? value : value;
}
