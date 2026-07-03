import type { BetaContentBlock } from '@anthropic-ai/sdk/resources/beta/messages/messages.mjs'
import { z } from 'zod/v4'
import { queryModelWithStreaming } from '../../services/api/claude.js'
import { buildTool, type ToolDef, type ToolUseContext } from '../../Tool.js'
import type { PermissionUpdate } from '../../types/permissions.js'
import { formatFileSize } from '../../utils/format.js'
import { lazySchema } from '../../utils/lazySchema.js'
import { logError } from '../../utils/log.js'
import { createUserMessage } from '../../utils/messages.js'
import type { PermissionDecision } from '../../utils/permissions/PermissionResult.js'
import { getRuleByContentsForTool } from '../../utils/permissions/permissions.js'
import { asSystemPrompt } from '../../utils/systemPromptType.js'
import { isPreapprovedHost } from './preapproved.js'
import { DESCRIPTION, WEB_FETCH_TOOL_NAME } from './prompt.js'
import {
  getToolUseSummary,
  renderToolResultMessage,
  renderToolUseMessage,
  renderToolUseProgressMessage,
} from './UI.js'
import {
  applyPromptToMarkdown,
  type FetchedContent,
  getURLMarkdownContent,
  isPreapprovedUrl,
  MAX_MARKDOWN_LENGTH,
} from './utils.js'

const inputSchema = lazySchema(() =>
  z.strictObject({
    url: z.string().url().describe('The URL to fetch content from'),
    prompt: z.string().describe('The prompt to run on the fetched content'),
  }),
)
type InputSchema = ReturnType<typeof inputSchema>

const outputSchema = lazySchema(() =>
  z.object({
    bytes: z.number().describe('Size of the fetched content in bytes'),
    code: z.number().describe('HTTP response code'),
    codeText: z.string().describe('HTTP response code text'),
    result: z
      .string()
      .describe('Processed result from applying the prompt to the content'),
    durationMs: z
      .number()
      .describe('Time taken to fetch and process the content'),
    url: z.string().describe('The URL that was fetched'),
  }),
)
type OutputSchema = ReturnType<typeof outputSchema>

export type Output = z.infer<OutputSchema>

const unsupportedNativeWebFetchModels = new Set<string>()

function webFetchToolInputToPermissionRuleContent(input: {
  [k: string]: unknown
}): string {
  try {
    const parsedInput = WebFetchTool.inputSchema.safeParse(input)
    if (!parsedInput.success) {
      return `input:${input.toString()}`
    }
    const { url } = parsedInput.data
    const hostname = new URL(url).hostname
    return `domain:${hostname}`
  } catch {
    return `input:${input.toString()}`
  }
}

