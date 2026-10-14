export const TRAY_GUID = "a4c3d378-2d49-4f7d-bda8-3c44df276b96";

export function trayGuidForPlatform(platform: NodeJS.Platform): string | null {
  return platform === "linux" ? null : TRAY_GUID;
}
