"use client";

import { useState, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Loader2,
  Download,
  CheckCircle2,
  XCircle,
  Info,
  AlertTriangle,
} from "lucide-react";
import type {
  StreamEvent,
  LogEvent,
  ProgressEvent,
  CompleteEvent,
  ErrorEvent,
} from "@/lib/types";
import { BackupService } from "@/lib/services/backup.service";
import {
  EventParserService,
  type FailedDownload,
} from "@/lib/services/event-parser.service";

export function BackupManager() {
  const [tenantIds, setTenantIds] = useState("tenant1");
  const [toSchema, setToSchema] = useState("my_backup");
  const [password, setPassword] = useState("xxx");
  const [isStreaming, setIsStreaming] = useState(false);
  const [events, setEvents] = useState<StreamEvent[]>([]);
  const [archiveId, setArchiveId] = useState<string | null>(null);
  const [downloadTriggered, setDownloadTriggered] = useState(false);
  const [isDownloading, setIsDownloading] = useState(false);
  const [currentStatus, setCurrentStatus] = useState<string>("");
  const [latestProgress, setLatestProgress] = useState<ProgressEvent | null>(
    null
  );
  const [failedDownloads, setFailedDownloads] = useState<FailedDownload[]>([]);
  const abortControllerRef = useRef<AbortController | null>(null);

  const downloadArchive = (archiveIdToDownload: string) => {
    setIsDownloading(true);
    try {
      BackupService.triggerDownload({
        archiveId: archiveIdToDownload,
        password,
        fileName: toSchema,
      });

      setCurrentStatus("Download iniciado com sucesso");
    } catch (error) {
      console.error("Download failed:", error);
      setCurrentStatus(
        `Falha no download: ${
          error instanceof Error ? error.message : "Erro desconhecido"
        }`
      );
    } finally {
      setIsDownloading(false);
    }
  };

  const triggerDownload = (archiveIdToDownload: string) => {
    if (downloadTriggered) return; // Prevent duplicate downloads

    setDownloadTriggered(true);
    setCurrentStatus("Iniciando download...");
    downloadArchive(archiveIdToDownload);
  };

  const startBackup = async () => {
    setIsStreaming(true);
    setEvents([]);
    setArchiveId(null);
    setDownloadTriggered(false);
    setCurrentStatus("Conectando...");
    setLatestProgress(null);
    setFailedDownloads([]);

    abortControllerRef.current = new AbortController();

    const tenantIdArray = tenantIds
      .split(",")
      .map((id) => id.trim())
      .filter(Boolean);

    try {
      const response = await BackupService.startBackup(
        {
          tenantIds: tenantIdArray,
          toSchema,
          password,
        },
        abortControllerRef.current.signal
      );

      setCurrentStatus("Conectado - Backup em progresso");

      const reader = response.body?.getReader();

      if (!reader) {
        throw new Error("No reader available");
      }

      for await (const event of BackupService.processBackupStream(reader)) {
        setEvents((prev) => [...prev, event]);

        // Atualiza o progresso
        const progressEvent = EventParserService.getProgressEvent(event);
        if (progressEvent) {
          setLatestProgress(progressEvent);
        }

        // Atualiza o status
        const statusMessage = EventParserService.getStatusMessage(event);
        if (statusMessage) {
          setCurrentStatus(statusMessage);
        }

        // Detecta download falhado
        const failedDownload = EventParserService.extractFailedDownload(event);
        if (failedDownload) {
          setFailedDownloads((prev) => [...prev, failedDownload]);
        }

        // Extrai Archive ID e inicia download
        const extractedArchiveId = EventParserService.extractArchiveId(event);
        if (extractedArchiveId) {
          setArchiveId(extractedArchiveId);
          if (!downloadTriggered) {
            triggerDownload(extractedArchiveId);
          }
        }
      }
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        setCurrentStatus("Backup cancelado pelo usuário");
        setEvents((prev) => [
          ...prev,
          {
            type: "error",
            message: "Processo de backup cancelado",
            timestamp: new Date().toISOString(),
          },
        ]);
      } else {
        console.error("Backup failed:", error);
        setCurrentStatus(
          `Falha na conexão: ${
            error instanceof Error ? error.message : "Erro desconhecido"
          }`
        );
        setEvents((prev) => [
          ...prev,
          {
            type: "error",
            message:
              error instanceof Error ? error.message : "Unknown error occurred",
            timestamp: new Date().toISOString(),
          },
        ]);
      }
    } finally {
      setIsStreaming(false);
      abortControllerRef.current = null;
    }
  };

  const abortBackup = () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
  };

  const downloadBackup = () => {
    if (!archiveId) return;
    downloadArchive(archiveId);
  };

  const formatTimestamp = EventParserService.formatTimestamp;

  const getProgressPercentage = EventParserService.calculateProgressPercentage;

  return (
    <div className="min-h-screen bg-zinc-950">
      <div className="container mx-auto py-8 px-4 max-w-5xl">
        <div className="space-y-6">
          <div>
            <h1 className="text-4xl font-bold tracking-tight text-white">
              Gerenciador de Backup de Banco de Dados
            </h1>
            <p className="text-zinc-400 mt-2">
              Configure e monitore seu processo de backup de banco de dados em
              tempo real
            </p>
          </div>

          <Card className="bg-zinc-900 border-zinc-800">
            <CardContent className="space-y-4">
              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="tenantIds" className="text-zinc-200">
                    IDs dos Tenants (separados por vírgula)
                  </Label>
                  <Input
                    id="tenantIds"
                    placeholder="tenant1, tenant2, tenant3"
                    value={tenantIds}
                    onChange={(e) => setTenantIds(e.target.value)}
                    disabled={isStreaming}
                    className="bg-zinc-800 border-zinc-700 text-white placeholder:text-zinc-500"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="toSchema" className="text-zinc-200">
                    Nome do Schema
                  </Label>
                  <Input
                    id="toSchema"
                    placeholder="my_backup"
                    value={toSchema}
                    onChange={(e) => setToSchema(e.target.value)}
                    disabled={isStreaming}
                    className="bg-zinc-800 border-zinc-700 text-white placeholder:text-zinc-500"
                  />
                </div>
              </div>
              <div className="space-y-2">
                <Label htmlFor="password" className="text-zinc-200">
                  Senha
                </Label>
                <Input
                  id="password"
                  type="password"
                  placeholder="Digite a senha do backup"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  disabled={isStreaming}
                  className="bg-zinc-800 border-zinc-700 text-white placeholder:text-zinc-500"
                />
              </div>
              <div className="flex gap-3">
                {!isStreaming ? (
                  <Button
                    onClick={startBackup}
                    disabled={!tenantIds || !toSchema || !password}
                    className="flex-1 bg-blue-600 hover:bg-blue-700 text-white"
                  >
                    Iniciar Backup
                  </Button>
                ) : (
                  <Button
                    onClick={abortBackup}
                    variant="destructive"
                    className="flex-1 bg-red-600 hover:bg-red-700 text-white"
                  >
                    <XCircle className="mr-2 h-4 w-4" />
                    Cancelar Backup
                  </Button>
                )}
              </div>
            </CardContent>
          </Card>

          {currentStatus && (
            <Card className="bg-zinc-900 border-zinc-800">
              <CardHeader>
                <div className="flex items-center justify-between">
                  <CardTitle className="flex items-center gap-2 text-white">
                    {isStreaming && (
                      <Loader2 className="h-5 w-5 animate-spin text-blue-500" />
                    )}
                    {!isStreaming && archiveId && (
                      <CheckCircle2 className="h-5 w-5 text-green-500" />
                    )}
                    Status Atual
                  </CardTitle>
                  {archiveId && (
                    <Button
                      onClick={downloadBackup}
                      disabled={isDownloading}
                      variant="secondary"
                      className="bg-zinc-800 hover:bg-zinc-700 text-white border-zinc-700"
                    >
                      {isDownloading ? (
                        <>
                          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                          Baixando...
                        </>
                      ) : (
                        <>
                          <Download className="mr-2 h-4 w-4" />
                          Baixar Backup
                        </>
                      )}
                    </Button>
                  )}
                </div>
                <CardDescription className="text-zinc-400">
                  {currentStatus}
                </CardDescription>
              </CardHeader>
              {latestProgress && (
                <CardContent>
                  <div className="space-y-3">
                    <div className="flex items-center justify-between text-sm">
                      <span className="font-medium text-zinc-200">
                        Progresso: {latestProgress.current} /{" "}
                        {latestProgress.total}
                      </span>
                      <span className="text-zinc-400">
                        {Math.round(getProgressPercentage(latestProgress))}%
                      </span>
                    </div>
                    <Progress
                      value={getProgressPercentage(latestProgress)}
                      className="h-3"
                    />
                  </div>
                </CardContent>
              )}
            </Card>
          )}

          {events.length > 0 && (
            <Card className="bg-zinc-900 border-zinc-800">
              <CardHeader>
                <CardTitle className="text-white">Logs de Atividade</CardTitle>
                <CardDescription className="text-zinc-400">
                  Logs detalhados do processo de backup
                </CardDescription>
              </CardHeader>
              <CardContent>
                <ScrollArea className="h-[400px] pr-4">
                  <div className="space-y-2 font-mono text-xs">
                    {events.map((event, index) => (
                      <div
                        key={index}
                        className="border-l-2 border-zinc-700 pl-3 py-1 hover:border-blue-500 transition-colors"
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="flex-1 break-all">
                            {event.type === "log" && (
                              <span
                                className={
                                  (event as LogEvent).level === "error"
                                    ? "text-red-400"
                                    : (event as LogEvent).level === "success"
                                    ? "text-green-400"
                                    : (event as LogEvent).level === "warning"
                                    ? "text-yellow-400"
                                    : "text-zinc-300"
                                }
                              >
                                [{(event as LogEvent).level.toUpperCase()}]{" "}
                                {(event as LogEvent).message}
                              </span>
                            )}
                            {event.type === "progress" && (
                              <span className="text-blue-400">
                                [PROGRESS]{" "}
                                {(event as ProgressEvent).step.toUpperCase()}:{" "}
                                {(event as ProgressEvent).message} (
                                {(event as ProgressEvent).current}/
                                {(event as ProgressEvent).total})
                              </span>
                            )}
                            {event.type === "complete" && (
                              <span className="text-green-400 font-semibold">
                                [COMPLETE] Backup finished -{" "}
                                {(event as CompleteEvent).summary.totalFiles}{" "}
                                files,{" "}
                                {(event as CompleteEvent).summary.duration}s
                              </span>
                            )}
                            {event.type === "error" && (
                              <span className="text-red-400 font-semibold">
                                [ERROR] {(event as ErrorEvent).message}
                              </span>
                            )}
                          </div>
                          <span className="text-zinc-500 shrink-0 text-[10px]">
                            {formatTimestamp(event.timestamp)}
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                </ScrollArea>
              </CardContent>
            </Card>
          )}

          {failedDownloads.length > 0 && (
            <Card className="border-red-900 bg-zinc-900">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-red-400">
                  <XCircle className="h-5 w-5" />
                  Resumo de Downloads com Falha
                </CardTitle>
                <CardDescription className="text-zinc-400">
                  {failedDownloads.length} arquivo
                  {failedDownloads.length !== 1 ? "s" : ""} falharam ao baixar
                  durante o processo de backup
                </CardDescription>
              </CardHeader>
              <CardContent>
                <ScrollArea className="max-h-[300px]">
                  <div className="space-y-3">
                    {failedDownloads.map((failed, index) => (
                      <div
                        key={index}
                        className="border border-zinc-800 rounded-lg p-3 bg-zinc-800/50 space-y-1"
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="space-y-1 flex-1">
                            <div className="font-mono text-sm font-medium text-red-400 break-all">
                              {failed.fileId}
                            </div>
                            <div className="text-xs text-zinc-500 break-all">
                              {failed.path}
                            </div>
                          </div>
                          <span className="text-xs text-zinc-500 shrink-0">
                            {formatTimestamp(failed.timestamp)}
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                </ScrollArea>
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