export const WebFetchTool = buildTool({
  name: WEB_FETCH_TOOL_NAME,
  searchHint: 'fetch and extract content from a URL',
  // 100K chars - tool result persistence threshold
  maxResultSizeChars: 100_000,
  shouldDefer: true,
  async description(input) {
    const { url } = input as { url: string }
    try {
      const hostname = new URL(url).hostname
      return `Claude wants to fetch content from ${hostname}`
    } catch {
      return `Claude wants to fetch content from this URL`
    }
  },
  userFacingName() {
    return 'Fetch'
  },
  getToolUseSummary,
  getActivityDescription(input) {
    const summary = getToolUseSummary(input)
    return summary ? `Fetching ${summary}` : 'Fetching web page'
  },
  get inputSchema(): InputSchema {
    return inputSchema()
  },
  get outputSchema(): OutputSchema {
    return outputSchema()
  },
  isEnabled: () => true,
  isConcurrencySafe() {
    return true
  },
  isReadOnly() {
    return true
  },
  toAutoClassifierInput(input) {
    return input.prompt ? `${input.url}: ${input.prompt}` : input.url
  },
  async checkPermissions(input, context): Promise<PermissionDecision> {
    const appState = context.getAppState()
    const permissionContext = appState.toolPermissionContext

    // Check if the hostname is in the preapproved list
    try {
      const { url } = input as { url: string }
      const parsedUrl = new URL(url)
      if (isPreapprovedHost(parsedUrl.hostname, parsedUrl.pathname)) {
        return {
          behavior: 'allow',
          updatedInput: input,
          decisionReason: { type: 'other', reason: 'Preapproved host' },
        }
      }
    } catch {
      // If URL parsing fails, continue with normal permission checks
    }

    // Check for a rule specific to the tool input (matching hostname)
    const ruleContent = webFetchToolInputToPermissionRuleContent(input)

    const denyRule = getRuleByContentsForTool(
      permissionContext,
      WebFetchTool,
      'deny',
    ).get(ruleContent)
    if (denyRule) {
      return {
        behavior: 'deny',
        message: `${WebFetchTool.name} denied access to ${ruleContent}.`,
        decisionReason: {
          type: 'rule',
          rule: denyRule,
        },
      }
    }

    const askRule = getRuleByContentsForTool(
      permissionContext,
      WebFetchTool,
      'ask',
    ).get(ruleContent)
    if (askRule) {
      return {
        behavior: 'ask',
        message: `Claude requested permissions to use ${WebFetchTool.name}, but you haven't granted it yet.`,
        decisionReason: {
          type: 'rule',
          rule: askRule,
        },
        suggestions: buildSuggestions(ruleContent),
      }
    }

    const allowRule = getRuleByContentsForTool(
      permissionContext,
      WebFetchTool,
      'allow',
    ).get(ruleContent)
    if (allowRule) {
      return {
        behavior: 'allow',
        updatedInput: input,
        decisionReason: {
          type: 'rule',
          rule: allowRule,
        },
      }
    }

    return {
      behavior: 'ask',
      message: `Claude requested permissions to use ${WebFetchTool.name}, but you haven't granted it yet.`,
      suggestions: buildSuggestions(ruleContent),
    }
  },
  async prompt(_options) {
    // Always include the auth warning regardless of whether ToolSearch is
    // currently in the tools list. Conditionally toggling this prefix based
    // on ToolSearch availability caused the tool description to flicker
    // between SDK query() calls (when ToolSearch enablement varies due to
    // MCP tool count thresholds), invalidating the Anthropic API prompt
    // cache on each toggle — two consecutive cache misses per flicker event.
    return `IMPORTANT: WebFetch WILL FAIL for authenticated or private URLs. Before using this tool, check if the URL points to an authenticated service (e.g. Google Docs, Confluence, Jira, GitHub). If so, look for a specialized MCP tool that provides authenticated access.
${DESCRIPTION}`
  },
  async validateInput(input) {
    const { url } = input
    try {
      new URL(url)
    } catch {
      return {
        result: false,
        message: `Error: Invalid URL "${url}". The URL provided could not be parsed.`,
        meta: { reason: 'invalid_url' },
        errorCode: 1,
      }
    }
    return { result: true }
  },
  renderToolUseMessage,
  renderToolUseProgressMessage,
  renderToolResultMessage,
  async call(input, context) {
    const { url, prompt } = input
    const start = Date.now()
    const model = context.options.mainLoopModel

    if (!isNativeWebFetchMarkedUnsupported(model)) {
      try {
        return await callNativeWebFetch(input, context, start)
      } catch (error) {
        if (!shouldFallbackFromNativeWebFetchError(error)) {
          throw error
        }

        markNativeWebFetchUnsupported(model)
        logError(error instanceof Error ? error : new Error(String(error)))
      }
    }

    const response = await getURLMarkdownContent(url, context.abortController)

    // Check if we got a redirect to a different host
    if ('type' in response && response.type === 'redirect') {
      const statusText =
        response.statusCode === 301
          ? 'Moved Permanently'
          : response.statusCode === 308
            ? 'Permanent Redirect'
            : response.statusCode === 307
              ? 'Temporary Redirect'
              : 'Found'

      const message = `REDIRECT DETECTED: The URL redirects to a different host.

Original URL: ${response.originalUrl}
Redirect URL: ${response.redirectUrl}
Status: ${response.statusCode} ${statusText}

To complete your request, I need to fetch content from the redirected URL. Please use WebFetch again with these parameters:
- url: "${response.redirectUrl}"
- prompt: "${prompt}"`

      const output: Output = {
        bytes: Buffer.byteLength(message),
        code: response.statusCode,
        codeText: statusText,
        result: message,
        durationMs: Date.now() - start,
        url,
      }

      return {
        data: output,
      }
    }

    const {
      content,
      bytes,
      code,
      codeText,
      contentType,
      persistedPath,
      persistedSize,
    } = response as FetchedContent

    const isPreapproved = isPreapprovedUrl(url)

    let result: string
    if (
      isPreapproved &&
      contentType.includes('text/markdown') &&
      content.length < MAX_MARKDOWN_LENGTH
    ) {
      result = content
    } else {
      result = await applyPromptToMarkdown(
        prompt,
        content,
        context.abortController.signal,
        context.options.isNonInteractiveSession,
        isPreapproved,
      )
    }

    // Binary content (PDFs, etc.) was additionally saved to disk with a
    // mime-derived extension. Note it so Claude can inspect the raw file
    // if the Haiku summary above isn't enough.
    if (persistedPath) {
      result += `\n\n[Binary content (${contentType}, ${formatFileSize(persistedSize ?? bytes)}) also saved to ${persistedPath}]`
    }

    const output: Output = {
      bytes,
      code,
      codeText,
      result,
      durationMs: Date.now() - start,
      url,
    }

    return {
      data: output,
    }
  },
  mapToolResultToToolResultBlockParam({ result }, toolUseID) {
    return {
      tool_use_id: toolUseID,
      type: 'tool_result',
      content: result,
    }
  },
} satisfies ToolDef<InputSchema, Output>)

