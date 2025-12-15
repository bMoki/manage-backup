"use client";

import { useState, useRef, useEffect } from "react";
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
  const [dbHost, setDbHost] = useState("172.23.224.1");
  const [dbPort, setDbPort] = useState("5433");
  const [dbName, setDbName] = useState("teste_postgres");
  const [dbUser, setDbUser] = useState("postgres");
  const [dbPassword, setDbPassword] = useState("postgres");
  const [isTestingConnection, setIsTestingConnection] = useState(false);
  const [connectionTestResult, setConnectionTestResult] = useState<{
    status: "success" | "error";
    message: string;
    error?: string;
  } | null>(null);
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
  const scrollAreaRef = useRef<HTMLDivElement>(null);
  const isAtBottomRef = useRef(true);

  useEffect(() => {
    // Wait for ScrollArea to be mounted
    const timer = setTimeout(() => {
      const scrollViewport = scrollAreaRef.current?.querySelector(
        '[data-slot="scroll-area-viewport"]'
      );

      if (!scrollViewport) return;

      const handleScroll = () => {
        const { scrollTop, scrollHeight, clientHeight } = scrollViewport;
        const threshold = 10;
        const isAtBottom = scrollHeight - scrollTop - clientHeight < threshold;
        isAtBottomRef.current = isAtBottom;
        console.log("Scroll position:", {
          scrollTop,
          scrollHeight,
          clientHeight,
          isAtBottom,
        });
      };

      // Set initial state
      handleScroll();

      scrollViewport.addEventListener("scroll", handleScroll);
      return () => scrollViewport.removeEventListener("scroll", handleScroll);
    }, 100);

    return () => clearTimeout(timer);
  }, [events.length > 0]);

  useEffect(() => {
    if (events.length > 0 && isAtBottomRef.current) {
      const scrollViewport = scrollAreaRef.current?.querySelector(
        '[data-slot="scroll-area-viewport"]'
      );
      if (scrollViewport) {
        scrollViewport.scrollTop = scrollViewport.scrollHeight;
      }
    }
  }, [events]);

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

  const testConnection = async () => {
    setIsTestingConnection(true);
    setConnectionTestResult(null);

    try {
      const result = await BackupService.testDbConnection({
        dbHost,
        dbPort: parseInt(dbPort),
        dbName,
        dbUser,
        dbPassword,
      });

      setConnectionTestResult({
        status: result.status,
        message: result.message,
        error: result.error,
      });
    } catch (error) {
      setConnectionTestResult({
        status: "error",
        message: "Erro ao testar conexão",
        error: error instanceof Error ? error.message : "Erro desconhecido",
      });
    } finally {
      setIsTestingConnection(false);
    }
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
          dbHost,
          dbPort: parseInt(dbPort),
          dbName,
          dbUser,
          dbPassword,
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

              <div className="border-t border-zinc-700 pt-4 mt-4">
                <h3 className="text-lg font-semibold text-zinc-200 mb-3">
                  Configuração do Banco de Dados
                </h3>
                <div className="grid gap-4 md:grid-cols-2">
                  <div className="space-y-2">
                    <Label htmlFor="dbHost" className="text-zinc-200">
                      Host do Banco
                    </Label>
                    <Input
                      id="dbHost"
                      placeholder="172.23.224.1"
                      value={dbHost}
                      onChange={(e) => setDbHost(e.target.value)}
                      disabled={isStreaming}
                      className="bg-zinc-800 border-zinc-700 text-white placeholder:text-zinc-500"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="dbPort" className="text-zinc-200">
                      Porta
                    </Label>
                    <Input
                      id="dbPort"
                      type="number"
                      placeholder="5433"
                      value={dbPort}
                      onChange={(e) => setDbPort(e.target.value)}
                      disabled={isStreaming}
                      className="bg-zinc-800 border-zinc-700 text-white placeholder:text-zinc-500"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="dbName" className="text-zinc-200">
                      Nome do Banco
                    </Label>
                    <Input
                      id="dbName"
                      placeholder="teste_postgres"
                      value={dbName}
                      onChange={(e) => setDbName(e.target.value)}
                      disabled={isStreaming}
                      className="bg-zinc-800 border-zinc-700 text-white placeholder:text-zinc-500"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="dbUser" className="text-zinc-200">
                      Usuário
                    </Label>
                    <Input
                      id="dbUser"
                      placeholder="postgres"
                      value={dbUser}
                      onChange={(e) => setDbUser(e.target.value)}
                      disabled={isStreaming}
                      className="bg-zinc-800 border-zinc-700 text-white placeholder:text-zinc-500"
                    />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="dbPassword" className="text-zinc-200">
                      Senha do Banco
                    </Label>
                    <Input
                      id="dbPassword"
                      type="password"
                      placeholder="Digite a senha do banco de dados"
                      value={dbPassword}
                      onChange={(e) => setDbPassword(e.target.value)}
                      disabled={isStreaming}
                      className="bg-zinc-800 border-zinc-700 text-white placeholder:text-zinc-500"
                    />
                  </div>
                  <div className="space-y-2 items-end w-full flex">
                    <Button
                      onClick={testConnection}
                      disabled={
                        isTestingConnection ||
                        isStreaming ||
                        !dbHost ||
                        !dbPort ||
                        !dbName ||
                        !dbUser ||
                        !dbPassword
                      }
                      className="w-full bg-zinc-800 hover:bg-zinc-700 text-white border-zinc-700"
                    >
                      {isTestingConnection ? (
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      ) : (
                        <CheckCircle2 className="mr-2 h-4 w-4" />
                      )}
                      Testar Conexão
                    </Button>
                  </div>
                </div>
                <div className="mt-4 flex flex-col gap-3">
                  {connectionTestResult && (
                    <div
                      className={`p-3 rounded-lg border ${
                        connectionTestResult.status === "success"
                          ? "bg-green-950/50 border-green-800 text-green-400"
                          : "bg-red-950/50 border-red-800 text-red-400"
                      }`}
                    >
                      <div className="flex items-start gap-2">
                        {connectionTestResult.status === "success" ? (
                          <CheckCircle2 className="h-5 w-5 shrink-0 mt-0.5" />
                        ) : (
                          <XCircle className="h-5 w-5 shrink-0 mt-0.5" />
                        )}
                        <div className="flex-1">
                          <p className="text-sm font-medium">
                            {connectionTestResult.message}
                          </p>
                          {connectionTestResult.error && (
                            <p className="text-xs mt-1 opacity-90">
                              {connectionTestResult.error}
                            </p>
                          )}
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              </div>

              <div className="flex gap-3">
                {!isStreaming ? (
                  <Button
                    onClick={startBackup}
                    disabled={
                      !tenantIds ||
                      !toSchema ||
                      !password ||
                      !dbHost ||
                      !dbPort ||
                      !dbName ||
                      !dbUser ||
                      !dbPassword
                    }
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
                <ScrollArea ref={scrollAreaRef} className="h-[400px] pr-4">
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
