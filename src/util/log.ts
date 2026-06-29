import { getSettings } from "./config.ts";

type Level = "DEBUG" | "INFO" | "WARN" | "ERROR";
const ORDER: Record<Level, number> = { DEBUG: 10, INFO: 20, WARN: 30, ERROR: 40 };

function active(level: Level): boolean {
  return ORDER[level] >= ORDER[getSettings().LOG_LEVEL];
}

function emit(level: Level, name: string, msg: string, fields?: Record<string, unknown>): void {
  if (!active(level)) return;
  const line = {
    ts: new Date().toISOString(),
    level,
    logger: name,
    msg,
    ...(fields ?? {}),
  };
  const stream = level === "ERROR" || level === "WARN" ? console.error : console.log;
  stream(JSON.stringify(line));
}

export interface Logger {
  debug: (msg: string, fields?: Record<string, unknown>) => void;
  info: (msg: string, fields?: Record<string, unknown>) => void;
  warn: (msg: string, fields?: Record<string, unknown>) => void;
  error: (msg: string, fields?: Record<string, unknown>) => void;
}

export function getLogger(name = "app"): Logger {
  return {
    debug: (m, f) => emit("DEBUG", name, m, f),
    info: (m, f) => emit("INFO", name, m, f),
    warn: (m, f) => emit("WARN", name, m, f),
    error: (m, f) => emit("ERROR", name, m, f),
  };
}
