import electronLog from "electron-log";

// This distribution must never install upstream SoulFireClient releases.
export function startUpdater(): void {
  electronLog.info("Dev+ Control: automatic updates disabled");
}
