import type { ProviderPreset } from "@/types/provider-preset.type";
import type { TYPE_PROVIDER } from "@/types/provider.type";

/**
 * Build a curl template string from a ProviderPreset.
 * This bridges the new preset system with the existing fetchAIResponse pipeline
 * which expects curl templates with {{VARIABLE}} placeholders.
 */
export function presetToCurl(preset: ProviderPreset): string {
  const url = `${preset.baseUrl}${preset.chatEndpoint}`;

  // Build headers
  const headers: string[] = ['-H "Content-Type: application/json"'];

  if (preset.authHeaderFormat === "bearer") {
    headers.push('-H "Authorization: Bearer {{API_KEY}}"');
  } else if (preset.authHeaderFormat === "x-api-key") {
    headers.push('-H "x-api-key: {{API_KEY}}"');
  }

  if (preset.extraHeaders) {
    for (const [key, value] of Object.entries(preset.extraHeaders)) {
      headers.push(`-H "${key}: ${value}"`);
    }
  }

  // Build body based on format
  const body = buildBodyTemplate(preset);

  return `curl ${url} \\\n  ${headers.join(" \\\n  ")} \\\n  -d '${body}'`;
}

function buildBodyTemplate(preset: ProviderPreset): string {
  switch (preset.bodyFormat) {
    case "anthropic":
      return JSON.stringify({
        model: "{{MODEL}}",
        system: "{{SYSTEM_PROMPT}}",
        messages: [
          {
            role: "user",
            content: [
              { type: "text", text: "{{TEXT}}" },
              {
                type: "image",
                source: {
                  type: "base64",
                  media_type: "image/png",
                  data: "{{IMAGE}}",
                },
              },
            ],
          },
        ],
        max_tokens: 1024,
      });

    case "cohere":
      return JSON.stringify({
        model: "{{MODEL}}",
        preamble: "{{SYSTEM_PROMPT}}",
        messages: [
          {
            role: "user",
            content: [
              { type: "text", text: "{{TEXT}}" },
              {
                type: "image_url",
                image_url: { url: "data:image/png;base64,{{IMAGE}}" },
              },
            ],
          },
        ],
      });

    case "openai":
    default:
      return JSON.stringify({
        model: "{{MODEL}}",
        messages: [
          { role: "system", content: "{{SYSTEM_PROMPT}}" },
          {
            role: "user",
            content: [
              { type: "text", text: "{{TEXT}}" },
              {
                type: "image_url",
                image_url: { url: "data:image/png;base64,{{IMAGE}}" },
              },
            ],
          },
        ],
      });
  }
}

/**
 * Convert a ProviderPreset into a TYPE_PROVIDER for use with fetchAIResponse.
 */
export function presetToProvider(
  preset: ProviderPreset,
  variables?: Record<string, string>
): TYPE_PROVIDER {
  return {
    id: preset.id,
    name: preset.name,
    streaming: preset.streaming,
    responseContentPath: preset.responseContentPath,
    isCustom: false,
    curl: presetToCurl(preset),
    variables: variables ?? {},
  };
}
