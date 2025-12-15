import type {
  StreamEvent,
  LogEvent,
  ProgressEvent,
  CompleteEvent,
  ErrorEvent,
} from "@/lib/types";

export interface FailedDownload {
  fileId: string;
  path: string;
  timestamp: string;
}

export class EventParserService {
  /**
   * Extrai o Archive ID de um evento de log
   */
  static extractArchiveId(event: StreamEvent): string | null | undefined {
    if (event.type === "log" && event.message.includes("Archive ID:")) {
      const match = event.message.match(/Archive ID: ([\w-]+)/);
      return match ? match[1] : null;
    }

    if (event.type === "complete" && (event as CompleteEvent).summary.archiveId) {
      return (event as CompleteEvent).summary.archiveId;
    }

    return null;
  }

  /**
   * Extrai informações de um download falhado
   */
  static extractFailedDownload(event: StreamEvent): FailedDownload | null {
    if (
      event.type === "log" &&
      (event as LogEvent).level === "error" &&
      event.message.includes("Failed to download file")
    ) {
      const logEvent = event as LogEvent;
      const match = logEvent.message.match(
        /Failed to download file ([\w-]+) \$\$(.*?)\$\$/
      );
      
      if (match) {
        return {
          fileId: match[1],
          path: match[2],
          timestamp: logEvent.timestamp,
        };
      }
    }

    return null;
  }

  /**
   * Obtém a mensagem de status atual baseada no evento
   */
  static getStatusMessage(event: StreamEvent): string | null {
    switch (event.type) {
      case "progress": {
        const progressEvent = event as ProgressEvent;
        return `${progressEvent.step.toUpperCase()}: ${progressEvent.message}`;
      }
      case "log": {
        const logEvent = event as LogEvent;
        if (logEvent.level === "info") {
          return logEvent.message;
        }
        return null;
      }
      case "complete":
        return "Backup concluído com sucesso";
      case "error":
        return `Erro: ${event.message}`;
      default:
        return null;
    }
  }

  /**
   * Obtém o evento de progresso mais recente
   */
  static getProgressEvent(event: StreamEvent): ProgressEvent | null {
    return event.type === "progress" ? (event as ProgressEvent) : null;
  }

  /**
   * Calcula a porcentagem de progresso
   */
  static calculateProgressPercentage(progress: ProgressEvent): number {
    return progress.total > 0 ? (progress.current / progress.total) * 100 : 0;
  }

  /**
   * Formata o timestamp para exibição
   */
  static formatTimestamp(timestamp: string): string {
    return new Date(timestamp).toLocaleTimeString();
  }

  /**
   * Verifica se o evento é um evento de conclusão
   */
  static isCompleteEvent(event: StreamEvent): boolean {
    return event.type === "complete";
  }

  /**
   * Verifica se o evento é um evento de erro
   */
  static isErrorEvent(event: StreamEvent): boolean {
    return event.type === "error";
  }
}