async function callNativeWebFetch(
  input: z.infer<InputSchema>,
  context: ToolUseContext,
  start: number,
) {
  const { url, prompt } = input
  const appState = context.getAppState()
  const userMessage = createUserMessage({
    content: `Fetch this URL with the web_fetch tool, then answer the user's request using the fetched content.

URL: ${url}

User request:
${prompt}`,
  })

  const queryStream = queryModelWithStreaming({
    messages: [userMessage],
    systemPrompt: asSystemPrompt([
      'You are an assistant for fetching and analyzing one web URL.',
    ]),
    thinkingConfig: context.options.thinkingConfig,
    tools: [],
    signal: context.abortController.signal,
    options: {
      getToolPermissionContext: async () => appState.toolPermissionContext,
      model: context.options.mainLoopModel,
      toolChoice: { type: 'tool', name: 'web_fetch' },
      isNonInteractiveSession: context.options.isNonInteractiveSession,
      hasAppendSystemPrompt: !!context.options.appendSystemPrompt,
      extraToolSchemas: [{ name: 'web_fetch', type: 'web_fetch_20260309' }],
      querySource: 'web_fetch_tool',
      agents: context.options.agentDefinitions.activeAgents,
      mcpTools: [],
      agentId: context.agentId,
      effortValue: appState.effortValue,
    },
  })

  const allContentBlocks: BetaContentBlock[] = []
  for await (const event of queryStream) {
    if (event.type === 'assistant') {
      allContentBlocks.push(...event.message.content)
    }
  }

  const result = extractNativeWebFetchText(allContentBlocks)
  if (!result) {
    throw new Error('Native web_fetch returned no usable content')
  }

  return {
    data: {
      bytes: Buffer.byteLength(result),
      code: 200,
      codeText: 'OK',
      result,
      durationMs: Date.now() - start,
      url,
    },
  }
}

function extractNativeWebFetchText(contentBlocks: BetaContentBlock[]): string {
  const textParts: string[] = []

  for (const block of contentBlocks) {
    if (block.type === 'text') {
      textParts.push(block.text)
      continue
    }

    if (block.type !== 'web_fetch_tool_result') {
      continue
    }

    const content = block.content
    if (typeof content === 'string') {
      textParts.push(content)
    } else if (Array.isArray(content)) {
      for (const item of content) {
        if (typeof item === 'string') {
          textParts.push(item)
        } else if (
          item &&
          typeof item === 'object' &&
          'text' in item &&
          typeof item.text === 'string'
        ) {
          textParts.push(item.text)
        }
      }
    }
  }

  return textParts.join('\n\n').trim()
}

export function shouldFallbackFromNativeWebFetchError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error)
  return /web_fetch|server tool|tool schema|input_schema|extra input|unsupported|not supported|unknown tool/i.test(
    message,
  )
}

function markNativeWebFetchUnsupported(model: string | undefined): void {
  const key = normalizeModelKey(model)
  if (key) {
    unsupportedNativeWebFetchModels.add(key)
  }
}

function isNativeWebFetchMarkedUnsupported(model: string | undefined): boolean {
  const key = normalizeModelKey(model)
  return Boolean(key && unsupportedNativeWebFetchModels.has(key))
}

function normalizeModelKey(model: string | undefined): string | null {
  const key = model?.trim().toLowerCase()
  return key || null
}

function buildSuggestions(ruleContent: string): PermissionUpdate[] {
  return [
    {
      type: 'addRules',
      destination: 'localSettings',
      rules: [{ toolName: WEB_FETCH_TOOL_NAME, ruleContent }],
      behavior: 'allow',
    },
  ]
}
