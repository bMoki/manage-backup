export type LogLevel = "info" | "error" | "success" | "progress" | "warning"

export interface LogEvent {
  type: "log"
  level: LogLevel
  message: string
  timestamp: string
  data?: Record<string, unknown>
}

export interface ProgressEvent {
  type: "progress"
  step: "init" | "sql" | "query" | "download" | "dump" | "archive"
  current: number
  total: number
  message: string
  timestamp: string
}

export interface CompleteEvent {
  type: "complete"
  success: boolean
  summary: {
    schema: string
    totalFiles: number
    successfulDownloads: number
    failedDownloads: number
    duration: number
    archiveSize?: number
    archiveId?: string
  }
  timestamp: string
}

export interface ErrorEvent {
  type: "error"
  message: string
  timestamp: string
}

export type StreamEvent = LogEvent | ProgressEvent | CompleteEvent | ErrorEvent
