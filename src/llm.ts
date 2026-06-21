import OpenAI from "@openai/openai";

export type LlmConfig = {
  apiKey?: string;
  baseURL?: string;
  model?: string;
  temperature?: number;
};

export type GenerateTextOptions = LlmConfig & {
  input: string;
  instructions?: string | string[];
};

export type GenerateJsonOptions = GenerateTextOptions & {
  name: string;
  schema: Record<string, unknown>;
};

export function createLlmClient(config: LlmConfig = {}) {
  return new OpenAI({
    apiKey: config.apiKey ?? getRequiredEnv("AI_API_KEY"),
    baseURL: config.baseURL ?? Deno.env.get("AI_API_BASE_URL"),
  });
}

export async function generateText(
  options: GenerateTextOptions,
): Promise<string> {
  const client = createLlmClient(options);
  const response = await client.responses.create({
    model: options.model ?? getRequiredEnv("AI_MODEL"),
    temperature: options.temperature ?? getTemperature(),
    instructions: renderInstructions(options.instructions),
    input: options.input,
  });

  return response.output_text;
}

export async function generateJson<T>(
  options: GenerateJsonOptions,
): Promise<T> {
  const client = createLlmClient(options);
  const response = await client.responses.create({
    model: options.model ?? getRequiredEnv("AI_MODEL"),
    temperature: options.temperature ?? getTemperature(),
    instructions: renderInstructions(options.instructions),
    input: options.input,
    text: {
      format: {
        type: "json_schema",
        name: options.name,
        strict: true,
        schema: options.schema,
      },
    },
  });

  return JSON.parse(response.output_text) as T;
}

function renderInstructions(instructions: string | string[] | undefined) {
  return Array.isArray(instructions) ? instructions.join("\n") : instructions;
}

function getTemperature(): number {
  return Number(Deno.env.get("AI_TEMPERATURE") ?? "1");
}

function getRequiredEnv(name: string): string {
  const value = Deno.env.get(name);

  if (!value) {
    throw new Error(`${name} is not set`);
  }

  return value;
}
