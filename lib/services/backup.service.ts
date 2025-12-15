import type { StreamEvent } from "@/lib/types";

export interface BackupRequest {
  tenantIds: string[];
  toSchema: string;
  password: string;
}

export interface DownloadParams {
  archiveId: string;
  password: string;
  fileName: string;
}

export class BackupService {
  private static readonly BASE_URL = "http://localhost:3000/backup";

  /**
   * Inicia o processo de backup e retorna um stream de eventos
   */
  static async startBackup(
    request: BackupRequest,
    signal?: AbortSignal
  ): Promise<Response> {
    const response = await fetch(this.BASE_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(request),
      signal,
    });

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    return response;
  }

  /**
   * Processa o stream de eventos do backup
   */
  static async *processBackupStream(
    reader: ReadableStreamDefaultReader<Uint8Array>
  ): AsyncGenerator<StreamEvent, void, unknown> {
    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
      const { done, value } = await reader.read();

      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";

      for (const line of lines) {
        if (line.startsWith("event:")) {
          continue;
        }

        if (line.startsWith("data:")) {
          const data = line.slice(5).trim();
          if (data) {
            try {
              const event: StreamEvent = JSON.parse(data);
              yield event;
            } catch (e) {
              console.error("Failed to parse event:", e);
            }
          }
        }
      }
    }
  }

  /**
   * Gera a URL de download do arquivo de backup
   */
  static getDownloadUrl(params: DownloadParams): string {
    return `${this.BASE_URL}/download/${params.archiveId}?password=${encodeURIComponent(
      params.password
    )}`;
  }

  /**
   * Inicia o download do arquivo de backup
   */
  static triggerDownload(params: DownloadParams): void {
    const downloadUrl = this.getDownloadUrl(params);

    // Cria um elemento anchor temporário para iniciar o download
    const a = document.createElement("a");
    a.href = downloadUrl;
    a.download = `${params.fileName}.tar.gz`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  }
}
