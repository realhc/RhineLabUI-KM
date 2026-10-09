interface RhineAISettings {
  enabled: boolean;
  baseUrl: string;
  model: string;
  embeddingModel: string;
  hasKey: boolean;
}
interface RhineAITask {
  id: string;
  title: string;
  prompt: string;
  categoryId?: string | null;
  documentIds?: string[];
  enabled: boolean;
  schedule: {
    type: "once" | "daily" | "interval";
    at?: string;
    time?: string;
    minutes?: number;
  };
  nextRun?: string | null;
  lastRun?: string | null;
  lastDocId?: string | null;
  lastError?: string | { code: string; message: string };
  status?: string;
}
interface RhineAIHTTPState {
  enabled: boolean;
  allowWrite: boolean;
  url?: string;
  endpoint?: string;
  token?: string;
  port?: number;
  requestedPort?: number;
  running?: boolean;
  error?: string | null;
}
interface Window {
  /** Optional bridge: the Markdown repository never depends on an AI provider. */
  rhineAI?: {
    state(): Promise<{
      settings: RhineAISettings;
      tasks: RhineAITask[];
      http: RhineAIHTTPState;
    }>;
    saveSettings(input: Record<string, unknown>): Promise<RhineAISettings>;
    test(): Promise<unknown>;
    run(input: {
      prompt: string;
      documentId?: string;
      allowWrite: boolean;
    }): Promise<{
      text: string;
      toolResults: { name?: string; result?: unknown; error?: string }[];
      references: { id: string; title: string; snippet?: string }[];
      failed?: boolean;
      error?: string;
    }>;
    cancel(): Promise<unknown>;
    semantic(input: {
      query: string;
      categoryId?: string | null;
    }): Promise<
      { id: string; score: number; snippet: string; revision?: string }[]
    >;
    copy(kind: "guide" | "connection"): Promise<void>;
    guide(): Promise<unknown>;
    tasks(): Promise<RhineAITask[]>;
    saveTask(input: Record<string, unknown>): Promise<RhineAITask>;
    removeTask(id: string): Promise<unknown>;
    runTask(id: string): Promise<unknown>;
    configureHTTP(input: Record<string, unknown>): Promise<RhineAIHTTPState>;
  };
}
