export interface CompleterCallOpts {
  system?: string;
  agent?: string;
  temperature?: number;
  maxTokens?: number;
}

export interface CompleterResponse {
  text: string;
  inputTokens: number;
  outputTokens: number;
  model: string;
}

export interface Completer {
  readonly model: string;
  complete(prompt: string, opts?: CompleterCallOpts): Promise<CompleterResponse>;
}
